import * as THREE from 'three';

/**
 * Sun light plus an invisible floor that only shows the duck's shadow, so the duck looks grounded
 * on the camera image. It follows the duck's position and scale but never its rotation, so the
 * shadow direction stays put when the duck turns.
 */
export class ShadowRig {
  readonly group = new THREE.Group();
  readonly light = new THREE.DirectionalLight(0xffffff, 1.5);

  constructor() {
    const { light } = this;
    light.position.set(3, 6, 4); // model units, relative to the duck
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -4;
    cam.right = cam.top = 4;
    cam.near = 0.5;
    cam.far = 20;
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
    this.group.add(light, light.target);

    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    catcher.position.y = 0.002;
    catcher.receiveShadow = true;
    this.group.add(catcher);
  }

  follow(target: THREE.Object3D) {
    this.group.visible = target.visible;
    this.group.position.copy(target.position);
    this.group.scale.copy(target.scale);
  }
}
