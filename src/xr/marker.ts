import * as THREE from 'three';

/** A pulsing ring on the floor that shows where the duck is heading. */
export class TargetMarker {
  readonly mesh: THREE.Mesh;
  private material = new THREE.MeshBasicMaterial({ color: 0xf08a2e, transparent: true, depthWrite: false });

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 40).rotateX(-Math.PI / 2), this.material);
    this.mesh.visible = false;
  }

  show(point: THREE.Vector3) {
    this.mesh.position.copy(point).y += 0.003;
    this.mesh.visible = true;
  }

  hide() { this.mesh.visible = false; }

  /** `seconds` is any increasing clock. */
  update(seconds: number) {
    if (!this.mesh.visible) return;
    const p = (seconds % 1);                 // 1 s pulse: grows and fades
    this.mesh.scale.setScalar(0.8 + 0.7 * p);
    this.material.opacity = 0.95 * (1 - p * p);
  }
}
