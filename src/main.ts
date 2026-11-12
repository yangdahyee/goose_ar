import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DUCK_HEIGHT_M, MAX_TAP_DISTANCE_M } from './config';
import { DuckBehavior, type DuckState } from './duck/behavior';
import { loadDuck } from './duck/duck';
import { ShadowRig } from './duck/shadow';
import { ArController, isArSupported } from './xr/ar';
import { TargetMarker } from './xr/marker';
import { rayPlaneHit, yawToward } from './xr/placement';

// Debug params: ?clip=Walk&t=0.2 freezes a pose, ?cam=side looks from the side.
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status'), viewerUi = $('viewer'), overlay = $('overlay');
const hint = $('hint'), replaceBtn = $<HTMLButtonElement>('replace'), startBtn = $<HTMLButtonElement>('start-ar');
const comeLabel = $('come-label');
const comeBtn = $<HTMLButtonElement>('come'), danceBtn = $<HTMLButtonElement>('dance');
const photoBtn = $<HTMLButtonElement>('photo'), showUiBtn = $<HTMLButtonElement>('show-ui');
const setPlacedUi = (placed: boolean) => { comeBtn.hidden = danceBtn.hidden = replaceBtn.hidden = photoBtn.hidden = !placed; };
// Photo mode hides every overlay element so a phone screenshot or screen recording is clean.
const setPhotoMode = (on: boolean) => overlay.classList.toggle('photo', on);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const VIEWER_BG = new THREE.Color(0xeef3f6);
const scene = new THREE.Scene();
scene.background = VIEWER_BG;
const VIEWER_FOV = 40;
const camera = new THREE.PerspectiveCamera(VIEWER_FOV, 1, 0.01, 100);
camera.position.set(0, 2.2, 7);
if (params.get('cam') === 'side') camera.position.set(8, 1.8, 0);

// An AR session overwrites the camera pose and projection. Remember the viewer camera so we can put it back.
const savedPos = new THREE.Vector3();
const savedQuat = new THREE.Quaternion();
const saveViewerCamera = () => { savedPos.copy(camera.position); savedQuat.copy(camera.quaternion); };
function restoreViewerCamera() {
  camera.position.copy(savedPos);
  camera.quaternion.copy(savedQuat);
  camera.fov = VIEWER_FOV;
  resize();               // also refreshes aspect and the projection matrix
  controls.update();
}

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 1.6));
const shadow = new ShadowRig(); // sun + floor that only shows the duck's shadow
scene.add(shadow.group);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

const duck = await loadDuck(`${import.meta.env.BASE_URL}models/duck.glb`);
duck.root.position.set(0, 0, 0);
scene.add(duck.root);

// ---- normal viewer: clip buttons
for (const name of duck.clips) {
  const b = document.createElement('button');
  b.className = 'glass';
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
const hintFor = (s: DuckState, prev: DuckState) =>
  s === 'walk' ? '오리가 걸어와요…'
  : s === 'go' ? '오리가 걸어가요…'
  : s === 'dance' ? '신나게 춤추는 중!'
  : prev === 'walk' || prev === 'go' ? '도착했어요'
  : prev === 'dance' ? '춤 끝!'
  : '오리를 놓았어요';
const marker = new TargetMarker();
scene.add(marker.mesh);
const behavior = new DuckBehavior(duck, (s, prev) => {
  comeBtn.classList.toggle('busy', s === 'walk');
  if (s !== 'go') marker.hide();
  comeLabel.textContent = s === 'walk' ? '오는 중…' : '이리 와';
  if (duck.root.visible) hint.textContent = hintFor(s, prev);
});
const player = new THREE.Vector3();
if (params.has('debug')) (window as unknown as Record<string, unknown>).__duck = { duck, behavior, camera, scene, marker };
const ar = new ArController(renderer, overlay, {
  onStart() {
    viewerUi.hidden = true;
    scene.background = null;
    controls.enabled = false;
    duck.root.visible = false;            // appears when the user taps a spot
    duck.setHeight(DUCK_HEIGHT_M);
    setPlacedUi(false);
    setPhotoMode(false);
    marker.hide();
    hint.textContent = '바닥을 천천히 비춰 보세요';
  },
  onEnd() {
    restoreViewerCamera();
    viewerUi.hidden = false;
    scene.background = VIEWER_BG;
    controls.enabled = true;
    duck.root.visible = true;
    duck.root.scale.setScalar(1);
    duck.root.position.set(0, 0, 0);
    duck.root.rotation.set(0, 0, 0);
  },
  onMove(origin, direction) {
    const point = rayPlaneHit(origin, direction, duck.root.position.y, MAX_TAP_DISTANCE_M);
    if (params.has('debug')) (window as unknown as Record<string, unknown>).__lastRay = { origin: origin.toArray(), direction: direction.toArray(), floorY: duck.root.position.y, point: point?.toArray() };
    if (!point) { hint.textContent = '바닥을 탭해 주세요'; return; }
    marker.show(point);
    behavior.goTo(point);
  },
  onSurface(found) {
    if (ar.isPlacing) hint.textContent = found ? '탭해서 오리를 놓으세요' : '바닥을 천천히 비춰 보세요';
  },
  onPlace(position, cam) {
    duck.root.position.copy(position);
    duck.root.rotation.y = yawToward(position, cam); // face the player
    duck.root.visible = true;
    behavior.setState('idle');
    setPlacedUi(true);
  },
});
scene.add(ar.reticle);

replaceBtn.onclick = () => {
  duck.root.visible = false;
  setPlacedUi(false);
  hint.textContent = '바닥을 천천히 비춰 보세요';
  ar.startPlacing();
};
photoBtn.onclick = () => setPhotoMode(true);
showUiBtn.onclick = () => setPhotoMode(false);
comeBtn.onclick = () => behavior.callToMe();
danceBtn.onclick = () => behavior.dance();
$('exit').onclick = () => ar.end();
startBtn.onclick = async () => {
  startBtn.disabled = true;
  saveViewerCamera();
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

// ---- desktop preview of the AR overlay: ?ui=ar shows the placed-state controls over the plain viewer
if (params.get('ui') === 'ar') {
  viewerUi.hidden = true;
  overlay.hidden = false;
  setPlacedUi(true);
  hint.textContent = '오리를 놓았어요';
  if (params.has('photo')) setPhotoMode(true);
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
  const dt = clock.getDelta();
  duck.update(dt);
  shadow.follow(duck.root);
  ar.update(frame);
  marker.update(clock.elapsedTime);
  if (renderer.xr.isPresenting && duck.root.visible) behavior.update(dt, ar.cameraPosition(player));
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});
