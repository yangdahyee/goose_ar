import * as THREE from 'three';
import type { Duck } from '../duck/duck';
import { LIGHTING, LOOKS, type Look } from '../duck/looks';

/**
 * First-visit screen: one live 3D duck per choice. All previews are drawn by the app's single renderer, each into the
 * screen rectangle of its card (scissor + viewport), so no extra WebGL context is needed.
 */
export class LookPicker {
  active = false;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 0.5);
  private sun = new THREE.DirectionalLight(0xffffff, 1.5);
  private cards: { look: Look; button: HTMLButtonElement; stage: HTMLElement; duck?: Duck }[] = [];

  /**
   * The screen opens at once with every card in a "loading" state; each card fills in when its duck is ready
   * (setDuck) or says so when it could not be loaded (fail). Nothing is blank while a model downloads.
   */
  constructor(
    private renderer: THREE.WebGLRenderer,
    private root: HTMLElement,
    env: THREE.Texture | null,
    background: THREE.Color,
    private onPick: (look: Look) => void,
  ) {
    this.scene.background = background;
    this.scene.environment = env;
    this.sun.position.set(3, 6, 4);
    this.scene.add(this.hemi, this.sun);

    for (const look of LOOKS) {
      const button = root.querySelector<HTMLButtonElement>(`.pick[data-look="${look}"]`);
      const stage = button?.querySelector<HTMLElement>('.stage');
      if (!button || !stage) continue;
      this.cards.push({ look, button, stage });
      button.addEventListener('click', () => { if (!button.disabled) this.onPick(look); });
    }
  }

  setDuck(look: Look, duck: Duck) {
    const card = this.cards.find((c) => c.look === look);
    if (!card) return;
    card.duck?.root.removeFromParent();
    duck.play('Idle', 0);
    this.scene.add(duck.root);
    card.duck = duck;
    card.button.disabled = false;
    card.button.classList.remove('loading', 'failed');
  }

  fail(look: Look) {
    const card = this.cards.find((c) => c.look === look);
    if (!card || card.duck) return;
    card.button.disabled = true;
    card.button.classList.remove('loading');
    card.button.classList.add('failed');
  }

  /** The preview ducks, e.g. to swap their materials. */
  ducks(): Duck[] { return this.cards.flatMap((c) => (c.duck ? [c.duck] : [])); }

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
    for (const c of this.cards) c.duck?.update(dt);
    this.cards.forEach((card, i) => {
      const duck = card.duck;
      if (!duck) return;                                                // still loading: the card shows its own text
      const rect = card.stage.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      this.cards.forEach((c, j) => { if (c.duck) c.duck.root.visible = i === j; });
      const light = card.look === 'glass' && !this.scene.environment ? LIGHTING.plain : LIGHTING[card.look]; // lit the way it is in the app
      this.scene.environmentIntensity = light.env;
      this.hemi.intensity = light.hemi;
      this.sun.intensity = light.sun;
      duck.root.rotation.y = Math.sin(time * 0.9 + i) * 0.55;   // gentle turn so the finish shows
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
