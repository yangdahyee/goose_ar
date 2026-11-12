import * as THREE from 'three';

/** Rotation about Y so that something facing +Z looks at `target` from `from` (horizontal only). */
export function yawToward(from: THREE.Vector3, target: THREE.Vector3): number {
  return Math.atan2(target.x - from.x, target.z - from.z);
}
