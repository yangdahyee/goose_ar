import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DUCK_HEIGHT_M } from './config';
import { loadDuck } from './duck/duck';
import { ArController, isArSupported } from './xr/ar';
import { yawToward } from './xr/placement';

// Debug params: ?clip=Walk&t=0.2 freezes a pose, ?cam=side looks from the side.
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status'), viewerUi = $('viewer'), overlay = $('overlay');
const hint = $('hint'), replaceBtn = $<HTMLButtonElement>('replace'), startBtn = $<HTMLButtonElement>('start-ar');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
$('app').appendChild(renderer.domElement);

const VIEWER_BG = new THREE.Color(0xeef3f6);
const scene = new THREE.Scene();
scene.background = VIEWER_BG;
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
camera.position.set(0, 2.2, 7);
if (params.get('cam') === 'side') camera.position.set(8, 1.8, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 6, 4);
scene.add(sun);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

const duck = await loadDuck(`${import.meta.env.BASE_URL}models/duck.glb`);
duck.root.position.set(0, 0, 0);
scene.add(duck.root);

// ---- normal viewer: clip buttons
for (const name of duck.clips) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => { duck.play(name); statusEl.textContent = `재생: ${name}`; };
  $('clips').appendChild(b);
}
const firstClip = params.get('clip') ?? (duck.clips.includes('Idle') ? 'Idle' : duck.clips[0]);
duck.play(firstClip, 0);
statusEl.textContent = `재생: ${firstClip}`;
const t = params.get('t');
if (t) duck.freezeAt(firstClip, Number(t));

// ---- AR
const ar = new ArController(renderer, overlay, {
  onStart() {
    viewerUi.hidden = true;
    scene.background = null;
    controls.enabled = false;
    duck.root.visible = false;            // appears when the user taps a spot
    duck.setHeight(DUCK_HEIGHT_M);
    replaceBtn.hidden = true;
    hint.textContent = '바닥을 천천히 비춰 보세요';
  },
  onEnd() {
    viewerUi.hidden = false;
    scene.background = VIEWER_BG;
    controls.enabled = true;
    duck.root.visible = true;
    duck.root.scale.setScalar(1);
    duck.root.position.set(0, 0, 0);
    duck.root.rotation.set(0, 0, 0);
  },
  onSurface(found) {
    if (ar.isPlacing) hint.textContent = found ? '탭해서 오리를 놓으세요' : '바닥을 천천히 비춰 보세요';
  },
  onPlace(position, cam) {
    duck.root.position.copy(position);
    duck.root.rotation.y = yawToward(position, cam); // face the player
    duck.root.visible = true;
    duck.play('Idle');
    hint.textContent = '오리를 놓았어요';
    replaceBtn.hidden = false;
  },
});
scene.add(ar.reticle);

replaceBtn.onclick = () => {
  duck.root.visible = false;
  replaceBtn.hidden = true;
  hint.textContent = '바닥을 천천히 비춰 보세요';
  ar.startPlacing();
};
$('exit').onclick = () => ar.end();
startBtn.onclick = async () => {
  startBtn.disabled = true;
  try { await ar.start(); }
  catch (e) { statusEl.textContent = `AR을 시작하지 못했어요: ${(e as Error).message}`; }
  startBtn.disabled = false;
};
if (await isArSupported()) {
  startBtn.disabled = false;
} else {
  startBtn.title = 'WebXR AR 미지원';
  statusEl.textContent += ' · 이 기기는 AR 미지원 (안드로이드 Chrome + ARCore 필요)';
}

// ---- loop
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop((_time, frame) => {
  duck.update(clock.getDelta());
  ar.update(frame);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});
