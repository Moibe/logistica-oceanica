<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { Color, DoubleSide, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
  import { WAVE_COUNT, WAVE_GLSL, WAVE_UNIFORM } from './waves';

  /**
   * The sea. A single large plane displaced in the vertex shader by the shared
   * sum-of-sines, shaded with an analytic normal — no normal map, no texture, so
   * it stays sharp at any camera distance and costs nothing to load.
   *
   * The grid is denser near the origin than at the rim: the plane is 700 units
   * across but the camera never leaves the middle 60, so vertices are spent
   * where the ship is and the horizon gets by on very few.
   */
  let {
    size = 700,
    segments = 340,
    sun = new Vector3(0.4, 0.55, -0.7),
  }: { size?: number; segments?: number; sun?: Vector3 } = $props();

  // Baked into the shader uniforms at mount — the sun does not move during a
  // scene, and re-uploading the uniform every render would be pure churn.
  // svelte-ignore state_referenced_locally
  const SUN_DIRECTION = sun.clone().normalize();

  const geometry = (() => {
    const geo = new PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    // Warp the grid outwards to spend vertices near the ship. The exponent is
    // deliberately mild: at 2.2 the outermost ring jumped from ~100 to ~450
    // units, and the wave displacement across that gap drew a jagged black
    // ridge along the horizon.
    const pos = geo.attributes.position;
    const half = size / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / half;
      const z = pos.getZ(i) / half;
      pos.setX(i, Math.sign(x) * Math.abs(x) ** 1.7 * half);
      pos.setZ(i, Math.sign(z) * Math.abs(z) ** 1.7 * half);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    return geo;
  })();

  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      uWaves: { value: WAVE_UNIFORM },
      uTime: { value: 0 },
      uSun: { value: SUN_DIRECTION },
      uDeep: { value: new Color('#062338') },
      uShallow: { value: new Color('#1b83b4') },
      uFoam: { value: new Color('#cfe9ff') },
      uSky: { value: new Color('#0a2038') },
    },
    vertexShader: /* glsl */ `
      ${WAVE_GLSL}

      varying vec3 vWorld;
      varying vec3 vNormal;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 sea = sampleSea(world.xz);
        world.y += sea.x;
        // Analytic normal straight out of the height derivatives.
        vNormal = normalize(vec3(-sea.y, 1.0, -sea.z));
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uSun;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      uniform vec3 uSky;

      varying vec3 vWorld;
      varying vec3 vNormal;

      void main() {
        vec3 n = normalize(vNormal);
        vec3 view = normalize(cameraPosition - vWorld);

        // Fresnel: grazing angles reflect the sky, steep angles show the depth.
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.2);

        float diffuse = max(dot(n, uSun), 0.0);
        vec3 halfway = normalize(uSun + view);
        float specular = pow(max(dot(n, halfway), 0.0), 220.0);

        // Crests catch a little foam. The tilt term (1.0 - n.y) is near zero on
        // flat water and grows as the surface steepens, so the window has to sit
        // low — a threshold up near 1.0 would never trigger on a sea this gentle.
        float steep = smoothstep(0.06, 0.22, 1.0 - n.y);

        vec3 water = mix(uDeep, uShallow, diffuse * 0.8);
        vec3 color = mix(water, uSky, fresnel * 0.8);
        color += uFoam * steep * 0.5;
        color += vec3(1.0, 0.96, 0.88) * specular * 1.6;

        // Fade the far rim into the background so the plane has no visible edge.
        float dist = length(vWorld.xz);
        color = mix(color, uSky, smoothstep(80.0, 250.0, dist));

        gl_FragColor = vec4(color, 1.0);

        // three's Color converts every hex to LINEAR working space, and a raw
        // ShaderMaterial writes straight to the framebuffer — without this chunk
        // the sea ships out linear values that the display reads as sRGB, which
        // is why it looked several stops too dark and never matched the scene
        // background set from the same hex.
        #include <colorspace_fragment>
      }
    `,
  });

  // Sanity check kept close to the shader: the uniform array length is baked
  // into the GLSL loop bound, so a mismatch would fail at link time in a way
  // that is miserable to read.
  if (WAVE_UNIFORM.length !== WAVE_COUNT) {
    throw new Error('WAVE_UNIFORM y WAVE_COUNT no coinciden');
  }

  useTask((delta) => {
    material.uniforms.uTime.value += delta;
  });
</script>

<T.Mesh {geometry} {material} receiveShadow={false} />
