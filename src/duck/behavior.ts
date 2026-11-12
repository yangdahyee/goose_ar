import * as THREE from 'three';
import { GO_STOP_DISTANCE_M, STOP_DISTANCE_M, TURN_RATE, WALK_SPEED_MULT, WALK_UNITS_PER_SEC } from '../config';
import type { Duck } from './duck';
import { stepToward, turnToward } from './motion';

/** walk = coming to the player, go = walking to a tapped spot. Both use the Walk clip. */
export type DuckState = 'idle' | 'walk' | 'go' | 'dance';
const CLIP: Record<DuckState, string> = { idle: 'Idle', walk: 'Walk', go: 'Walk', dance: 'Dance' };
const WATCH_TURN_RATE = 2; // rad/s: slowly keeps facing the player while idle or dancing

/** Idle -> come -> Walk -> Idle;  Idle -> tap -> Go -> Idle;  Idle -> dance -> Dance -> Idle. */
export class DuckBehavior {
  state: DuckState = 'idle';
  private goal = new THREE.Vector2(); // x, z of the tapped spot

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
  goTo(point: THREE.Vector3) {
    this.goal.set(point.x, point.z);
    this.setState('go');
  }
  dance() { if (this.state !== 'dance') this.setState('dance'); }

  /** `player` is the camera position in world space. */
  update(dt: number, player: THREE.Vector3) {
    const root = this.duck.root;
    if (this.state === 'walk' || this.state === 'go') {
      const speed = WALK_UNITS_PER_SEC * WALK_SPEED_MULT * root.scale.x;
      const toPlayer = this.state === 'walk';
      const tx = toPlayer ? player.x : this.goal.x;
      const tz = toPlayer ? player.z : this.goal.y;
      const stop = toPlayer ? STOP_DISTANCE_M : GO_STOP_DISTANCE_M;
      const s = stepToward(root.position.x, root.position.z, root.rotation.y, tx, tz, dt, speed, TURN_RATE, stop);
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
