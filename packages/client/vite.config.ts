import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // No runtimeCaching entries for /api/* — offline data access is handled
      // deliberately by the IndexedDB layer in src/offline/ (with its own
      // online-first-then-cache-fallback logic), not by the service worker.
      // A second, independent caching layer over the same requests would
      // race with it and could serve silently stale data.
      manifest: {
        name: 'DuelTrack',
        short_name: 'DuelTrack',
        description: 'DuelTrack — MtG Tournament Manager',
        theme_color: '#4c1d95',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@dueltrack/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
