import { env } from 'cloudflare:test';

import { createLiveProxyFetch } from './helpers/live-proxy-fetch.js';

// A test transport only: source routing, fixtures and spies keep their original inputs.
if (Reflect.get(env, 'XGET_TEST_USE_XGET') === 'true') {
  globalThis.fetch = createLiveProxyFetch(globalThis.fetch.bind(globalThis));
}
