import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// M0/M1: plain 3D viewer with clip switching. AR (M2) and behaviour (M3) come later.
// Debug params: ?clip=Walk&t=0.2 freezes a pose, ?cam=side looks from the side.
const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const status = document.getElementById('status')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef3f6);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 2.2, 7);
if (params.get('cam') === 'side') camera.position.set(8, 1.8, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 6, 4);
scene.add(sun);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

let mixer: THREE.AnimationMixer | undefined;
let current: THREE.AnimationAction | undefined;
const actions = new Map<string, THREE.AnimationAction>();

function play(name: string) {
  const next = actions.get(name);
  if (!next || next === current) return;
  next.reset().fadeIn(0.25).play();
  current?.fadeOut(0.25);
  current = next;
  status.textContent = `재생: ${name}`;
}

new GLTFLoader().load(
  `${import.meta.env.BASE_URL}models/duck.glb`,
  (gltf) => {
    scene.add(gltf.scene);
    mixer = new THREE.AnimationMixer(gltf.scene);
    const bar = document.getElementById('clips')!;
    for (const clip of gltf.animations) {
      actions.set(clip.name, mixer.clipAction(clip));
      const b = document.createElement('button');
      b.textContent = clip.name;
      b.onclick = () => play(clip.name);
      bar.appendChild(b);
    }
    const first = params.get('clip') ?? (actions.has('Idle') ? 'Idle' : gltf.animations[0]?.name);
    if (first) play(first);
    const t = params.get('t');
    if (t && current) { current.fadeIn(0); current.paused = true; current.time = Number(t); mixer.update(0); }
  },
  undefined,
  () => { status.textContent = '모델을 불러오지 못했어요.'; },
);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  mixer?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
