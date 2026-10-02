import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../adapters/pages/functions/[[path]].js';
import { CONFIG } from '../../src/config/index.js';
import { handleDockerAuth, rewriteRegistryLocation } from '../../src/protocols/docker.js';
import worker from '../../src/index.js';

/** @type {ExecutionContext} */
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = { XGET_ALLOWED_CLIENT_IPS: '1.14.95.189', MAX_RETRIES: '3', RETRY_DELAY_MS: '0' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Invokes the deployed Pages adapter from a changing Runner IP.
 * @param {Request} request Test request.
 * @returns {Promise<Response>} Adapter response.
 */
function pages(request) {
  return onRequest({
    request,
    env,
    params: {},
    waitUntil() {},
    next: async () => new Response(),
    data: {}
  });
}

describe('TCR Registry push', () => {
  it('challenges external Registry probes without fetching upstream or opening other routes', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const probe = await pages(new Request('https://proxy.example/v2/'));
    expect(probe.status).toBe(401);
    expect(probe.headers.get('WWW-Authenticate')).toContain('/cr/tcr/v2/auth');
    expect(probe.headers.get('Cache-Control')).toBe('no-store');
    const denied = await pages(
      new Request('https://proxy.example/cr/ghcr/v2/', {
        headers: { Authorization: 'Bearer token' }
      })
    );
    expect(denied.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('requires Registry credentials for TCR requests outside the IP allowlist', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const response = await pages(
      new Request('https://proxy.example/v2/cr/tcr/lazycampus/image/blobs/uploads/', {
        method: 'POST'
      })
    );
    expect(response.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates an authenticated Docker login probe against the fixed TCR upstream', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        headers: { 'Content-Length': '2' }
      })
    );
    const response = await pages(
      new Request('https://proxy.example/v2/', {
        headers: { Authorization: 'Bearer valid-token' }
      })
    );
    expect(response.status).toBe(200);
    expect(String(spy.mock.calls[0][0])).toBe('https://ccr.ccs.tencentyun.com/v2/');
  });

  it('passes upload bytes and credentials through and rewrites signed upload continuation state', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(
        'https://ccr.ccs.tencentyun.com/v2/lazycampus/image/blobs/uploads/id'
      );
      expect(init?.method).toBe('PATCH');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer valid-token');
      expect(await new Response(init?.body).text()).toBe('layer bytes');
      return new Response(null, {
        status: 202,
        headers: {
          Location: '/v2/lazycampus/image/blobs/uploads/id?_state=signed',
          'Content-Length': '0'
        }
      });
    });
    const response = await pages(
      new Request('https://proxy.example/v2/cr/tcr/lazycampus/image/blobs/uploads/id', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer valid-token' },
        body: 'layer bytes'
      })
    );
    expect(response.status).toBe(202);
    expect(response.headers.get('Location')).toBe(
      'https://proxy.example/v2/cr/tcr/lazycampus/image/blobs/uploads/id?_state=signed'
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not replay a Registry upload after an upstream failure', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('retry later', { status: 503 }));
    const response = await worker.fetch(
      new Request('https://proxy.example/cr/tcr/v2/lazycampus/image/blobs/uploads/id', {
        method: 'PATCH',
        body: 'bytes'
      }),
      env,
      ctx
    );
    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns a push auth challenge without consuming and replaying an unauthorized upload', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }));
    const response = await worker.fetch(
      new Request('https://proxy.example/cr/tcr/v2/lazycampus/image/blobs/uploads/', {
        method: 'POST'
      }),
      env,
      ctx
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('/cr/tcr/v2/auth');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserves pull,push scopes while stripping the proxy repository prefix', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).endsWith('/v2/')) {
        return new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'Bearer realm="https://ccr.ccs.tencentyun.com/service/token",service="token-service"'
          }
        });
      }
      return new Response('{"token":"test-token"}');
    });
    const response = await pages(
      new Request(
        'https://proxy.example/cr/tcr/v2/auth?scope=repository:cr/tcr/lazycampus/image:pull,push',
        {
          headers: { Authorization: 'Basic dGVzdDp0ZXN0' }
        }
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('22');
    const [, tokenCall] = spy.mock.calls;
    expect(new URL(String(tokenCall[0])).searchParams.get('scope')).toBe(
      'repository:lazycampus/image:pull,push'
    );
    expect(new Headers(tokenCall[1]?.headers).get('Authorization')).toBe('Basic dGVzdDp0ZXN0');
  });

  it('rejects attempts to route TCR auth credentials to another registry', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const request = new Request(
      'https://proxy.example/cr/tcr/v2/auth?scope=repository:cr/ghcr/other/image:pull,push'
    );
    const response = await handleDockerAuth(request, new URL(request.url), CONFIG);
    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rewrites path-style upload locations and leaves external read locations intact', () => {
    const target = 'https://ccr.ccs.tencentyun.com/v2/lazycampus/image/blobs/uploads/';
    const client = new URL('https://proxy.example/cr/tcr/v2/lazycampus/image/blobs/uploads/');
    expect(
      rewriteRegistryLocation(
        '/v2/lazycampus/image/blobs/uploads/id?state=keep',
        target,
        client,
        'cr-tcr'
      )
    ).toBe('https://proxy.example/cr/tcr/v2/lazycampus/image/blobs/uploads/id?state=keep');
    expect(rewriteRegistryLocation('https://storage.example/blob', target, client, 'cr-tcr')).toBe(
      'https://storage.example/blob'
    );
  });
});
