import * as THREE from 'three';
import type { Duck } from '../duck/duck';
import type { Look } from '../duck/looks';
import { LOOKS } from '../duck/looks';

/**
 * First-visit screen: one live 3D duck per look. All previews are drawn by the app's single renderer, each into the
 * screen rectangle of its card (scissor + viewport), so no extra WebGL context is needed.
 */
export class LookPicker {
  active = false;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  private cards: { look: Look; stage: HTMLElement; duck: Duck }[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    private root: HTMLElement,
    env: THREE.Texture,
    background: THREE.Color,
    makeDuck: () => Duck,
    private onPick: (look: Look) => void,
  ) {
    this.scene.background = background;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);

    for (const look of LOOKS) {
      const button = root.querySelector<HTMLElement>(`.pick[data-look="${look}"]`);
      const stage = button?.querySelector<HTMLElement>('.stage');
      if (!button || !stage) continue;
      const duck = makeDuck();
      duck.setLook(look);
      duck.play('Idle', 0);
      this.scene.add(duck.root);
      this.cards.push({ look, stage, duck });
      button.addEventListener('click', () => this.onPick(look));
    }
  }

  open() { this.active = true; this.root.hidden = false; }
  close() { this.active = false; this.root.hidden = true; }

  /** Frame the duck for a stage of this aspect ratio (it must fit both its height and its hat brim). */
  private frame(aspect: number) {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(3.5 / (2 * t), 2.9 / (2 * t * aspect)) * 1.05;
    this.camera.aspect = aspect;
    this.camera.position.set(0, 1.55 + dist * 0.12, dist);
    this.camera.lookAt(0, 1.5, 0);
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, time: number) {
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, innerWidth, innerHeight);
    r.clear();
    r.setScissorTest(true);
    for (const c of this.cards) c.duck.update(dt);
    this.cards.forEach((card, i) => {
      const rect = card.stage.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      this.cards.forEach((c, j) => { c.duck.root.visible = i === j; });
      card.duck.root.rotation.y = Math.sin(time * 0.9 + i) * 0.55;   // gentle turn so the finish shows
      const y = innerHeight - rect.bottom;
      r.setViewport(rect.left, y, rect.width, rect.height);
      r.setScissor(rect.left, y, rect.width, rect.height);
      this.frame(rect.width / rect.height);
      r.render(this.scene, this.camera);
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, innerWidth, innerHeight);
  }
}
