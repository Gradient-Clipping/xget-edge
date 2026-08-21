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

## Deployment flow

1. Changes to `main` run the upstream CI workflow.
2. A successful CI run regenerates and force-pushes the `pages` branch.
3. EdgeOne Makers watches `pages` and deploys it automatically.
4. `xget.lazycampus.com` is bound as a DNS-only custom domain.

The upstream token-based EdgeOne workflow is intentionally removed. EdgeOne's
Git integration is scoped to this repository instead of storing a broad API
token in GitHub Actions.
