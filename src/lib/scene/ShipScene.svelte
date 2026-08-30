<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { Vector3 } from 'three';
  import ContainerShip from './ContainerShip.svelte';
  import Foam from './Foam.svelte';
  import Ocean from './Ocean.svelte';

  /**
   * The close-up. One ship, one sea, one sun — the level of detail the map views
   * deliberately do not have. This is where the game will eventually put port
   * calls, loading and weather; for now it is the visual target.
   *
   * `scale` is the selected ship's LOA relative to the 400 m reference hull
   * `ContainerShip` defaults to (see its own scale note) — a feeder comes out
   * at less than half the size of a ULCV, which is the whole point of tying
   * this scene to whichever ship you clicked rather than always drawing the
   * same boat. Camera presets and orbit limits scale with it too, so framing
   * stays proportional instead of a small hull looking lost in a shot tuned
   * for a 400 m one.
   */
  let {
    cameraPreset = 'quarter',
    scale = 1,
  }: { cameraPreset?: 'quarter' | 'bow' | 'deck' | 'far'; scale?: number } = $props();

  type Preset = { position: [number, number, number]; target: [number, number, number]; fov: number };

  const BASE_PRESETS: Record<'quarter' | 'bow' | 'deck' | 'far', Preset> = {
    quarter: { position: [58, 26, 62], target: [0, 4, 0], fov: 34 },
    bow: { position: [14, 9, -62], target: [0, 6, -14], fov: 40 },
    deck: { position: [0, 16, 26], target: [0, 8, -18], fov: 52 },
    far: { position: [120, 44, 130], target: [0, 2, 0], fov: 28 },
  };

  const preset = $derived.by(() => {
    const base = BASE_PRESETS[cameraPreset];
    return {
      position: base.position.map((v) => v * scale) as [number, number, number],
      target: base.target.map((v) => v * scale) as [number, number, number],
      fov: base.fov,
    };
  });

  const SUN = new Vector3(0.4, 0.5, -0.72).normalize();
  /** Same hue as the background and the shader's horizon fade, so they blend. */
  const HORIZON = '#0a2038';
</script>

<T.FogExp2 attach="fog" args={[HORIZON, 0.0026]} />
<T.Color attach="background" args={[HORIZON]} />

<T.PerspectiveCamera makeDefault position={preset.position} fov={preset.fov} near={0.5} far={2000}>
  <OrbitControls
    enableDamping
    dampingFactor={0.07}
    target={preset.target}
    minDistance={18 * scale}
    maxDistance={340 * scale}
    maxPolarAngle={Math.PI / 2 - 0.03}
  />
</T.PerspectiveCamera>

<!-- Key light stands in for the sun and matches the direction the ocean shader
     uses for its specular highlight, so the ship and the water agree. -->
<T.DirectionalLight
  position={[SUN.x * 120, SUN.y * 120, SUN.z * 120]}
  intensity={2.4}
  color="#fff3e0"
/>
<!-- Bounce off the sea, cool and dim, so shadowed hull sides don't go black. -->
<T.HemisphereLight args={['#8fc4f0', '#0a2436', 1.1]} />
<T.AmbientLight intensity={0.25} />

<Ocean sun={SUN} />
<Foam driftX={0} driftZ={1} />
<ContainerShip length={60 * scale} beam={9 * scale} />
