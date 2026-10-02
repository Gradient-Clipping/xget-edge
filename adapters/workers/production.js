import { onRequest } from '../pages/functions/[[path]].js';

export default {
  /**
   * Applies the existing Xget access policy at the Cloudflare edge.
   * @param {Request} request Incoming request.
   * @param {Record<string, unknown>} env Worker bindings.
   * @param {ExecutionContext} ctx Worker context.
   * @returns {Promise<Response>} Proxy response.
   */
  fetch(request, env, ctx) {
    // Cloudflare replaces this header at its edge. The shared policy adapter
    // uses eo.clientIp as its internal client-IP input; no EdgeOne service is used.
    Object.defineProperty(request, 'eo', {
      value: { clientIp: request.headers.get('CF-Connecting-IP') || '' }
    });
    return onRequest({
      request,
      env,
      params: {},
      data: {},
      waitUntil: promise => ctx.waitUntil(promise),
      next: async () => new Response(null, { status: 404 })
    });
  }
};
