<script lang="ts">
  import {
    type GeoJSONSource,
    Map as MapLibreMap,
    Marker,
    type StyleSpecification,
  } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { Feature, FeatureCollection, LineString } from 'geojson';
  import type { LonLat } from '$lib/domain/geo';
  import { heading, position, wakeSpan } from '$lib/domain/fleet';
  import { PORTS } from '$lib/domain/ports';
  import { pointAt, ROUTES, route } from '$lib/domain/routes';
  import { sim } from '$lib/state/simulation.svelte';
  import { asFeatureCollection, loadWorld } from './world';

  /**
   * The GL view. Land, lanes and wakes are real vector layers so MapLibre does
   * the tiling, culling and (optionally) the globe projection for us; ships and
   * ports are DOM markers instead of symbol layers, because symbol text needs a
   * glyph endpoint and this map deliberately has zero network dependencies —
   * the coastline comes from the same local TopoJSON the other two views use.
   */
  const WAKE_KM = 1400;
  /** Segments per wake. Each one carries its own alpha, which is how the tail fades. */
  const WAKE_SEGMENTS = 18;
  /** Wake refresh interval. 30 Hz is indistinguishable here and halves the setData churn. */
  const WAKE_INTERVAL_MS = 33;

  let host = $state.raw<HTMLDivElement>();
  let projection = $state<'mercator' | 'globe'>('mercator');
  let ready = $state(false);

  let map: MapLibreMap | null = null;
  let shipMarkers = new Map<string, { marker: Marker; el: HTMLElement }>();

  /**
   * MapLibre draws a LineString by its raw coordinates, so a lane that crosses
   * the antimeridian would be stroked the long way around the planet. Unwrapping
   * lets longitudes run past ±180 continuously, which is exactly what the
   * renderer wants.
   */
  function unwrap(points: LonLat[]): [number, number][] {
    const out: [number, number][] = [];
    let offset = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const delta = points[i][0] - points[i - 1][0];
        if (delta > 180) offset -= 360;
        else if (delta < -180) offset += 360;
      }
      out.push([points[i][0] + offset, points[i][1]]);
    }
    return out;
  }

  function laneCollection(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: ROUTES.map(
        (r): Feature<LineString> => ({
          type: 'Feature',
          properties: { id: r.id, color: r.color },
          geometry: { type: 'LineString', coordinates: unwrap(r.points) },
        })
      ),
    };
  }

  function wakeCollection(): FeatureCollection {
    const features: Feature<LineString>[] = [];
    const focus = sim.selected?.id ?? null;
    for (const ship of sim.ships) {
      const r = route(ship.routeId);
      const [from, to] = wakeSpan(ship, WAKE_KM);
      const tail = ship.direction === 1 ? from : to;
      const head = ship.direction === 1 ? to : from;
      const samples: LonLat[] = [];
      for (let s = 0; s <= WAKE_SEGMENTS; s++) {
        const t = tail + ((head - tail) * s) / WAKE_SEGMENTS;
        samples.push(pointAt(r, t));
      }
      const coords = unwrap(samples);
      const dim = focus !== null && focus !== ship.id;
      for (let s = 0; s < WAKE_SEGMENTS; s++) {
        const f = (s + 1) / WAKE_SEGMENTS;
        features.push({
          type: 'Feature',
          properties: {
            color: r.color,
            alpha: (dim ? 0.2 : 0.9) * f * f,
            width: 1 + 3 * f,
          },
          geometry: { type: 'LineString', coordinates: [coords[s], coords[s + 1]] },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

  function buildStyle(land: FeatureCollection): StyleSpecification {
    return {
      version: 8,
      projection: { type: projection },
      sources: {
        land: { type: 'geojson', data: land },
        lanes: { type: 'geojson', data: laneCollection() },
        wakes: { type: 'geojson', data: EMPTY },
      },
      layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': '#04101f' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#0c1a2b' } },
        {
          id: 'coast',
          type: 'line',
          source: 'land',
          paint: { 'line-color': '#7cc4ff', 'line-opacity': 0.38, 'line-width': 0.8 },
        },
        {
          id: 'lane-halo',
          type: 'line',
          source: 'lanes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 7,
            'line-blur': 7,
            'line-opacity': 0.3,
          },
        },
        {
          id: 'lane-core',
          type: 'line',
          source: 'lanes',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8 },
        },
        {
          id: 'wake',
          type: 'line',
          source: 'wakes',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': ['get', 'alpha'],
            'line-blur': 1.4,
          },
        },
      ],
    };
  }

  function portMarkerElement(name: string, teu: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'port-marker';
    el.style.setProperty('--size', `${(4 + Math.sqrt(teu) * 0.7).toFixed(1)}px`);
    el.innerHTML = `<span class="dot"></span><span class="name">${name}</span>`;
    return el;
  }

  function shipMarkerElement(color: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'ship-marker';
    el.style.setProperty('--tint', color);
    el.innerHTML =
      '<svg viewBox="-10 -10 20 20" width="20" height="20" aria-hidden="true">' +
      '<path d="M8 0 L-6 5 L-3 0 L-6 -5 Z" fill="#f2fbff" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg>';
    return el;
  }

  $effect(() => sim.attach());

  $effect(() => {
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let lastWake = 0;

    loadWorld('110m').then((world) => {
      if (disposed || !host) return;
      const instance = new MapLibreMap({
        container: host,
        style: buildStyle(asFeatureCollection(world)),
        center: [40, 20],
        zoom: 1.4,
        attributionControl: false,
        // No raster tiles anywhere in this style, so there is nothing to fetch
        // and nothing to credit.
        maxPitch: 0,
      });
      map = instance;
      // MapLibre swallows style/source problems into an event; without a
      // listener a bad style just renders nothing at all.
      instance.on('error', (event) => {
        console.error('[maplibre]', event.error?.message ?? event);
      });

      // The ticker only starts once the style has settled. Calling `setData` on
      // the wake source before then keeps it permanently "loading", which stops
      // the style from ever reporting loaded — the map then paints nothing at
      // all, silently, and the `load` event never fires.
      const tick = (now: number) => {
        if (disposed) return;
        for (const ship of sim.ships) {
          const entry = shipMarkers.get(ship.id);
          if (!entry) continue;
          entry.marker.setLngLat(position(ship));
          // MapLibre's rotation is clockwise from north, which is exactly what
          // `heading()` returns, but the SVG points along +X — hence the -90.
          entry.marker.setRotation(heading(ship) - 90);
          entry.el.classList.toggle('is-selected', sim.selectedId === ship.id);
        }
        if (now - lastWake > WAKE_INTERVAL_MS) {
          lastWake = now;
          const source = instance.getSource<GeoJSONSource>('wakes');
          source?.setData(wakeCollection());
        }
        frame = requestAnimationFrame(tick);
      };

      instance.on('load', () => {
        ready = true;
        for (const p of PORTS) {
          new Marker({ element: portMarkerElement(p.name, p.teu), anchor: 'left' })
            .setLngLat(p.at)
            .addTo(instance);
        }
        for (const ship of sim.ships) {
          const el = shipMarkerElement(route(ship.routeId).color);
          el.addEventListener('click', () => sim.select(ship.id));
          const marker = new Marker({ element: el, rotationAlignment: 'map' })
            .setLngLat(position(ship))
            .addTo(instance);
          shipMarkers.set(ship.id, { marker, el });
        }
        frame = requestAnimationFrame(tick);
      });

    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      shipMarkers.forEach(({ marker }) => marker.remove());
      shipMarkers = new Map();
      map?.remove();
      map = null;
      ready = false;
    };
  });

  $effect(() => {
    // Switching projection restyles in place; the sources are rebuilt by the
    // style so the markers (which live in the DOM, not the style) survive.
    const target = projection;
    if (map && ready) map.setProjection({ type: target });
  });
</script>

<div class="host" bind:this={host}></div>

<div class="tools panel">
  <span class="label">Proyección</span>
  <button
    class="ctl"
    class:is-active={projection === 'mercator'}
    onclick={() => (projection = 'mercator')}>Mercator</button
  >
  <button
    class="ctl"
    class:is-active={projection === 'globe'}
    onclick={() => (projection = 'globe')}>Globo</button
  >
  <span class="sep"></span>
  <span class="label">Capas GL · datos locales</span>
</div>

<style>
  .host {
    position: fixed;
    inset: 0;
  }

  .tools {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
  }

  .tools .ctl {
    padding: 0.3rem 0.6rem;
    font-size: 0.72rem;
  }

  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--line);
    margin: 0 0.25rem;
  }

  /* Marker elements are created imperatively, so their styles have to escape
     Svelte's scoping. */
  :global(.port-marker) {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  :global(.port-marker .dot) {
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: #cfeaff;
    box-shadow: 0 0 10px rgba(140, 205, 255, 0.8);
  }

  :global(.port-marker .name) {
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(206, 230, 252, 0.75);
    white-space: nowrap;
  }

  :global(.ship-marker) {
    color: var(--tint);
    cursor: pointer;
    filter: drop-shadow(0 0 6px var(--tint));
    transition: transform 120ms ease;
  }

  :global(.ship-marker.is-selected) {
    filter: drop-shadow(0 0 12px var(--tint));
  }

  :global(.ship-marker svg) {
    display: block;
  }

  @media (max-width: 900px) {
    .tools {
      display: none;
    }
  }
</style>
