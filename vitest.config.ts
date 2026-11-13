import { defineConfig, mergeConfig, configDefaults } from 'vitest/config';
import viteConfig from './vite.config';

// Unit tests only (same Vite config as before). Security-rules tests need the Firestore
// emulator and run separately: `npm run test:rules`.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, 'tests/rules/**'],
    },
  }),
);
