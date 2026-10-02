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

## Cutover status

Deployment, custom-domain verification, and deletion of the old Makers project
will be recorded here after their completion. Old project identity:
`makers-bbpnhufgbjh8`, source `Gradient-Clipping/xget-edge`, release branch
`pages`. The shared EdgeOne `lazycampus.com` zone `zone-3solmvkeru39` is outside
this deletion scope.
