import * as THREE from 'three';
import { STOP_DISTANCE_M, TURN_RATE, WALK_SPEED_MULT, WALK_UNITS_PER_SEC } from '../config';
import type { Duck } from './duck';
import { stepToward, turnToward } from './motion';

export type DuckState = 'idle' | 'walk' | 'dance';
const CLIP: Record<DuckState, string> = { idle: 'Idle', walk: 'Walk', dance: 'Dance' };
const WATCH_TURN_RATE = 2; // rad/s: slowly keeps facing the player while idle or dancing

/** Idle -> (come) -> Walk -> arrive -> Idle;  Idle -> (dance) -> Dance -> end -> Idle. */
export class DuckBehavior {
  state: DuckState = 'idle';

  constructor(private duck: Duck, private onState: (s: DuckState, prev: DuckState) => void) {
    duck.setTimeScale(CLIP.walk, WALK_SPEED_MULT);
    duck.onFinished((clip) => {
      if (clip === CLIP.dance && this.state === 'dance') this.setState('idle');
    });
  }

  setState(next: DuckState) {
    const prev = this.state;
    this.state = next;
    this.duck.play(CLIP[next]);
    this.onState(next, prev);
  }

  callToMe() { this.setState('walk'); }
  dance() { if (this.state !== 'dance') this.setState('dance'); }

  /** `player` is the camera position in world space. */
  update(dt: number, player: THREE.Vector3) {
    const root = this.duck.root;
    if (this.state === 'walk') {
      const speed = WALK_UNITS_PER_SEC * WALK_SPEED_MULT * root.scale.x;
      const s = stepToward(root.position.x, root.position.z, root.rotation.y, player.x, player.z, dt, speed, TURN_RATE, STOP_DISTANCE_M);
      root.position.x = s.x;
      root.position.z = s.z;
      root.rotation.y = s.yaw;
      if (s.arrived) this.setState('idle');
    } else {
      const desired = Math.atan2(player.x - root.position.x, player.z - root.position.z);
      root.rotation.y = turnToward(root.rotation.y, desired, WATCH_TURN_RATE, dt);
    }
  }
}
