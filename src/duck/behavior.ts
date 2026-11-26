import * as THREE from 'three';
import {
  GO_STOP_DISTANCE_M, LOOK_ANGLE_RAD, LOOK_FIRST_S, LOOK_SECOND_S, LOOK_TURN_RATE, STOP_DISTANCE_M, TURN_RATE,
  WALK_SPEED_MULT, WALK_UNITS_PER_SEC,
} from '../config';
import type { Duck } from './duck';
import { lookAroundYaw, stepToward, turnToward } from './motion';

/** walk = coming to the player, go = walking to a tapped spot. Both use the Walk clip. */
export type DuckState = 'idle' | 'walk' | 'go' | 'dance';
const CLIP: Record<DuckState, string> = { idle: 'Idle', walk: 'Walk', go: 'Walk', dance: 'Dance' };
const WATCH_TURN_RATE = 2; // rad/s: slowly keeps facing the player while idle or dancing

/** Idle -> come -> Walk -> Idle;  Idle -> tap -> Go -> Idle;  Idle -> dance -> Dance -> Idle. After a walk it looks around, then faces the player. */
export class DuckBehavior {
  state: DuckState = 'idle';
  private goal = new THREE.Vector2(); // x, z of the tapped spot
  /** Set on arrival: the heading it arrived with, which side it looks at first, and how long it has been looking. */
  private look: { base: number; side: 1 | -1; t: number } | null = null;

  constructor(private duck: Duck, private onState: (s: DuckState, prev: DuckState) => void) {
    duck.setTimeScale(CLIP.walk, WALK_SPEED_MULT);
    duck.onFinished((clip) => {
      if (clip === CLIP.dance && this.state === 'dance') this.setState('idle');
    });
  }

  setState(next: DuckState) {
    const prev = this.state;
    this.state = next;
    // Arriving (not just being placed, not after a dance) starts a look around; any other change cancels it.
    this.look = next === 'idle' && (prev === 'walk' || prev === 'go')
      ? { base: this.duck.root.rotation.y, side: Math.random() < 0.5 ? 1 : -1, t: 0 }
      : null;
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
      const toPlayer = Math.atan2(player.x - root.position.x, player.z - root.position.z);
      let aim = toPlayer, rate = WATCH_TURN_RATE;
      if (this.look && this.state === 'idle') {
        this.look.t += dt;
        const around = lookAroundYaw(this.look.base, this.look.t, this.look.side, LOOK_ANGLE_RAD, LOOK_FIRST_S, LOOK_SECOND_S);
        if (around === null) this.look = null;
        else { aim = around; rate = LOOK_TURN_RATE; }
      }
      root.rotation.y = turnToward(root.rotation.y, aim, rate, dt);
    }
  }
}
