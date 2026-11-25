import * as THREE from 'three';

/** A pulsing ring on the floor that shows where the duck is heading. Hat-blue, like the "come" button. */
export class TargetMarker {
  readonly mesh: THREE.Mesh;
  private material = new THREE.MeshBasicMaterial({ color: 0x86c0f0, transparent: true, depthWrite: false });

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 40).rotateX(-Math.PI / 2), this.material);
    this.mesh.visible = false;
  }

  /** While true (photo mode) the ring stays hidden, but show() still remembers the spot so it can come back. */
  private suppressed = false;
  private wanted = false;

  show(point: THREE.Vector3) {
    this.mesh.position.copy(point).y += 0.003;
    this.wanted = true;
    this.mesh.visible = !this.suppressed;
  }

  hide() { this.wanted = false; this.mesh.visible = false; }

  /** Hide the ring without forgetting it (photo mode); un-suppressing brings it back if it is still wanted. */
  setSuppressed(on: boolean) {
    this.suppressed = on;
    this.mesh.visible = this.wanted && !on;
  }

  /** `seconds` is any increasing clock. */
  update(seconds: number) {
    if (!this.mesh.visible) return;
    const p = (seconds % 1);                 // 1 s pulse: grows and fades
    this.mesh.scale.setScalar(0.8 + 0.7 * p);
    this.material.opacity = 0.95 * (1 - p * p);
  }
}
