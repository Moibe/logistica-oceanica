import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
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
