import { onRequest } from '../pages/functions/[[path]].js';

export default {
  /**
   * Uses the same proxy and access policy as the EdgeOne benchmark deployment.
   * @param {Request} request Incoming request.
   * @param {Record<string, unknown>} env Worker bindings.
   * @param {ExecutionContext} ctx Worker context.
   * @returns {Promise<Response>} Registry response.
   */
  fetch(request, env, ctx) {
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
