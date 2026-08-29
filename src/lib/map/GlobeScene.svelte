<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { interactivity, OrbitControls } from '@threlte/extras';
  import {
    AdditiveBlending,
    BackSide,
    BufferAttribute,
    BufferGeometry,
    CatmullRomCurve3,
    Color,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    PointsMaterial,
    SphereGeometry,
    TubeGeometry,
    Vector3,
  } from 'three';
  import { toVector3 } from '$lib/domain/geo';
  import { position, wakeSpan } from '$lib/domain/fleet';
  import { PORTS } from '$lib/domain/ports';
  import { pointAt, ROUTES, route } from '$lib/domain/routes';
  import { sim } from '$lib/state/simulation.svelte';
  import { loadWorld } from './world';
  import { lineOutlines, polygonOutlines, polylineGeometry, starField } from './globeGeometry';

  /**
   * The globe. Same fleet, same lanes, same coastlines as the flat views — the
   * only thing that changes is that a [lon, lat] becomes a point on a sphere
   * instead of a point on a projection.
   *
   * Radii are stacked in fixed shells so nothing z-fights: ocean at 1.000,
   * coastline at 1.002, lane halo at 1.004, lane core at 1.006, wakes at 1.008,
   * hulls at 1.012.
   */
  let { autoRotate = true }: { autoRotate?: boolean } = $props();

  // Enables pointer events on meshes in this scene graph, so a hull can be
  // clicked straight on the globe instead of only from the roster.
  interactivity();

  const R = {
    ocean: 1,
    coast: 1.002,
    laneHalo: 1.004,
    lane: 1.006,
    wake: 1.008,
    ship: 1.012,
    port: 1.006,
  };

  const WAKE_KM = 2200;
  /** Vertices per wake. Fixed so the buffer is allocated once and rewritten in place. */
  const WAKE_SAMPLES = 48;

  let coastGeometry = $state.raw<BufferGeometry | null>(null);
  let borderGeometry = $state.raw<BufferGeometry | null>(null);

  $effect(() => {
    let cancelled = false;
    loadWorld('110m').then((world) => {
      if (cancelled) return;
      coastGeometry = polygonOutlines(world.land, R.coast);
      borderGeometry = lineOutlines(world.borders, R.coast);
    });
    return () => {
      cancelled = true;
    };
  });

  // ---- static scene resources -------------------------------------------
  // three.js materials and geometries are expensive to churn and none of these
  // depend on reactive state, so they are built once per component instance.

  const oceanGeometry = new SphereGeometry(R.ocean, 96, 96);
  const atmosphereGeometry = new SphereGeometry(1.045, 64, 64);
  const starGeometry = starField(1400, 14);
  const portGeometry = new SphereGeometry(0.006, 10, 10);
  const hullGeometry = new SphereGeometry(0.011, 12, 12);
  const glowGeometry = new SphereGeometry(0.028, 12, 12);

  const coastMaterial = new LineBasicMaterial({ color: '#6fc7ff', transparent: true, opacity: 0.75 });
  const borderMaterial = new LineBasicMaterial({ color: '#2f5f8f', transparent: true, opacity: 0.4 });
  const oceanMaterial = new MeshBasicMaterial({ color: '#061627' });
  const portMaterial = new MeshBasicMaterial({ color: '#cfeaff' });
  const hullMaterial = new MeshBasicMaterial({ color: '#f2fbff' });
  const atmosphereMaterial = new MeshBasicMaterial({
    color: '#2d8fd6',
    transparent: true,
    opacity: 0.11,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const starMaterial = new PointsMaterial({
    color: '#9fc4e8',
    size: 0.012,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.6,
  });

  /** Per-route: a hairline core plus a fat translucent tube that reads as bloom. */
  const lanes = ROUTES.map((r) => {
    const curve = new CatmullRomCurve3(r.points.map((p) => new Vector3(...toVector3(p, R.laneHalo))));
    return {
      id: r.id,
      core: polylineGeometry(r.points, R.lane),
      halo: new TubeGeometry(curve, Math.min(600, r.points.length * 2), 0.0045, 6, false),
      coreMaterial: new LineBasicMaterial({
        color: r.color,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      haloMaterial: new MeshBasicMaterial({
        color: r.color,
        transparent: true,
        opacity: 0.16,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    };
  });

  // Selecting a ship dims every other lane. Done by mutating material opacity
  // rather than by swapping materials, so the GPU keeps the same programs.
  $effect(() => {
    const focus = sim.selected?.routeId ?? null;
    for (const lane of lanes) {
      const lit = focus === null || focus === lane.id;
      lane.coreMaterial.opacity = lit ? 0.85 : 0.18;
      lane.haloMaterial.opacity = lit ? 0.16 : 0.03;
    }
  });

  /**
   * Per-ship draw state. Wake geometry gets a fixed vertex count up front and is
   * rewritten in place each frame — reallocating a BufferGeometry sixty times a
   * second per ship would thrash the GPU upload path.
   */
  const wakes = sim.ships.map((ship) => {
    const r = route(ship.routeId);
    const positions = new Float32Array(WAKE_SAMPLES * 3);
    const colors = new Float32Array(WAKE_SAMPLES * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    // Fade to black rather than to alpha 0: under additive blending a black
    // vertex contributes nothing, so this is a true per-vertex falloff, which
    // LineBasicMaterial's single `opacity` could never express.
    const base = new Color(r.color);
    for (let i = 0; i < WAKE_SAMPLES; i++) {
      const f = (i / (WAKE_SAMPLES - 1)) ** 2;
      colors[i * 3] = base.r * f;
      colors[i * 3 + 1] = base.g * f;
      colors[i * 3 + 2] = base.b * f;
    }
    return {
      shipId: ship.id,
      geometry,
      positions,
      material: new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      glowMaterial: new MeshBasicMaterial({
        color: r.color,
        transparent: true,
        opacity: 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    };
  });

  // Hull/glow transforms are written straight onto the Object3D every frame.
  // Routing them through `$state` instead would push sixty reactive updates a
  // second through Svelte for values only three.js ever reads.
  const hullRefs: (Mesh | undefined)[] = [];
  const glowRefs: (Mesh | undefined)[] = [];

  let hovered = $state<string | null>(null);

  useTask(() => {
    for (let i = 0; i < sim.ships.length; i++) {
      const ship = sim.ships[i];
      const [x, y, z] = toVector3(position(ship), R.ship);
      hullRefs[i]?.position.set(x, y, z);
      const glow = glowRefs[i];
      if (glow) {
        glow.position.set(x, y, z);
        const s = sim.selectedId === ship.id ? 1.9 : hovered === ship.id ? 1.45 : 1;
        glow.scale.setScalar(s);
      }

      const r = route(ship.routeId);
      const wake = wakes[i];
      const [from, to] = wakeSpan(ship, WAKE_KM);
      // Always sample tail → ship so the baked colour ramp (dark at index 0,
      // bright at the end) stays correct on the return leg too.
      const tail = ship.direction === 1 ? from : to;
      const head = ship.direction === 1 ? to : from;
      for (let s = 0; s < WAKE_SAMPLES; s++) {
        const t = tail + ((head - tail) * s) / (WAKE_SAMPLES - 1);
        const [wx, wy, wz] = toVector3(pointAt(r, t), R.wake);
        wake.positions[s * 3] = wx;
        wake.positions[s * 3 + 1] = wy;
        wake.positions[s * 3 + 2] = wz;
      }
      wake.geometry.attributes.position.needsUpdate = true;
      wake.geometry.computeBoundingSphere();
    }
  });
</script>

<T.PerspectiveCamera makeDefault position={[0, 1.2, 3.2]} fov={38}>
  <OrbitControls
    enableDamping
    dampingFactor={0.06}
    minDistance={1.25}
    maxDistance={7}
    {autoRotate}
    autoRotateSpeed={0.28}
    enablePan={false}
  />
</T.PerspectiveCamera>

<T.AmbientLight intensity={1} />

<T.Points geometry={starGeometry} material={starMaterial} />

<!-- Ocean sphere + a back-side shell that fakes atmospheric scattering. -->
<T.Mesh geometry={oceanGeometry} material={oceanMaterial} />
<T.Mesh geometry={atmosphereGeometry} material={atmosphereMaterial} />

{#if borderGeometry}
  <T.LineSegments geometry={borderGeometry} material={borderMaterial} />
{/if}
{#if coastGeometry}
  <T.LineSegments geometry={coastGeometry} material={coastMaterial} />
{/if}

<!-- Shipping lanes: tube halo underneath, hairline core on top. -->
{#each lanes as lane (lane.id)}
  <T.Mesh geometry={lane.halo} material={lane.haloMaterial} />
  <T.Line geometry={lane.core} material={lane.coreMaterial} />
{/each}

{#each PORTS as p (p.id)}
  <T.Mesh geometry={portGeometry} material={portMaterial} position={toVector3(p.at, R.port)} />
{/each}

{#each wakes as wake, i (wake.shipId)}
  <T.Line geometry={wake.geometry} material={wake.material} />
  <T.Mesh
    bind:ref={hullRefs[i]}
    geometry={hullGeometry}
    material={hullMaterial}
    onclick={() => sim.select(wake.shipId)}
    onpointerenter={() => (hovered = wake.shipId)}
    onpointerleave={() => (hovered = hovered === wake.shipId ? null : hovered)}
  />
  <T.Mesh bind:ref={glowRefs[i]} geometry={glowGeometry} material={wake.glowMaterial} />
{/each}
