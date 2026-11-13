import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site: https://nobody174.github.io/drum-bass/
const BASE = '/drum-bass/';

export default defineConfig({
  base: BASE,
  plugins: [
    preact(),
    VitePWA({
      // autoUpdate: single-user app, so a new deploy silently installs and takes over on the next
      // launch (skipWaiting + clientsClaim). A "prompt" flow can be added later if mid-song reloads matter.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Drum Bass',
        short_name: 'DrumBass',
        description: 'Drum learning app for e-drum kits (Web MIDI).',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0d0d0f',
        theme_color: '#0d0d0f',
        start_url: BASE,
        scope: BASE,
        id: BASE,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole built app incl. self-hosted fonts so it works offline after first load.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        // Audio/large user data lives in IndexedDB, not here, but keep headroom for font files.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
