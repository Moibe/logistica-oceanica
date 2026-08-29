import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // `strictPort` so el proyecto siempre vive en 4444: sin eso Vite se corre al
  // siguiente puerto libre cuando 4444 está ocupado y acabas mirando la app
  // vieja en otra pestaña.
  server: { port: 4444, strictPort: true },
  preview: { port: 4444, strictPort: true },
  optimizeDeps: {
    // maplibre-gl spawns its parser worker with `new Worker(new URL(...,
    // import.meta.url))`. Vite's dep pre-bundling rewrites that URL into
    // `.vite/deps/` but never emits the worker file there, so the request 404s,
    // the style never finishes loading and the map renders a blank canvas with
    // no error anywhere. Leaving the package unbundled keeps the worker URL
    // pointing at the real file.
    exclude: ['maplibre-gl'],
  },
});
