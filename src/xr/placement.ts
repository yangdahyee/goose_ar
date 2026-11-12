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
 * Last-resort floor when none was found. The floor is assumed `cameraHeight` metres below the phone (people hold a
 * phone about 1.1-1.4 m high when looking at the floor), and the duck goes where the centre of the screen meets it,
 * so it shows up where the player is pointing. Looking level or upward (no meeting point within reach) puts it 1.1 m
 * ahead; the distance is kept between 0.7 m and 3 m.
 */
export function estimateFloorPoint(
  camera: THREE.Vector3, forward: THREE.Vector3, cameraHeight = 1.25,
): THREE.Vector3 {
  const floorY = camera.y - cameraHeight;
  const heading = new THREE.Vector3(forward.x, 0, forward.z);
  if (heading.lengthSq() < 1e-4) heading.set(0, 0, -1);      // looking straight down or up: any direction will do
  else heading.normalize();
  let along = 1.1;
  const hit = rayPlaneHit(camera, forward.clone().normalize(), floorY, 4.5);
  if (hit) along = THREE.MathUtils.clamp(Math.hypot(hit.x - camera.x, hit.z - camera.z), 0.7, 3);
  return new THREE.Vector3(camera.x + heading.x * along, floorY, camera.z + heading.z * along);
}
