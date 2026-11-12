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

/**
 * A hit-test pose has its Y axis along the surface normal. A floor (or a table top) has it pointing up;
 * walls (about 0) and ceilings (-1) must not count as "the floor".
 */
export function facesUp(matrix: ArrayLike<number>, minUp = 0.8): boolean {
  return matrix[5] > minUp;
}

/**
 * Last-resort floor when none was found: a spot `distance` metres ahead (horizontally) and `cameraHeight`
 * metres below the phone. People hold a phone about 1.1-1.4 m high when looking at the floor.
 */
export function estimateFloorPoint(
  camera: THREE.Vector3, forward: THREE.Vector3, distance = 1.1, cameraHeight = 1.25,
): THREE.Vector3 {
  const f = new THREE.Vector3(forward.x, 0, forward.z);
  if (f.lengthSq() < 1e-4) f.set(0, 0, -1);        // looking straight down or up: any direction will do
  else f.normalize();
  return new THREE.Vector3(camera.x + f.x * distance, camera.y - cameraHeight, camera.z + f.z * distance);
}
