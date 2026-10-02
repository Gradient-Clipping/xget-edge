import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Upstream integration tests exercise the proxy directly. Production
      // access-policy tests import the guarded Workers adapter separately.
      wrangler: { configPath: './wrangler.test.jsonc' }
    })
  ],
  test: {
    exclude: [...configDefaults.exclude, 'test/unit/commitlint-workflow.test.js'],
    testTimeout: 60000,
    hookTimeout: 30000
  }
});
