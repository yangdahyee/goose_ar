export interface Step { x: number; z: number; yaw: number; arrived: boolean }

const TAU = Math.PI * 2;
export const wrapPi = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rotate toward `desired` (rad) at most `rate * dt`. */
export function turnToward(yaw: number, desired: number, rate: number, dt: number): number {
  return yaw + clamp(wrapPi(desired - yaw), -rate * dt, rate * dt);
}

/**
 * One walking step on the floor plane. The duck faces +Z at yaw 0 (forward = (sin yaw, cos yaw)).
 * It turns toward the target first and slows down for sharp turns; it never goes closer than `stopDist`.
 */
export function stepToward(
  x: number, z: number, yaw: number,
  tx: number, tz: number,
  dt: number, speed: number, turnRate: number, stopDist: number,
): Step {
  const dx = tx - x, dz = tz - z;
  const dist = Math.hypot(dx, dz);
  if (dist <= stopDist) return { x, z, yaw, arrived: true };

  const desired = Math.atan2(dx, dz);
  const newYaw = turnToward(yaw, desired, turnRate, dt);
  const misalign = wrapPi(desired - newYaw);
  const move = Math.min(Math.max(0, Math.cos(misalign)) * speed * dt, dist - stopDist);
  return { x: x + Math.sin(newYaw) * move, z: z + Math.cos(newYaw) * move, yaw: newYaw, arrived: false };
}
