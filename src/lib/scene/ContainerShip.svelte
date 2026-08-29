<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import {
    BoxGeometry,
    BufferAttribute,
    Color,
    CylinderGeometry,
    ExtrudeGeometry,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Shape,
    SphereGeometry,
  } from 'three';
  import { waveHeight, waveSlope } from './waves';

  /**
   * A neopanamax box boat, built out of primitives the way hexa-turnos builds
   * its hulls — no glTF to load, so the whole scene is a few kilobytes of code.
   *
   * Scale: the hull is 60 world units for a 400 m ship, i.e. 1 unit ≈ 6.7 m.
   * Every dimension below is derived from that, which is why the containers come
   * out at roughly a third of a unit wide.
   */
  let { length = 60, beam = 9 }: { length?: number; beam?: number } = $props();

  // Read once, deliberately. Every buffer below is derived from these two
  // numbers and uploaded to the GPU at mount; making them reactive would rebuild
  // the hull and 2k container instances on any parent re-render for no gain.
  // svelte-ignore state_referenced_locally
  const LOA = length;
  // svelte-ignore state_referenced_locally
  const BEAM = beam;

  const DECK_Y = 1.8;
  const KEEL_Y = -3.2;
  const UNIT = LOA / 400; // world units per metre

  // ---- hull ---------------------------------------------------------------
  // Plan-view outline extruded downwards. Extrusion runs along the shape's +Z,
  // and `rotateX(-90°)` turns that into world +Y, so the shape's second axis
  // becomes -Z: the bow tip lands at z = -LOA/2 and the ship faces -Z.
  const hullGeometry = (() => {
    const halfBeam = BEAM / 2;
    const halfLen = LOA / 2;
    const shape = new Shape();
    shape.moveTo(0, halfLen);
    shape.quadraticCurveTo(halfBeam * 0.75, halfLen * 0.86, halfBeam, halfLen * 0.5);
    shape.lineTo(halfBeam, -halfLen * 0.78);
    shape.quadraticCurveTo(halfBeam, -halfLen, halfBeam * 0.62, -halfLen);
    shape.lineTo(-halfBeam * 0.62, -halfLen);
    shape.quadraticCurveTo(-halfBeam, -halfLen, -halfBeam, -halfLen * 0.78);
    shape.lineTo(-halfBeam, halfLen * 0.5);
    shape.quadraticCurveTo(-halfBeam * 0.75, halfLen * 0.86, 0, halfLen);

    const geo = new ExtrudeGeometry(shape, {
      depth: DECK_Y - KEEL_Y,
      bevelEnabled: true,
      bevelThickness: 0.35,
      bevelSize: 0.35,
      bevelSegments: 2,
      curveSegments: 12,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, KEEL_Y, 0);

    // Paint the boot-top straight into the vertex colours: everything under the
    // waterline is anti-fouling red, everything above is hull blue. Cheaper and
    // crisper than a texture, and it survives any zoom.
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const below = new Color('#7c2b21');
    const above = new Color('#132a44');
    const boot = new Color('#0d1a29');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const c = y < -0.35 ? below : y < 0.35 ? boot : above;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  })();

  const hullMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.15,
  });

  // Bulbous bow — the giveaway that this is a modern merchant hull.
  const bulbGeometry = new SphereGeometry(1.5, 20, 14);
  bulbGeometry.scale(0.85, 0.8, 2.1);
  const bulbMaterial = new MeshStandardMaterial({ color: '#7c2b21', roughness: 0.7 });

  // Kept well inside the hull outline: a full-length rectangle pokes out either
  // side of the bow, where the hull has already narrowed to a point.
  const deckGeometry = new BoxGeometry(BEAM * 0.9, 0.25, LOA * 0.55);
  const deckMaterial = new MeshStandardMaterial({ color: '#2c3a46', roughness: 0.9 });

  // ---- containers ---------------------------------------------------------
  // One InstancedMesh for the whole deck load. A real 400 m ship carries north
  // of twenty rows across, which is far too many to model as separate meshes but
  // trivial as instances.
  const BOX = { w: 2.44 * UNIT, h: 2.59 * UNIT, l: 12.2 * UNIT };
  const CONTAINER_COLORS = [
    '#b5432f', '#1f6f9c', '#3f7f52', '#c07a1f', '#8b8f97',
    '#7a3f6d', '#2f4f7a', '#a8452f',
  ].map((c) => new Color(c));

  const containers = (() => {
    const rows = Math.floor((BEAM * 0.92) / (BOX.w * 1.06));
    const bays = Math.floor((LOA * 0.74) / (BOX.l * 1.05));
    const dummy = new Object3D();
    const matrices: Matrix4[] = [];
    const colors: Color[] = [];

    // Deterministic pseudo-random so the stack profile is stable across reloads
    // — a hull whose cargo reshuffles every refresh looks broken.
    const noise = (a: number, b: number) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let bay = 0; bay < bays; bay++) {
      // Bays start just aft of the forecastle and stop before the deckhouse.
      const z = -LOA * 0.43 + bay * BOX.l * 1.05 + BOX.l / 2;
      // The bow narrows, so the forward bays carry fewer rows.
      const taper = Math.min(1, 0.35 + (bay / bays) * 1.6);
      const rowsHere = Math.max(2, Math.round(rows * taper));
      for (let row = 0; row < rowsHere; row++) {
        const x = (row - (rowsHere - 1) / 2) * BOX.w * 1.06;
        const n = noise(bay, row);
        if (n < 0.06) continue; // an empty slot
        const tiers = 2 + Math.floor(n * 4);
        for (let tier = 0; tier < tiers; tier++) {
          dummy.position.set(x, DECK_Y + 0.15 + BOX.h * (tier + 0.5) * 1.03, z);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
          colors.push(CONTAINER_COLORS[Math.floor(noise(bay + tier * 7, row * 3) * CONTAINER_COLORS.length)]);
        }
      }
    }
    return { matrices, colors };
  })();

  const containerGeometry = new BoxGeometry(BOX.w * 0.94, BOX.h * 0.94, BOX.l * 0.98);
  const containerMaterial = new MeshStandardMaterial({ roughness: 0.78, metalness: 0.08 });
  let containerMesh = $state.raw<InstancedMesh | undefined>();

  $effect(() => {
    const mesh = containerMesh;
    if (!mesh) return;
    for (let i = 0; i < containers.matrices.length; i++) {
      mesh.setMatrixAt(i, containers.matrices[i]);
      mesh.setColorAt(i, containers.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  // ---- superstructure -----------------------------------------------------
  const houseGeometry = new BoxGeometry(BEAM * 0.72, 4.2, 3.6);
  const bridgeGeometry = new BoxGeometry(BEAM * 1.02, 0.95, 2.6);
  const windowGeometry = new BoxGeometry(BEAM * 1.03, 0.42, 2.66);
  const funnelGeometry = new CylinderGeometry(0.78, 0.95, 2.8, 16);
  const houseMaterial = new MeshStandardMaterial({ color: '#e8eef4', roughness: 0.72 });
  const windowMaterial = new MeshStandardMaterial({
    color: '#0a1a2a',
    roughness: 0.15,
    metalness: 0.6,
  });
  const funnelMaterial = new MeshStandardMaterial({ color: '#1d3a5c', roughness: 0.6 });

  const houseZ = LOA * 0.355;

  // ---- motion -------------------------------------------------------------
  // The hull is not animated by a canned sine: it samples the *actual* sea
  // surface at four points and solves heave, pitch and roll from them, so it
  // physically sits in the water the shader is drawing.
  let group = $state.raw<Group | undefined>();
  let elapsed = 0;

  useTask((delta) => {
    elapsed += delta;
    const g = group;
    if (!g) return;

    const half = LOA / 2;
    const bow = waveHeight(0, -half * 0.8, elapsed);
    const stern = waveHeight(0, half * 0.8, elapsed);
    const port = waveHeight(-BEAM / 2, 0, elapsed);
    const starboard = waveHeight(BEAM / 2, 0, elapsed);

    // Heave: the mean of the four probes, damped — a 400 m hull bridges short
    // chop instead of following every crest.
    g.position.y = (bow + stern + port + starboard) * 0.25 * 0.75;

    // Pitch from the bow/stern difference, roll from port/starboard, both
    // scaled well below the geometric slope for the same inertia reason.
    const pitch = Math.atan2(stern - bow, half * 1.6) * 0.55;
    const roll = Math.atan2(starboard - port, BEAM) * 0.35;
    g.rotation.x = pitch;
    g.rotation.z = roll;

    // A slow yaw wander so the ship never looks pinned to an axis.
    const [slopeX] = waveSlope(0, 0, elapsed);
    g.rotation.y = slopeX * 0.05;
  });
</script>

<T.Group bind:ref={group}>
  <T.Mesh geometry={hullGeometry} material={hullMaterial} castShadow />
  <T.Mesh
    geometry={bulbGeometry}
    material={bulbMaterial}
    position={[0, -1.9, -LOA / 2 - 0.4]}
  />
  <T.Mesh geometry={deckGeometry} material={deckMaterial} position={[0, DECK_Y + 0.12, 0]} />

  <T.InstancedMesh
    bind:ref={containerMesh}
    args={[containerGeometry, containerMaterial, containers.matrices.length]}
    castShadow
  />

  <!-- Deckhouse: block, glazed bridge band, wing bridges, funnel. -->
  <T.Mesh
    geometry={houseGeometry}
    material={houseMaterial}
    position={[0, DECK_Y + 2.1, houseZ]}
    castShadow
  />
  <T.Mesh
    geometry={bridgeGeometry}
    material={houseMaterial}
    position={[0, DECK_Y + 4.68, houseZ - 0.5]}
  />
  <T.Mesh
    geometry={windowGeometry}
    material={windowMaterial}
    position={[0, DECK_Y + 4.72, houseZ - 0.55]}
  />
  <T.Mesh
    geometry={funnelGeometry}
    material={funnelMaterial}
    position={[0, DECK_Y + 5.6, houseZ + 2.6]}
  />
</T.Group>
