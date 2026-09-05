import { readFileSync } from 'node:fs';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Release identifier stamped into error reports (audit P1-12).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's shared preload helper must not pull a lazy PDF/export
          // engine into the marketing page just to perform dynamic imports.
          if (id.includes('vite/preload-helper')) return 'vendor-preload';
          if (id.includes('node_modules/leaflet')) return 'vendor-leaflet';
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/fflate')) return 'vendor-export';
          if (id.includes('node_modules/jszip')) return 'vendor-export';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          if (id.includes('node_modules/shpjs')) return 'vendor-geo';
          if (id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/react/')) return 'vendor-react';
        },
      },
    },
  },
});
