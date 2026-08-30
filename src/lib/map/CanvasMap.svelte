<script lang="ts">
  import { geoEquirectangular, geoMercator, geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
  import type { GeoProjection, GeoPath } from 'd3-geo';
  import { select } from 'd3-selection';
  import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
  import { fuelFraction, position, wakeSpan } from '$lib/domain/fleet';
  import { PORTS } from '$lib/domain/ports';
  import { pointAt, ROUTES, route, slice } from '$lib/domain/routes';
  import { sim } from '$lib/state/simulation.svelte';
  import { untrack } from 'svelte';
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
   *
   * Three behaviours are borrowed from MapLibre because an ocean map is unusable
   * without them: a world that repeats horizontally, an animated camera that can
   * fly to and follow a hull, and label collision.
   */
  const PROJECTIONS = {
    // `wraps` marks the cylindrical projections — the ones whose left and right
    // edges are the same meridian, so tiling copies of the world side by side
    // produces a seamless, endless ocean. Natural Earth's rim is a curve; a copy
    // next to it would just look like a second, detached planet.
    equirect: { label: 'Equirect.', make: geoEquirectangular, wraps: true },
    natural: { label: 'Natural', make: geoNaturalEarth1, wraps: false },
    mercator: { label: 'Mercator', make: geoMercator, wraps: true },
  } as const;

  type ProjectionKey = keyof typeof PROJECTIONS;

  /** Wake length behind each hull, in km of lane. */
  const WAKE_KM = 1400;
  /** Above this zoom the 110m coastline starts showing its polygons; swap up. */
  const HI_RES_AT = 3;
  /** Zoom a fly-to settles at, unless the view is already closer than this. */
  const FLY_ZOOM = 5;
  const FLY_MS = 850;
  /** Hard cap on tiled world copies, so a pathological transform can't hang the loop. */
  const MAX_COPIES = 4;

  let host = $state.raw<HTMLDivElement>();
  let canvas = $state.raw<HTMLCanvasElement>();
  let projectionKey = $state<ProjectionKey>('equirect');
  let transform = $state.raw<ZoomTransform>(zoomIdentity);
  let resolution = $state<Resolution>('110m');
  let hoveredId = $state<string | null>(null);
  /** Camera lock. Follows whatever is selected, so re-selecting re-targets it. */
  let following = $state(false);

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
  // Projected extent of one whole world, in un-zoomed path space. `worldWidth`
  // is both the tiling step and the yardstick for spotting a polyline that has
  // jumped the antimeridian.
  let worldX0 = 0;
  let worldWidth = 0;
  let worldY0 = 0;
  let worldY1 = 0;
  // Kept so `resetView` can drive the *same* behaviour instance — recreating one
  // just to call `.transform` would leave the live behaviour's internal state
  // stale and the next wheel tick would snap back to the old zoom.
  let zoomBehaviour: ReturnType<typeof d3zoom<HTMLCanvasElement, unknown>> | null = null;

  const wraps = $derived(PROJECTIONS[projectionKey].wraps);

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

    const left = projection([-180, 0]);
    const right = projection([180, 0]);
    worldX0 = left ? left[0] : 0;
    worldWidth = left && right ? Math.abs(right[0] - left[0]) : width;
    const bounds = path.bounds({ type: 'Sphere' });
    worldY0 = bounds[0][1];
    worldY1 = bounds[1][1];

    applyTranslateExtent();
    bakeStatic();
  }

  /**
   * Fence the camera to the world. Vertically always — dragging the planet off
   * into empty space is never useful. Horizontally only when the projection
   * doesn't wrap; the tiled ones are meant to pan forever.
   */
  function applyTranslateExtent() {
    if (!zoomBehaviour) return;
    const extent: [[number, number], [number, number]] = wraps
      ? [
          [-Infinity, worldY0],
          [Infinity, worldY1],
        ]
      : [
          [worldX0, worldY0],
          [worldX0 + worldWidth, worldY1],
        ];
    zoomBehaviour.translateExtent(extent);
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

  /**
   * The horizontal offsets, in un-zoomed path units, at which a copy of the
   * world is currently on screen. Everything — static paths, wakes, ports,
   * hulls, hit-testing — is drawn once per entry, which is what makes the map
   * feel endless when you chase a ship across the Pacific.
   */
  function worldOffsets(): number[] {
    if (!wraps || worldWidth <= 0) return [0];
    const xMin = transform.invertX(0);
    const xMax = transform.invertX(width);
    const first = Math.ceil((xMin - (worldX0 + worldWidth)) / worldWidth);
    const last = Math.floor((xMax - worldX0) / worldWidth);
    const out: number[] = [];
    for (let n = Math.max(first, -MAX_COPIES); n <= Math.min(last, MAX_COPIES); n++) {
      out.push(n * worldWidth);
    }
    return out.length ? out : [0];
  }

  /** Project a lon/lat straight to screen pixels, transform included. */
  function toScreen(lonLat: [number, number]): [number, number] | null {
    const p = projection?.(lonLat);
    if (!p) return null;
    return [transform.applyX(p[0]), transform.applyY(p[1])];
  }

  // ---- labels -------------------------------------------------------------

  type Label = {
    text: string;
    x: number;
    y: number;
    font: string;
    color: string;
    /** Higher wins the spot. Selected hull ≫ hovered hull ≫ other hulls ≫ port by TEU. */
    priority: number;
  };

  /**
   * Greedy collision placement, MapLibre's trick without MapLibre. Candidates are
   * collected during the draw passes and resolved here in one go, so a hull's
   * name can beat a port's even though ports are painted first.
   */
  function placeLabels(ctx: CanvasRenderingContext2D, labels: Label[]) {
    labels.sort((a, b) => b.priority - a.priority);
    const taken: [number, number, number, number][] = [];
    for (const label of labels) {
      ctx.font = label.font;
      const w = ctx.measureText(label.text).width;
      const box: [number, number, number, number] = [
        label.x - 3,
        label.y - 11,
        label.x + w + 3,
        label.y + 4,
      ];
      if (box[2] < 0 || box[0] > width || box[3] < 0 || box[1] > height) continue;
      let clash = false;
      for (const t of taken) {
        if (box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      taken.push(box);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
    }
  }

  // ---- camera -------------------------------------------------------------

  type Fly = {
    fromCx: number;
    fromCy: number;
    fromK: number;
    toCx: number;
    toCy: number;
    toK: number;
    start: number;
  };
  let fly: Fly | null = null;

  /** Put a point of un-zoomed path space at the middle of the viewport. */
  function applyCentre(cx: number, cy: number, k: number) {
    if (!canvas || !zoomBehaviour) return;
    let next = zoomIdentity.translate(width / 2 - k * cx, height / 2 - k * cy).scale(k);
    // Run it through the same constraint the drag gesture uses. `zoom.transform`
    // skips constrain (it only guards gestures), so without this the camera could
    // fly somewhere a drag would never let you reach.
    next = zoomBehaviour.constrain()(
      next,
      [
        [0, 0],
        [width, height],
      ],
      zoomBehaviour.translateExtent()
    );
    select(canvas).call(zoomBehaviour.transform, next);
  }

  /**
   * Shift a projected x onto the world copy nearest the current view. Without
   * this a fly-to from Tokyo to Los Angeles would rewind across all of Eurasia
   * instead of hopping the Pacific.
   */
  function nearestCopy(px: number): number {
    if (!wraps || worldWidth <= 0) return px;
    const centre = transform.invertX(width / 2);
    return px + Math.round((centre - px) / worldWidth) * worldWidth;
  }

  function flyTo(lonLat: [number, number], targetK = Math.max(transform.k, FLY_ZOOM)) {
    const p = projection?.(lonLat);
    if (!p) return;
    fly = {
      fromCx: transform.invertX(width / 2),
      fromCy: transform.invertY(height / 2),
      fromK: transform.k,
      toCx: nearestCopy(p[0]),
      toCy: p[1],
      toK: targetK,
      start: performance.now(),
    };
  }

  function stepCamera(now: number) {
    if (fly) {
      const u = Math.min(1, (now - fly.start) / FLY_MS);
      const e = 1 - (1 - u) ** 3;
      // Scale interpolates geometrically: a linear ramp from 1× to 20× spends
      // almost the whole animation already zoomed in, which reads as a lurch.
      const k = Math.exp(Math.log(fly.fromK) + (Math.log(fly.toK) - Math.log(fly.fromK)) * e);
      applyCentre(
        fly.fromCx + (fly.toCx - fly.fromCx) * e,
        fly.fromCy + (fly.toCy - fly.fromCy) * e,
        k
      );
      if (u >= 1) fly = null;
      return;
    }
    if (!following) return;
    const ship = sim.selected;
    if (!ship) return;
    const p = projection?.(position(ship));
    if (!p) return;
    applyCentre(nearestCopy(p[0]), p[1], transform.k);
  }

  function centreOnSelected() {
    if (sim.selected) flyTo(position(sim.selected));
  }

  function toggleFollow() {
    following = !following;
    if (following) centreOnSelected();
  }

  // ---- drawing ------------------------------------------------------------

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
    const offsets = worldOffsets();
    // The same offsets in screen pixels, for everything drawn outside the
    // scaled context.
    const shifts = offsets.map((o) => o * k);
    /** A projected-x gap wider than this means the polyline jumped the antimeridian. */
    const seam = worldWidth * k * 0.5;
    const labels: Label[] = [];

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(k, k);

    for (const ox of offsets) {
      ctx.save();
      ctx.translate(ox, 0);

      // ---- graticule ----------------------------------------------------
      if (graticulePath) {
        ctx.strokeStyle = 'rgba(96, 160, 220, 0.10)';
        ctx.lineWidth = 0.5 / k;
        ctx.stroke(graticulePath);
      }

      // ---- land ---------------------------------------------------------
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

      // ---- routes -------------------------------------------------------
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
    }

    ctx.restore();

    // ---- wakes ----------------------------------------------------------
    // Drawn in screen space so the tail keeps a constant on-screen thickness
    // however far you zoom in — a wake is a HUD annotation, not terrain.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const ship of sim.ships) {
      // A docked or adrift ship isn't making way, so it gets no wake — the
      // trail would otherwise freeze mid-slice instead of shrinking, which
      // reads as a rendering bug rather than as "stopped".
      if (ship.status !== 'sailing') continue;
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
      for (const dx of shifts) {
        for (let i = 0; i < pts.length - 1; i++) {
          // The projection maps every longitude into one world, so a wake that
          // straddles the antimeridian comes back as two points at opposite
          // edges. Joining them would stripe the whole map; the copy on the
          // other side draws that half anyway.
          if (seam > 0 && Math.abs(pts[i + 1][0] - pts[i][0]) > seam) continue;
          const t = forward ? (i + 1) / (pts.length - 1) : 1 - i / (pts.length - 1);
          ctx.globalAlpha = (dimmed ? 0.18 : 0.85) * t * t;
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 1 + 2.4 * t;
          ctx.beginPath();
          ctx.moveTo(pts[i][0] + dx, pts[i][1]);
          ctx.lineTo(pts[i + 1][0] + dx, pts[i + 1][1]);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ---- ports ----------------------------------------------------------
    for (const p of PORTS) {
      const s = toScreen(p.at);
      if (!s) continue;
      const radius = 1.7 + Math.sqrt(p.teu) * 0.34;
      for (const dx of shifts) {
        const x = s[0] + dx;
        if (x < -40 || x > width + 40 || s[1] < -40 || s[1] > height + 40) continue;
        ctx.beginPath();
        ctx.arc(x, s[1], radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 236, 255, 0.9)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, s[1], radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(140, 205, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (k > 1.6 || p.teu > 8) {
          labels.push({
            text: p.name.toUpperCase(),
            x: x + radius + 6,
            y: s[1] + 3,
            font: '10px ui-monospace, monospace',
            color: 'rgba(200, 226, 250, 0.72)',
            priority: p.teu,
          });
        }
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
      const isDocked = ship.status === 'docked';
      const isAdrift = ship.status === 'adrift';
      // A fuel warning only matters while under way — a docked ship is
      // already headed back to full, and an adrift one has its own colour.
      const lowFuel = ship.status === 'sailing' && fuelFraction(ship) < 0.2;
      // Neutral slate for docked rather than a hue — the eight route colours
      // already span most of the spectrum, and a docked ship needs to read as
      // "paused" rather than risk landing on top of one of them (an earlier
      // sky-blue was a near-match for the Golfo-Índico teal).
      const statusColor = isAdrift ? '#f87171' : isDocked ? '#cbd5e1' : lowFuel ? '#fbbf24' : r.color;

      // Screen-space heading, as a central difference around the hull. Both
      // samples come from `pointAt` — the same distance-parameterised helper
      // that placed the ship — because mixing parameterisations is what made
      // this chevron flip: an earlier version snapped the look-ahead to the
      // nearest sampled vertex, which regularly landed *behind* the ship's
      // interpolated position and spun the arrow 180°, over and over, as the
      // rounded index stepped along.
      //
      // Doing it in screen space rather than reusing `heading()` from the
      // domain is deliberate: the marker has to line up with the lane as
      // drawn, and the projection shears that lane away from true bearing.
      const eps = Math.min(0.02, 150 / r.lengthKm);
      const clamp = (t: number) => Math.min(1, Math.max(0, t));
      const behind = toScreen(pointAt(r, clamp(ship.progress - eps * ship.direction)));
      const ahead = toScreen(pointAt(r, clamp(ship.progress + eps * ship.direction)));
      let angle = 0;
      if (behind && ahead) {
        let dxa = ahead[0] - behind[0];
        // Fold the gap back across the seam, or a hull sitting on the
        // antimeridian spins 180° for a frame.
        if (seam > 0 && Math.abs(dxa) > seam) dxa -= Math.sign(dxa) * worldWidth * k;
        angle = Math.atan2(ahead[1] - behind[1], dxa);
      }

      for (const dx of shifts) {
        const x = s[0] + dx;
        if (x < -60 || x > width + 60) continue;

        ctx.save();
        ctx.translate(x, s[1]);
        // A docked hull isn't pointing anywhere — it gets a plain disc below
        // instead of the chevron, so skipping the rotation just avoids an
        // arrow that would otherwise freeze at whatever angle it arrived on.
        if (!isDocked) ctx.rotate(angle);

        // Halo — tinted for status: cyan alongside, amber under a fuel
        // warning, red once adrift. Otherwise the usual route colour.
        ctx.globalCompositeOperation = 'lighter';
        const haloR = isSelected ? 26 : 16;
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
        halo.addColorStop(0, hexToRgba(statusColor, isSelected || isHovered ? 0.55 : 0.32));
        halo.addColorStop(1, hexToRgba(statusColor, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, haloR, 0, Math.PI * 2);
        ctx.fill();

        if (isDocked) {
          // A slow outward ring stands in for cargo/bunkering activity —
          // enough to read as "something is happening here" without
          // animating cranes. Phased by ship id so docked ships don't pulse
          // in lockstep.
          const phase = (dockPulsePhase(ship.id) + sim.hours * 0.4) % 1;
          ctx.strokeStyle = hexToRgba(statusColor, 0.5 * (1 - phase));
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, 10 + phase * 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';

        if (isDocked) {
          // Parked, not pointing anywhere: a plain disc reads as "stopped"
          // where the directional chevron would falsely imply it's under way.
          ctx.beginPath();
          ctx.arc(0, 0, isSelected ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fillStyle = '#f2fbff';
          ctx.fill();
          ctx.strokeStyle = statusColor;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
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
          ctx.strokeStyle = statusColor;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        ctx.restore();

        if (isSelected || isHovered || k > 2.4) {
          const suffix = isDocked ? ' · en puerto' : isAdrift ? ' · sin combustible' : '';
          labels.push({
            text: ship.name + suffix,
            x: x + 12,
            y: s[1] - 9,
            font: '11px ui-monospace, monospace',
            color: isAdrift ? 'rgba(255, 193, 180, 0.95)' : 'rgba(233, 243, 255, 0.92)',
            priority: isSelected ? 1000 : isHovered ? 900 : 500,
          });
        }
      }
    }

    placeLabels(ctx, labels);
  }

  function hexToRgba(hex: string, alpha: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** Stable 0..1 offset from a ship's id, so docked ships' pulse rings don't sync up. */
  function dockPulsePhase(id: string): number {
    let sum = 0;
    for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
    return (sum % 100) / 100;
  }

  /** Nearest ship to a screen point, within a generous grab radius. */
  function shipAt(x: number, y: number): string | null {
    const shifts = worldOffsets().map((o) => o * transform.k);
    let best: string | null = null;
    let bestDist = 16 * 16;
    for (const ship of sim.ships) {
      const s = toScreen(position(ship));
      if (!s) continue;
      for (const dx of shifts) {
        const d = (s[0] + dx - x) ** 2 + (s[1] - y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = ship.id;
        }
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

        // Hands on the map win over the camera. A drag means "I want to look
        // somewhere else", so it breaks the follow lock; a wheel tick is just a
        // zoom and keeps it, the way a map app behaves.
        const source = event.sourceEvent as Event | null;
        if (!source) return;
        fly = null;
        if (source.type !== 'wheel') following = false;
      });
    const selection = select(canvas);
    selection.call(zoomBehaviour);
    applyTranslateExtent();
    return () => {
      selection.on('.zoom', null);
      zoomBehaviour = null;
    };
  });

  $effect(() => {
    // Selecting another hull while locked on re-targets the camera. The lookup
    // is untracked on purpose: `position()` reads `ship.progress`, which the
    // simulation mutates every frame, so a tracked read would re-fire this
    // effect — and restart the fly-to — sixty times a second.
    const id = sim.selectedId;
    if (!following || !id) return;
    untrack(() => {
      const ship = sim.ships.find((s) => s.id === id);
      if (ship) flyTo(position(ship));
    });
  });

  $effect(() => {
    // The frame loop. Reading `sim.hours` here is deliberate but not what
    // drives it — rAF does; the loop simply always paints the latest state.
    let frame = requestAnimationFrame(function loop(now) {
      stepCamera(now);
      draw();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  });

  function resetView() {
    if (!canvas || !zoomBehaviour) return;
    fly = null;
    following = false;
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
  <button class="ctl" disabled={!sim.selected} onclick={centreOnSelected}>Centrar</button>
  <button
    class="ctl"
    class:is-active={following}
    disabled={!sim.selected}
    aria-pressed={following}
    onclick={toggleFollow}
  >
    Seguir
  </button>
  <span class="sep"></span>
  <span class="label mono">{transform.k.toFixed(1)}× · {resolution}</span>
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
    justify-content: flex-end;
    flex-wrap: wrap;
    /* Capped so the row wraps upward instead of sliding left under the clock,
       which sits centred at the same height. */
    max-width: 27rem;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem;
  }

  .tools .ctl {
    padding: 0.3rem 0.6rem;
    font-size: 0.72rem;
  }

  .tools .ctl:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .tools .ctl:disabled:hover {
    background: rgba(255, 255, 255, 0.03);
    border-color: var(--line);
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
