import { feature, mesh } from 'topojson-client';
import type { FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { Topology, GeometryCollection } from 'topojson-specification';

/**
 * Coastlines, shared by all three renderers. The TopoJSON ships in `static/data`
 * (copied from the `world-atlas` package at scaffold time) so the map works with
 * no network and no tile provider — no API keys, no rate limits, nothing to
 * expire mid-game.
 *
 * Two resolutions: 110m is enough for the whole-world view and 50m is swapped in
 * once the canvas zooms past the point where 110m coastlines start to look like
 * a polygon soup. Both are fetched lazily and cached forever.
 */
export type Resolution = '110m' | '50m';

export type WorldGeometry = {
  /**
   * Filled landmasses. This is a FeatureCollection, not a single Feature:
   * world-atlas stores `objects.land` as a TopoJSON GeometryCollection, so
   * `feature()` hands back one Feature per landmass.
   */
  land: FeatureCollection<Polygon | MultiPolygon>;
  /** Coastline + shared borders as a single stroke-once mesh (no double-drawn edges). */
  borders: MultiLineString;
};

const cache = new Map<Resolution, Promise<WorldGeometry>>();

export function loadWorld(resolution: Resolution = '110m'): Promise<WorldGeometry> {
  const hit = cache.get(resolution);
  if (hit) return hit;

  const pending = (async () => {
    // 50m only ships a `land` object in world-atlas' land bundle; countries are
    // only needed for the border mesh, which the low-res file provides fine.
    const [landTopo, countryTopo] = await Promise.all([
      fetchTopology(`/data/land-${resolution}.json`),
      fetchTopology('/data/countries-110m.json'),
    ]);

    const land = feature(
      landTopo,
      landTopo.objects.land as GeometryCollection
    ) as unknown as FeatureCollection<Polygon | MultiPolygon>;

    const borders = mesh(
      countryTopo,
      countryTopo.objects.countries as GeometryCollection
    ) as MultiLineString;

    return { land, borders };
  })();

  cache.set(resolution, pending);
  return pending;
}

async function fetchTopology(url: string): Promise<Topology> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
  return (await res.json()) as Topology;
}

/** The land as GeoJSON a MapLibre `geojson` source can take directly. */
export function asFeatureCollection(world: WorldGeometry): FeatureCollection {
  return world.land;
}
