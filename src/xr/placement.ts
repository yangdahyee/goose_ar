import * as THREE from 'three';

/** Rotation about Y so that something facing +Z looks at `target` from `from` (horizontal only). */
export function yawToward(from: THREE.Vector3, target: THREE.Vector3): number {
  return Math.atan2(target.x - from.x, target.z - from.z);
}

/** Where a ray (e.g. from a screen tap) meets the horizontal plane y = planeY, or null if it never does within maxDist. */
export function rayPlaneHit(
  origin: THREE.Vector3, dir: THREE.Vector3, planeY: number, maxDist: number,
): THREE.Vector3 | null {
  if (dir.y > -1e-3) return null;             // pointing level or upward: no floor there
  const t = (planeY - origin.y) / dir.y;
  if (t <= 0 || t > maxDist) return null;
  return origin.clone().addScaledVector(dir, t);
}
