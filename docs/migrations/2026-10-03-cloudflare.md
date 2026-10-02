# Xget migration to Cloudflare Workers

Migration scope: keep `xget.lazycampus.com` and the existing access policy, move
all Xget routes to one Cloudflare Worker, and remove the former EdgeOne Makers
deployment. Agent source configuration and business image pushes are outside
this migration.

## Configuration prepared

- Worker: `xget`, account `8398107a0f563924dc230af0da7cf7ba`.
- Production config: `wrangler.jsonc`; guarded entry:
  `adapters/workers/production.js`.
- Custom domain: `xget.lazycampus.com`, no split routing or fallback backend.
- Retained server allowlist: `1.14.95.189`; fixed TCR authentication exception
  unchanged. No registry credentials are stored in Xget.
- Deploy the exact successful GitHub CI commit and reject a stale `main` ref.
- Remove the branch conversion workflow used by EdgeOne.
- Deployment token: selected account Workers Scripts edit, and only the
  `lazycampus.com` zone's Workers Routes edit / Zone read.
- Disable invocation logs, workers.dev, and preview URLs in production.

## Local validation

Lint, formatting, type checking, and 396 tests passed. A Wrangler dry build
produced a 65.08 KiB module (15.49 KiB gzip). Two additional policy tests cover
an absent allowlist and untrusted forwarded client IP headers.

Production retains the previously tested compatibility date `2026-10-02`. The
locked workerd test binary supports `2026-08-22`; the separate test config uses
that date. The first attempt using the local calendar date `2026-10-03` was
rejected because it was still `2026-10-02` in UTC.

## Completed cutover

Release source: `14e781ba034f5e4ce40da077d0c8eb17a248d30a`.
[CI 37037340320](https://github.com/Gradient-Clipping/xget-edge/actions/runs/37037340320)
and commit lint passed. The
[Workers deployment 37037432461](https://github.com/Gradient-Clipping/xget-edge/actions/runs/37037432461)
passed after the approved token was saved. A PowerShell stdin byte-order mark
was initially rejected by Wrangler; the token was resaved as exact ASCII bytes.
The initial domain deployment also used the same exact CI-validated repository
configuration via Wrangler while the queued workflow was being completed.

The original DNS-only CNAME `xget.lazycampus.com.pages.dnsoe4.com` was backed up
before removing its exact record. Cloudflare now manages a proxied, read-only
Worker DNS record for the original hostname. HTTPS, domain ownership, the server
allowlist, disabled workers.dev / previews, and disabled invocation logs were
verified by API and live requests. No split routing or EdgeOne fallback is
configured.

The former `makers-bbpnhufgbjh8` project, all its deployments, domain bindings,
and settings were deleted; the Makers project list is empty. The EO Makers
GitHub App installation `156172799` had only `xget-edge` selected and was
uninstalled; it disappeared from the organization's installed Apps list. The
generated `pages` branch at `2eb5230a2ca09ca05f4fdeb073e2ae617d42f815` was
preserved in a verified Git bundle before the remote branch was deleted. The
shared EdgeOne `lazycampus.com` zone `zone-3solmvkeru39` remains enabled.

## Production verification

Server `1.14.95.189` checks through the original production hostname:

| Check                           | Result                                                   |
| ------------------------------- | -------------------------------------------------------- |
| GitHub README                   | 200, 1.31 s; SHA-256 matches the known upstream file     |
| Git Smart HTTP refs             | Successful, 6.92 s                                       |
| npm metadata                    | 200, 0.66 s; package identity verified                   |
| npm pack `is-number@7.0.0`      | Successful with isolated cache, 2.85 s                   |
| PyPI index                      | 200, lists the requested wheel                           |
| pip download `requests==2.32.5` | Successful, 2.69 s; downloaded wheel hash recorded       |
| Docker Hub token                | 200, valid token received without logging it             |
| TCR probe                       | 401 with rewritten authentication challenge and no-store |
| Authenticated TCR token         | 200, valid token received without logging it             |
| External package client         | 403; the private-source policy remains enforced          |
| External Registry probe         | 401 with the production-domain token challenge           |
| workers.dev                     | 404; the temporary staging entrance is disabled          |

The npm archive SHA-256 is
`7b75c1057198cf97696909a9bee176c9c5e9bcb5b03bf3ecef2f484defadd51e`; the requests
wheel SHA-256 is
`2462f94637a34fd532264295e186976db0f5d453d1cdd31473c85a6a161affb6`. These
timings are migration smoke checks, not repeated performance benchmarks. The
normal pip flow retains the application's existing upstream download-link
behavior; it does not prove every wheel byte traverses the Xget file route. The
dedicated `/pypi/files/` check separately downloaded the complete 64,738-byte
wheel through CF and matched PyPI's published hash. An npm archive Range request
returned HTTP 206, the requested 1,024 bytes, and the correct Content-Range.

The server cannot connect to the staging `workers.dev` hostname, so it was
validated through the final custom domain. The zone's existing Browser Integrity
Check rejects default `Python-urllib` with error 1010. The same request with
curl's user agent succeeds; actual Git/npm/pip clients also pass. No zone
security setting was weakened for this migration.

The first PyPI verifier incorrectly expected rewritten HTML download links; that
extra assertion failed although the index returned 200. The corrected index
check and actual pip download establish the retained behavior. This is not an
unresolved upstream failure.

Local evidence is under `.codex-artifacts/xget-cf-migration-20261003/`,
including DNS backup, verified legacy branch bundle, client results, and
screenshots. The deployment token remains solely in the approved GitHub
repository Secret after the temporary local copy is deleted. It was never copied
to the server. Root `AGENTS.md` and the deployment guide were updated. Agent
runtime settings and business Actions image-pushing workflows were not changed.
