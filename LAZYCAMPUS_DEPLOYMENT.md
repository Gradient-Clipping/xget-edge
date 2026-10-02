# LazyCampus Cloudflare Workers deployment

The production Xget endpoint is `https://xget.lazycampus.com`, served entirely
by the `xget` Cloudflare Worker. The source repository keeps its existing name,
`Gradient-Clipping/xget-edge`; `main` is the release branch.

## Runtime policy

`wrangler.jsonc` is the production configuration. The guarded entry point is
`adapters/workers/production.js`. It uses Cloudflare's edge-supplied
`CF-Connecting-IP` and the existing shared proxy/access-policy implementation.
The retained Pages adapter is local compatibility code, not an EdgeOne backend.

`XGET_ALLOWED_CLIENT_IPS=1.14.95.189` permits the production server to use all
existing Xget sources. An absent allowlist fails closed with HTTP 503. Other
clients receive HTTP 403 for package, GitHub, and other source routes.

The existing fixed TCR routes and `/v2/` probe retain upstream Basic/Bearer
authentication for external clients. TCR validates credentials; the proxy stores
none. Token and Registry responses are not cached. Uploads are streamed without
automatic replay, and signed continuation URLs remain on the same proxy.

The fixed TCR upstream is the Hong Kong personal registry,
`hkccr.ccs.tencentyun.com`. Business publishing workflows push directly to that
registry. The server verified that the authenticated `wecom-kf:1.0.52` manifest
has the same digest through Xget and directly through Hong Kong TCR; the proxy
response uses `Cache-Control: no-store`.

Request timeouts and retries retain application defaults. Worker invocation
logs, workers.dev, and preview URLs are disabled. No Agent package-source
settings or business image-publishing workflows are changed by this hosting
migration.

## Deployment flow

1. A push to `main` runs GitHub CI, including lint, formatting, tests, coverage,
   and type checks.
2. `.github/workflows/workers.yml` accepts only successful CI for a push to this
   repository's `main`, checks out its exact validated SHA, and rejects stale
   commits after comparing the current `main` ref.
3. The serialized deployment uses locked npm dependencies and `wrangler.jsonc`.
4. Cloudflare manages the `xget.lazycampus.com` custom domain and certificate.

The repository's `CLOUDFLARE_API_TOKEN` secret is reserved for this deployment.
It requires Workers Scripts edit in the selected account and Workers Routes edit
plus Zone read for `lazycampus.com`. It does not require storage or database
permissions. Never print it or commit it. GitHub-hosted runner addresses vary,
so this deployment token cannot use the server-only source IP restriction.

There is no EdgeOne branch synchronization or production build connection.
`wrangler.test.jsonc` keeps upstream integration tests separate from the guarded
production entry point. Access-policy tests import the production adapter.
Regenerate binding types with
`npx wrangler types worker-configuration.d.ts --include-runtime false` after
changing bindings.

The optional Docker image builds the upstream-compatible `src/index.js` with
`wrangler.test.jsonc`, including the matching workerd compatibility date. It
does not deploy the production domain; the guarded production Worker continues
to use `wrangler.jsonc` and the verified Workers workflow above.

The old EO Makers GitHub App installation was revoked after its only selected
repository (`xget-edge`) was verified. The generated `pages` branch was archived
as a local Git bundle before deletion.

## Client verification

Git, npm, pip, curl, Docker Hub authentication, and TCR authentication were
verified through the production domain. The existing Cloudflare zone's Browser
Integrity Check rejects the default `Python-urllib` user agent with HTTP 403 /
error 1010 before the Worker. This hosting migration does not change that zone
security setting. A valid client user agent is required; a successful curl check
does not establish that every HTTP client's defaults are accepted.

## Historical benchmarks

The manual TCR benchmark workflow and `wrangler.tcr-benchmark.jsonc` are
retained for reproducibility. They require separately supplied temporary
credentials and an explicit test origin. The 2026-10-02 temporary CF Worker,
domain binding, DNS record, token, and test image tags were removed after
measurement. They are not part of production.

Cloudflare's account upload limits still apply to request bodies; changing
hosting does not establish support for every production-size Docker layer. See
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

The migration verification is recorded in
[the migration log](docs/migrations/2026-10-03-cloudflare.md).
