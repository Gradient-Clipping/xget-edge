import { PLATFORM_CATALOG } from '../../src/config/platform-catalog.js';
import { getPlatformPathPrefix } from '../../src/routing/platform-index.js';

const upstreams = Object.entries(PLATFORM_CATALOG)
  .map(([key, base]) => ({ key, base: new URL(base) }))
  .sort((a, b) => b.base.pathname.length - a.base.pathname.length);

/**
 * Route live test traffic through the existing Xget instance.
 * Candidate routing and test spies still receive the original upstream URLs.
 * @param {typeof fetch} nativeFetch
 * @returns {typeof fetch} Fetch transport for live test requests.
 */
export function createLiveProxyFetch(nativeFetch) {
  return (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    const upstream = upstreams.find(({ base }) => {
      const prefix = base.pathname === '/' ? '' : base.pathname;
      return (
        target.origin === base.origin &&
        (target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))
      );
    });
    if (!upstream) {
      return nativeFetch(input, init);
    }
    const prefix = upstream.base.pathname === '/' ? '' : upstream.base.pathname;
    let path = target.pathname.slice(prefix.length);
    // The candidate already added crates.io's API prefix; the proxy adds it too.
    if (upstream.key === 'crates') {
      if (!/^\/api\/v1\/crates(?:\/|$)/.test(path)) {
        return nativeFetch(input, init);
      }
      path = path.slice('/api/v1/crates'.length) || '/';
    }
    const url = `https://xget.lazycampus.com${getPlatformPathPrefix(upstream.key)}${path.replace(/^\//, '')}${target.search}`;
    return nativeFetch(input instanceof Request ? new Request(url, input) : url, init);
  };
}
