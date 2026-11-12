import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyLook, type Look } from './looks';

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
  /** Switch the surface look (glass / plain). */
  setLook(look: Look): void;
  /** An independent copy (own materials and animation), e.g. for the look picker. Shares geometry. */
  clone(): Duck;
}

export async function loadDuck(url: string): Promise<Duck> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return buildDuck(gltf, false);
}

function buildDuck(gltf: GLTF, copy: boolean): Duck {
  const scene = copy ? cloneScene(gltf.scene) : gltf.scene;
  if (copy) {
    // a copy must not share materials, or changing its look would change the original's
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone();
    });
  }
  const root = new THREE.Group();
  root.add(scene);

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(mesh.material as THREE.Material).transparent) mesh.castShadow = true;
  });

  const box = new THREE.Box3().setFromObject(scene);
  const heightUnits = box.max.y - box.min.y;

  const mixer = new THREE.AnimationMixer(scene);
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
    setLook(look) { applyLook(scene, look); },
    clone: () => buildDuck(gltf, true),
    setHeight(metres) {
      root.scale.setScalar(metres / heightUnits);
    },
  };
}
