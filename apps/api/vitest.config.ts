import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, env: { DATABASE_URL: 'memory://', JWT_SECRET: 'test-secret', SEED: 'false', WILAYAH_AUTOLOAD: 'false', OPNAME_LOCK: 'off' } },
});
