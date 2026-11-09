import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` throws on import outside an RSC — correct in the
      // app, fatal in a unit test. Stub it so server modules are testable.
      'server-only': resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'src/**/*.staging.test.ts'],
  },
})
