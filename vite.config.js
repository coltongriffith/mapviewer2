import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Release identifier stamped into error reports (audit P1-12).
  define: { __APP_VERSION__: JSON.stringify(commit ? `${pkg.version}+${commit.slice(0, 12)}` : pkg.version) },
  plugins: [
    // The /3d page's build stamp, which an open page compares with the deployed one (src/three-d/version-check.js):
    // its entry chunk's content hash, which changes whenever any of its code does (lazy chunks included).
    {
      name: 'em3d-build-stamp',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.chunk || !/[\\/]3d[\\/]index\.html$/.test(ctx.filename)) return html;
          return html.replace('<head>', `<head>\n<meta name="em-build" content="${ctx.chunk.fileName.replace(/^assets\/|\.js$/g, '')}">`);
        },
      },
    },
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
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      // Exploration Maps 3D (/3d) and Exploration Maps for Teams (/teams) are
      // standalone pages with their own scripts, so neither touches the editor
      // bundle and the editor never loads three.js.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        '3d': fileURLToPath(new URL('./3d/index.html', import.meta.url)),
        teams: fileURLToPath(new URL('./teams/index.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          // Vite's shared preload helper must not pull a lazy PDF/export
          // engine into the marketing page just to perform dynamic imports.
          if (id.includes('vite/preload-helper')) return 'vendor-preload';
          if (id.includes('node_modules/leaflet')) return 'vendor-leaflet';
          if (id.includes('node_modules/three')) return 'vendor-three';
          // Drafts need compression immediately; PDF/ZIP engines are only
          // needed on export/import. Grouping them loaded ~157 KiB of export
          // code just to restore a local map.
          if (id.includes('node_modules/fflate')) return 'vendor-compression';
          if (id.includes('node_modules/jspdf')) return 'vendor-export';
          if (id.includes('node_modules/jszip')) return 'vendor-zip';
          // The CRS picker uses proj4; it must not fetch the shapefile/ZIP
          // parser simply because both libraries share projection utilities.
          if (id.includes('node_modules/proj4')) return 'vendor-projection';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          if (id.includes('node_modules/shpjs')) return 'vendor-geo';
          if (id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/react/')) return 'vendor-react';
        },
      },
    },
  },
});
