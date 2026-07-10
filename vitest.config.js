import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test-only config, deliberately separate from vite.config.js so the
// production build pipeline (blog generation, polyfills, chunking) is
// untouched by the test runner.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    // Serverless api/ handlers are plain node modules — no DOM needed, but
    // jsdom does not hurt them and one environment keeps the setup simple.
    testTimeout: 15000,
  },
});
