import { describe, expect, it, vi } from 'vitest';

import { createLiveProxyFetch } from '../helpers/live-proxy-fetch.js';

describe('Live test proxy transport', () => {
  it('preserves request options while routing GitHub traffic through Xget', async () => {
    const native = vi.fn().mockResolvedValue(new Response(null));
    const options = { method: 'HEAD', redirect: /** @type {const} */ ('manual') };
    await createLiveProxyFetch(native)(
      'https://github.com/owner/repo/archive/main.zip?raw=1',
      options
    );
    expect(native).toHaveBeenCalledWith(
      'https://xget.lazycampus.com/gh/owner/repo/archive/main.zip?raw=1',
      options
    );
  });

  it('uses the most specific upstream path', async () => {
    const native = vi.fn().mockResolvedValue(new Response(null));
    await createLiveProxyFetch(native)('https://github.com/Homebrew/brew/main/README.md');
    expect(native).toHaveBeenCalledWith(
      'https://xget.lazycampus.com/homebrew/brew/main/README.md',
      undefined
    );
  });

  it('uses the existing container registry route', async () => {
    const native = vi.fn().mockResolvedValue(new Response(null));
    await createLiveProxyFetch(native)(
      'https://registry-1.docker.io/v2/library/alpine/manifests/latest'
    );
    expect(native).toHaveBeenCalledWith(
      'https://xget.lazycampus.com/cr/docker/v2/library/alpine/manifests/latest',
      undefined
    );
  });

  it('avoids applying the crates.io API prefix twice', async () => {
    const native = vi.fn().mockResolvedValue(new Response(null));
    await createLiveProxyFetch(native)('https://crates.io/api/v1/crates/serde/1.0.0/download');
    expect(native).toHaveBeenCalledWith(
      'https://xget.lazycampus.com/crates/serde/1.0.0/download',
      undefined
    );
  });

  it('preserves Request methods, headers and bodies', async () => {
    const native = vi.fn().mockResolvedValue(new Response(null));
    const request = new Request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"test"}'
    });
    await createLiveProxyFetch(native)(request);
    const [[forwarded]] = native.mock.calls;
    expect(forwarded.url).toBe('https://xget.lazycampus.com/ip/openai/v1/chat/completions');
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('Content-Type')).toBe('application/json');
    expect(await forwarded.text()).toBe('{"model":"test"}');
  });

  it('leaves local services and unknown hosts untouched', async () => {
    const native = vi.fn().mockResolvedValue(new Response(null));
    const transport = createLiveProxyFetch(native);
    await transport('http://127.0.0.1:12345/internal');
    await transport('https://github.com.example.org/file');
    expect(native).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:12345/internal', undefined);
    expect(native).toHaveBeenNthCalledWith(2, 'https://github.com.example.org/file', undefined);
  });
});
