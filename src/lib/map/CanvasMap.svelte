<script lang="ts">
  import { geoEquirectangular, geoMercator, geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
  import type { GeoProjection, GeoPath } from 'd3-geo';
  import { select } from 'd3-selection';
  import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
  import { position, wakeSpan } from '$lib/domain/fleet';
  import { PORTS } from '$lib/domain/ports';
  import { ROUTES, route, slice } from '$lib/domain/routes';
  import { sim } from '$lib/state/simulation.svelte';
  import { loadWorld, type Resolution, type WorldGeometry } from './world';

  /**
   * The crisp view. Everything is redrawn as vectors every frame at device
   * pixel ratio, so there is no raster to go soft — you can zoom to 40x and the
   * coastline is still a hairline.
   *
   * Two tricks carry the performance: the static geometry (land, borders,
   * graticule, route centrelines) is baked into `Path2D` objects **once** in
   * un-zoomed projected space, and the d3-zoom transform is applied to the
   * canvas context rather than to the projection. So a frame is a handful of
   * `fill`/`stroke` calls on cached paths plus the live fleet, and panning never
   * re-runs the projection over 25k coastline vertices.
   */
  const PROJECTIONS = {
    equirect: { label: 'Equirectangular', make: geoEquirectangular },
    natural: { label: 'Natural Earth', make: geoNaturalEarth1 },
    mercator: { label: 'Mercator', make: geoMercator },
  } as const;

  type ProjectionKey = keyof typeof PROJECTIONS;

  /** Wake length behind each hull, in km of lane. */
  const WAKE_KM = 1400;
  /** Above this zoom the 110m coastline starts showing its polygons; swap up. */
  const HI_RES_AT = 3;

  let host = $state.raw<HTMLDivElement>();
  let canvas = $state.raw<HTMLCanvasElement>();
  let projectionKey = $state<ProjectionKey>('equirect');
  let transform = $state.raw<ZoomTransform>(zoomIdentity);
  let resolution = $state<Resolution>('110m');
  let hoveredId = $state<string | null>(null);

  // Plain locals, not runes: these are read only from inside the draw loop and
  // rebuilt imperatively. Making them reactive would re-run effects on every
  // frame for no gain.
  let width = 0;
  let height = 0;
  let dpr = 1;
  let projection: GeoProjection | null = null;
  let path: GeoPath | null = null;
  let world: WorldGeometry | null = null;
  let landPath: Path2D | null = null;
  let bordersPath: Path2D | null = null;
  let graticulePath: Path2D | null = null;
  let routePaths = new Map<string, Path2D>();
  // Kept so `resetView` can drive the *same* behaviour instance — recreating one
  // just to call `.transform` would leave the live behaviour's internal state
  // stale and the next wheel tick would snap back to the old zoom.
  let zoomBehaviour: ReturnType<typeof d3zoom<HTMLCanvasElement, unknown>> | null = null;

  /** Rebuild the projection for the current size and re-bake every static path. */
  function rebuild() {
    if (!width || !height) return;
    projection = PROJECTIONS[projectionKey].make();
    projection.fitExtent(
      [
        [12, 12],
        [width - 12, height - 12],
      ],
      { type: 'Sphere' }
    );
    path = geoPath(projection);
    bakeStatic();
  }

  function bakeStatic() {
    if (!path) return;
    graticulePath = new Path2D(path(geoGraticule10()) ?? '');
    routePaths = new Map(
      ROUTES.map((r) => [
        r.id,
        new Path2D(path!({ type: 'LineString', coordinates: r.points }) ?? ''),
      ])
    );
    if (world) {
      landPath = new Path2D(path(world.land) ?? '');
      bordersPath = new Path2D(path(world.borders) ?? '');
    }
  }

  /** Project a lon/lat straight to screen pixels, transform included. */
  function toScreen(lonLat: [number, number]): [number, number] | null {
    const p = projection?.(lonLat);
    if (!p) return null;
    return [transform.applyX(p[0]), transform.applyY(p[1])];
  }

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !projection) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // ---- ocean ----------------------------------------------------------
    const sea = ctx.createLinearGradient(0, 0, 0, height);
    sea.addColorStop(0, '#061225');
    sea.addColorStop(0.55, '#04101f');
    sea.addColorStop(1, '#020a14');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, width, height);

    const k = transform.k;
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(k, k);

    // ---- graticule ------------------------------------------------------
    if (graticulePath) {
      ctx.strokeStyle = 'rgba(96, 160, 220, 0.10)';
      ctx.lineWidth = 0.5 / k;
      ctx.stroke(graticulePath);
    }

    // ---- land -----------------------------------------------------------
    if (landPath) {
      ctx.fillStyle = '#0c1a2b';
      ctx.fill(landPath);
      ctx.strokeStyle = 'rgba(120, 190, 255, 0.34)';
      ctx.lineWidth = 0.7 / k;
      ctx.lineJoin = 'round';
      ctx.stroke(landPath);
    }
    if (bordersPath) {
      ctx.strokeStyle = 'rgba(120, 190, 255, 0.10)';
      ctx.lineWidth = 0.5 / k;
      ctx.stroke(bordersPath);
    }

    // ---- routes ---------------------------------------------------------
    // Additive blending is what sells the "line of light": the wide low-alpha
    // pass builds a halo that brightens where lanes overlap, then a thin core
    // on top gives it a hard, legible centre.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of ROUTES) {
      const p = routePaths.get(r.id);
      if (!p) continue;
      const active = !sim.selected || sim.selected.routeId === r.id;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = active ? 0.1 : 0.03;
      ctx.lineWidth = 6 / k;
      ctx.stroke(p);
      ctx.globalAlpha = active ? 0.55 : 0.14;
      ctx.lineWidth = 1 / k;
      ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // ---- wakes ----------------------------------------------------------
    // Drawn in screen space so the tail keeps a constant on-screen thickness
    // however far you zoom in — a wake is a HUD annotation, not terrain.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const ship of sim.ships) {
      const r = route(ship.routeId);
      const [from, to] = wakeSpan(ship, WAKE_KM);
      const pts = slice(r, from, to)
        .map(toScreen)
        .filter((p): p is [number, number] => p !== null);
      if (pts.length < 2) continue;
      // The tail runs from the ship backwards, so the bright end is whichever
      // end of the slice the ship is actually on.
      const forward = ship.direction === 1;
      const dimmed = sim.selected && sim.selected.id !== ship.id;
      for (let i = 0; i < pts.length - 1; i++) {
        const t = forward ? (i + 1) / (pts.length - 1) : 1 - i / (pts.length - 1);
        ctx.globalAlpha = (dimmed ? 0.18 : 0.85) * t * t;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1 + 2.4 * t;
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ---- ports ----------------------------------------------------------
    for (const p of PORTS) {
      const s = toScreen(p.at);
      if (!s || s[0] < -40 || s[0] > width + 40 || s[1] < -40 || s[1] > height + 40) continue;
      const radius = 1.7 + Math.sqrt(p.teu) * 0.34;
      ctx.beginPath();
      ctx.arc(s[0], s[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 236, 255, 0.9)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s[0], s[1], radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(140, 205, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (k > 1.6 || p.teu > 8) {
        ctx.fillStyle = 'rgba(200, 226, 250, 0.72)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(p.name.toUpperCase(), s[0] + radius + 6, s[1] + 3);
      }
    }

    // ---- ships ----------------------------------------------------------
    for (const ship of sim.ships) {
      const at = position(ship);
      const s = toScreen(at);
      if (!s) continue;
      const r = route(ship.routeId);
      const isSelected = sim.selectedId === ship.id;
      const isHovered = hoveredId === ship.id;

      // Screen-space heading: sample a hair ahead along the lane and take the
      // angle between the two projected points, so the marker stays aligned
      // with the drawn line even where the projection shears it.
      const aheadT = Math.min(1, Math.max(0, ship.progress + 0.002 * ship.direction));
      const ahead = toScreen(r.points.length ? projectedAt(r.id, aheadT) : at);
      const angle = ahead ? Math.atan2(ahead[1] - s[1], ahead[0] - s[0]) : 0;

      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate(angle);

      // Halo.
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, isSelected ? 26 : 16);
      halo.addColorStop(0, hexToRgba(r.color, isSelected || isHovered ? 0.55 : 0.32));
      halo.addColorStop(1, hexToRgba(r.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, isSelected ? 26 : 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // Hull: a chevron pointing along the heading.
      const size = isSelected ? 8 : 6.4;
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.72, size * 0.62);
      ctx.lineTo(-size * 0.36, 0);
      ctx.lineTo(-size * 0.72, -size * 0.62);
      ctx.closePath();
      ctx.fillStyle = '#f2fbff';
      ctx.fill();
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      if (isSelected || isHovered || k > 2.4) {
        ctx.fillStyle = 'rgba(233, 243, 255, 0.92)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(ship.name, s[0] + 12, s[1] - 9);
      }
    }
  }

  /** Lon/lat of a normalised position on a route, without importing pointAt twice. */
  function projectedAt(routeId: string, t: number): [number, number] {
    const r = route(routeId);
    const i = Math.min(r.points.length - 1, Math.max(0, Math.round(t * (r.points.length - 1))));
    return r.points[i];
  }

  function hexToRgba(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** Nearest ship to a screen point, within a generous grab radius. */
  function shipAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestDist = 16 * 16;
    for (const ship of sim.ships) {
      const s = toScreen(position(ship));
      if (!s) continue;
      const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = ship.id;
      }
    }
    return best;
  }

  function onPointerMove(event: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    hoveredId = shipAt(event.clientX - rect.left, event.clientY - rect.top);
  }

  function onClick(event: MouseEvent) {
    const rect = canvas!.getBoundingClientRect();
    const hit = shipAt(event.clientX - rect.left, event.clientY - rect.top);
    if (hit) sim.select(hit);
  }

  // ---- lifecycle --------------------------------------------------------

  $effect(() => sim.attach());

  $effect(() => {
    // Size tracking. The canvas backing store is kept at devicePixelRatio so
    // hairlines land on real device pixels instead of being resampled.
    if (!host || !canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = host!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      rebuild();
    });
    observer.observe(host);
    return () => observer.disconnect();
  });

  $effect(() => {
    // Rebake when the projection choice changes.
    projectionKey;
    rebuild();
  });

  $effect(() => {
    // Coastline resolution follows the zoom level; each file is fetched once.
    let cancelled = false;
    loadWorld(resolution).then((w) => {
      if (cancelled) return;
      world = w;
      bakeStatic();
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!canvas) return;
    zoomBehaviour = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 48])
      .on('zoom', (event) => {
        transform = event.transform;
        // Only ever step up in detail — dropping back to 110m on zoom-out would
        // pop the coastline every time you scrub the wheel.
        if (transform.k >= HI_RES_AT && resolution === '110m') resolution = '50m';
      });
    const selection = select(canvas);
    selection.call(zoomBehaviour);
    return () => {
      selection.on('.zoom', null);
      zoomBehaviour = null;
    };
  });

  $effect(() => {
    // The frame loop. Reading `sim.hours` here is deliberate but not what
    // drives it — rAF does; the loop simply always paints the latest state.
    let frame = requestAnimationFrame(function loop() {
      draw();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  });

  function resetView() {
    if (!canvas || !zoomBehaviour) return;
    select(canvas).call(zoomBehaviour.transform, zoomIdentity);
  }
</script>

<div class="host" bind:this={host}>
  <canvas
    bind:this={canvas}
    onpointermove={onPointerMove}
    onpointerleave={() => (hoveredId = null)}
    onclick={onClick}
    class:over-ship={hoveredId !== null}
  ></canvas>
</div>

<div class="tools panel">
  <span class="label">Proyección</span>
  {#each Object.entries(PROJECTIONS) as [key, p] (key)}
    <button
      class="ctl"
      class:is-active={projectionKey === key}
      onclick={() => (projectionKey = key as ProjectionKey)}
    >
      {p.label}
    </button>
  {/each}
  <span class="sep"></span>
  <span class="label mono">{transform.k.toFixed(1)}×</span>
  <span class="label mono">{resolution}</span>
  <button class="ctl" onclick={resetView}>Reencuadrar</button>
</div>

<style>
  .host {
    position: fixed;
    inset: 0;
  }

  canvas {
    display: block;
    cursor: grab;
    touch-action: none;
  }

  canvas.over-ship {
    cursor: pointer;
  }

  canvas:active {
    cursor: grabbing;
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

  @media (max-width: 900px) {
    .tools {
      display: none;
    }
  }
</style>
