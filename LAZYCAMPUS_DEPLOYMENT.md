# LazyCampus EdgeOne deployment

This repository mirrors Xget from the upstream GitCode repository and deploys
the generated `pages` branch through the EdgeOne Makers Git integration.

## Runtime policy

The Pages adapter fails closed unless the production and preview environments
define:

```text
XGET_ALLOWED_CLIENT_IPS=1.14.95.189
```

The value accepts a comma-separated list of exact IPv4 or IPv6 addresses. The
adapter only trusts `request.eo.clientIp`, which is supplied by the EdgeOne
runtime, and does not trust client-provided forwarding headers.

TCR Registry operations use `/cr/tcr/v2/` or Docker host-style image names
`xget.lazycampus.com/cr/tcr/lazycampus/IMAGE:TAG`. These fixed-upstream routes
also accept authenticated clients outside the server IP allowlist, including
GitHub-hosted runners. TCR validates Basic credentials and Bearer tokens; no
registry credentials are stored in the proxy. Other Xget routes remain restricted
to the server. An external `/v2/` probe returns the TCR token challenge, and
authenticated probes are verified against TCR. Auth endpoint scopes cannot
select a different upstream registry.

Uploads preserve body bytes, signed continuation URLs, and `pull,push` scopes.
Upload URLs are rewritten to stay on the selected proxy. Upload requests are
never replayed automatically; clients must handle resumption. Registry and token
responses use `Cache-Control: no-store`.

## TCR benchmark

`Benchmark TCR push routes` is manual-only and uses repository secrets
`TCR_USERNAME` / `TCR_PASSWORD`. It pushes isolated `xget-benchmark-*` tags to
`lazycampus/agent-backend`; these tags do not match production ImagePolicies.
The workflow compares direct TCR, EdgeOne, and a supplied CF Worker origin from
the same runner. Each round uses the same incompressible 8 MiB OCI payload and
forces blob uploads even if the digest already exists. Successful manifests and
blob digests are checked directly at TCR. Native Docker tests use distinct,
equal-size layers to prevent layer deduplication from hiding upload failures.

The Cloudflare adapter and `wrangler.tcr-benchmark.jsonc` use the same handler
and authentication policy. The Cloudflare edge supplies `CF-Connecting-IP`,
which the adapter maps to the shared IP policy; package and GitHub routes remain
restricted to the server. The explicitly approved temporary custom origin is
`https://xget-cf-benchmark.lazycampus.com`. Its Worker, domain binding, DNS record,
and temporary deployment token are removed after measurement.
The workflow saves timing, success, and verification results as a seven-day
artifact. Credentials, tokens, and signed upload URLs are never recorded.

Published EdgeOne Makers Edge Functions documentation lists a 1 MB request-body
limit, but the bound deployment accepted complete 8 MiB OCI and native Docker
pushes in the 2026-10-02 benchmark. Treat limits as deployment-specific until
tested; the published limit alone is not a measurement of this endpoint. The
benchmark tests 512 KiB chunks, an ordinary 8 MiB layer PATCH, and native Docker
pushes separately. It also probes one 128 MiB layer per route to expose account
upload limits beyond small-image tests. Passing chunked tests does not prove that normal Docker
uploads or production-size layers are supported. See the
[Makers limits](https://pages.edgeone.ai/document/edge-functions) and
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Deployment flow

1. Changes to `main` run the upstream CI workflow.
2. A successful CI run regenerates and force-pushes the `pages` branch.
3. EdgeOne Makers watches `pages` and deploys it automatically.
4. `xget.lazycampus.com` is bound as a DNS-only custom domain.

CI always runs tests and generates coverage. The external Codecov upload runs
only when `CODECOV_TOKEN` is configured; missing report-service credentials do
not bypass tests or prevent the Pages synchronization gate from completing.

The upstream token-based EdgeOne workflow is intentionally removed. EdgeOne's
Git integration is scoped to this repository instead of storing a broad API
token in GitHub Actions.
