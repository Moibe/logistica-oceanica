import { Vector4 } from 'three';

/**
 * One sum-of-sines sea surface, defined once and evaluated twice: on the GPU by
 * the ocean's vertex shader, and on the CPU by `waveHeight` so the hull can ride
 * the *same* surface it is floating on. Keeping a single source of truth is the
 * whole point — a ship bobbing to its own private sine wave slides visibly in
 * and out of the water.
 *
 * Each wave is deep-water: phase speed is not a free parameter but
 * `sqrt(g / k)`, so longer swells outrun the short chop the way real ones do.
 */
export type Wave = {
  /** Travel direction in world XZ (normalised on construction). */
  dirX: number;
  dirZ: number;
  /** Crest-to-mean height in world units. */
  amp: number;
  /** Wavelength in world units. */
  length: number;
};

const G = 9.81;

const RAW: Wave[] = [
  { dirX: 1.0, dirZ: 0.22, amp: 0.62, length: 62 },
  { dirX: 0.72, dirZ: -0.68, amp: 0.34, length: 31 },
  { dirX: -0.35, dirZ: 0.94, amp: 0.17, length: 14.5 },
  { dirX: 0.9, dirZ: 0.44, amp: 0.075, length: 6.2 },
];

export const WAVES: Wave[] = RAW.map((w) => {
  const len = Math.hypot(w.dirX, w.dirZ) || 1;
  return { ...w, dirX: w.dirX / len, dirZ: w.dirZ / len };
});

/** Packed for the shader: (dirX, dirZ, amplitude, wave number k). */
export const WAVE_UNIFORM: Vector4[] = WAVES.map(
  (w) => new Vector4(w.dirX, w.dirZ, w.amp, (Math.PI * 2) / w.length)
);

export const WAVE_COUNT = WAVES.length;

/** Surface height at a world XZ at time `t` — the CPU twin of the vertex shader. */
export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.length;
    const speed = Math.sqrt(G / k);
    h += w.amp * Math.sin((w.dirX * x + w.dirZ * z) * k + t * speed * k);
  }
  return h;
}

/** Surface slope at a world XZ, as (dH/dx, dH/dz). Drives the hull's pitch and roll. */
export function waveSlope(x: number, z: number, t: number): [number, number] {
  let dx = 0;
  let dz = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.length;
    const speed = Math.sqrt(G / k);
    const c = Math.cos((w.dirX * x + w.dirZ * z) * k + t * speed * k) * w.amp * k;
    dx += c * w.dirX;
    dz += c * w.dirZ;
  }
  return [dx, dz];
}

/**
 * GLSL twin of `waveHeight` / `waveSlope`. Returns the displaced height in `.x`
 * and the two slope components in `.yz`, so the fragment stage gets a proper
 * analytic normal instead of a finite-difference approximation.
 */
export const WAVE_GLSL = /* glsl */ `
  uniform vec4 uWaves[${WAVE_COUNT}];
  uniform float uTime;

  const float G = 9.81;

  vec3 sampleSea(vec2 p) {
    float h = 0.0;
    float dx = 0.0;
    float dz = 0.0;
    for (int i = 0; i < ${WAVE_COUNT}; i++) {
      vec2 dir = uWaves[i].xy;
      float amp = uWaves[i].z;
      float k = uWaves[i].w;
      float speed = sqrt(G / k);
      float phase = dot(dir, p) * k + uTime * speed * k;
      h += amp * sin(phase);
      float c = cos(phase) * amp * k;
      dx += c * dir.x;
      dz += c * dir.y;
    }
    return vec3(h, dx, dz);
  }
`;
