import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      /** `types.ts` is interface-only; V8 has no executable statements to cover. */
      exclude: ['**/*.d.ts', 'src/types.ts'],
    },
    pool: 'forks',
  },
});
