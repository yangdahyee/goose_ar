import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Duck {
  /** Put this in the scene. Feet are at y = 0, the duck faces +Z. */
  root: THREE.Group;
  /** Model height in model units (hat included). */
  heightUnits: number;
  clips: string[];
  play(name: string, fade?: number): void;
  setTimeScale(clip: string, scale: number): void;
  /** Called when a non-looping clip (Dance) reaches its end. */
  onFinished(cb: (clip: string) => void): void;
  update(dt: number): void;
  /** Debug: show `clip` frozen at `time` seconds. */
  freezeAt(clip: string, time: number): void;
  /** Scale so the duck is `metres` tall (1 unit = 1 m when scale is 1). */
  setHeight(metres: number): void;
}

export async function loadDuck(url: string): Promise<Duck> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = new THREE.Group();
  root.add(gltf.scene);

  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh.material as THREE.Material).transparent) mesh.castShadow = true;
  });

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const heightUnits = box.max.y - box.min.y;

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    if (clip.name === 'Dance') {            // one pass, then the behaviour returns to Idle
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions.set(clip.name, action);
  }
  let current: THREE.AnimationAction | undefined;

  return {
    root,
    heightUnits,
    clips: [...actions.keys()],
    play(name, fade = 0.25) {
      const next = actions.get(name);
      if (!next || (next === current && next.isRunning())) return;
      next.reset().fadeIn(fade).play();
      if (current && current !== next) current.fadeOut(fade);
      current = next;
    },
    setTimeScale(name, scale) { actions.get(name)?.setEffectiveTimeScale(scale); },
    onFinished(cb) {
      mixer.addEventListener('finished', (e) => {
        const name = [...actions].find(([, a]) => a === (e as unknown as { action: THREE.AnimationAction }).action)?.[0];
        if (name) cb(name);
      });
    },
    update: (dt) => mixer.update(dt),
    freezeAt(name, time) {
      const a = actions.get(name);
      if (!a) return;
      a.reset().play();
      a.time = time;
      a.paused = true;
      current = a;
      mixer.update(0);
    },
    setHeight(metres) {
      root.scale.setScalar(metres / heightUnits);
    },
  };
}
