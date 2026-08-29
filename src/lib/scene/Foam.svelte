<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    InstancedMesh,
    MeshBasicMaterial,
    Object3D,
  } from 'three';
  import { waveHeight } from './waves';

  /**
   * Drifting foam streaks — the same trick hexa-turnos uses for its ocean
   * currents, adapted to ride the shader's surface instead of a flat plane.
   * The ship never actually translates, so this is what tells the eye it is
   * making way: the water streams past it.
   */
  let {
    count = 340,
    radius = 90,
    speed = 7,
    /** Drift direction in world XZ — the reverse of the ship's heading. */
    driftX = 0,
    driftZ = 1,
  }: {
    count?: number;
    radius?: number;
    speed?: number;
    driftX?: number;
    driftZ?: number;
  } = $props();

  // Read once at mount: drift is fixed for the scene, so capturing the initial
  // prop values is intended and avoids re-deriving the basis every frame.
  // svelte-ignore state_referenced_locally
  const len = Math.hypot(driftX, driftZ) || 1;
  // svelte-ignore state_referenced_locally
  const dX = driftX / len;
  // svelte-ignore state_referenced_locally
  const dZ = driftZ / len;
  const pX = -dZ;
  const pZ = dX;
  const driftAngle = Math.atan2(dX, dZ);

  // svelte-ignore state_referenced_locally
  const initialCount = count;
  // svelte-ignore state_referenced_locally
  const initialRadius = radius;

  type Streak = { x: number; z: number; scale: number };
  const streaks: Streak[] = [];
  for (let i = 0; i < initialCount; i++) {
    streaks.push({
      x: (Math.random() * 2 - 1) * initialRadius,
      z: (Math.random() * 2 - 1) * initialRadius,
      scale: 0.5 + Math.random() * 1.5,
    });
  }

  // A narrow triangle whose tip leads the drift once rotated by `driftAngle`.
  const geometry = (() => {
    const geo = new BufferGeometry();
    geo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-0.16, 0, 0, 0.16, 0, 0, 0, 0, 1.5]), 3)
    );
    return geo;
  })();

  const material = new MeshBasicMaterial({
    color: '#dceefa',
    transparent: true,
    opacity: 0.16,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  // $state.raw — three.js mutates instanceMatrix internals on every setMatrixAt,
  // and a deep $state Proxy would treat each of those as a reactive write and
  // loop the task against itself.
  let mesh = $state.raw<InstancedMesh | undefined>();
  const dummy = new Object3D();
  let elapsed = 0;

  useTask((delta) => {
    const instanced = mesh;
    if (!instanced) return;
    elapsed += delta;
    const step = speed * delta;

    for (let i = 0; i < count; i++) {
      const s = streaks[i];
      s.x += dX * step;
      s.z += dZ * step;

      // Recycle anything that has drifted past the trailing edge back to the
      // leading one, with a fresh lateral offset.
      const fwd = s.x * dX + s.z * dZ;
      const lat = s.x * pX + s.z * pZ;
      if (Math.abs(fwd) > radius || Math.abs(lat) > radius) {
        const newLat = (Math.random() * 2 - 1) * radius;
        s.x = -radius * dX + newLat * pX;
        s.z = -radius * dZ + newLat * pZ;
      }

      // Sit the streak on the wave crest it belongs to, a hair above the
      // surface so it never z-fights with the ocean mesh.
      dummy.position.set(s.x, waveHeight(s.x, s.z, elapsed) + 0.06, s.z);
      dummy.rotation.set(0, driftAngle, 0);
      dummy.scale.set(s.scale, 1, s.scale);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
  });
</script>

<T.InstancedMesh bind:ref={mesh} args={[geometry, material, count]} renderOrder={2} />
