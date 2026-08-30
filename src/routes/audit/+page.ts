import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * Development tool, not part of the game: it pulls a 3 MB coastline and walks
 * every route point through a point-in-polygon test.
 *
 * The guard runs in a universal load *with SSR left on* deliberately. With
 * `ssr = false` the server still hands out the page shell and only the hydrated
 * client discovers the 404, so the route answered 200 in production. Letting
 * the load run on the server makes it a real 404. The page itself is
 * SSR-safe — every bit of work happens inside an `$effect`.
 */
export function load() {
  if (!dev) error(404, 'La auditoría de rutas solo existe en desarrollo');
}
