import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_LOOK, DUCK_HEIGHT_M, MAX_TAP_DISTANCE_M } from './config';
import { DuckBehavior, type DuckState } from './duck/behavior';
import { loadDuck } from './duck/duck';
import { LOOKS, type Look } from './duck/looks';
import { ShadowRig } from './duck/shadow';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ArController, isArSupported } from './xr/ar';
import { TargetMarker } from './xr/marker';
import { rayPlaneHit, yawToward } from './xr/placement';

// Debug params: ?clip=Walk&t=0.2 freezes a pose, ?cam=side looks from the side.
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status'), viewerUi = $('viewer'), overlay = $('overlay');
const hint = $('hint'), replaceBtn = $<HTMLButtonElement>('replace'), startBtn = $<HTMLButtonElement>('start-ar');
const coach = $('coach'), scrim = $('scrim');
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

// A neutral studio environment: the glass look's clearcoat needs something to reflect.
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const VIEWER_BG = new THREE.Color(0xeef3f6);
const scene = new THREE.Scene();
scene.background = VIEWER_BG;
scene.environment = envMap;
scene.environmentIntensity = 0.55;
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 0.5));
const shadow = new ShadowRig(); // sun + floor that only shows the duck's shadow
scene.add(shadow.group);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

const duck = await loadDuck(`${import.meta.env.BASE_URL}models/duck.glb`);
duck.root.position.set(0, 0, 0);
const requestedLook = params.get('look') as Look | null;
duck.setLook(requestedLook && LOOKS.includes(requestedLook) ? requestedLook : DEFAULT_LOOK);
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
// The caption has no box: text, a status dot and a faint scrim. Events show it for a moment; instructions that
// must stay (tap to place) pass no duration and stay until replaced or hidden.
type Tone = 'info' | 'walk' | 'done' | 'dance';
let captionTimer: number | undefined;
function showCaption(text: string, tone: Tone = 'info', ms?: number) {
  hint.textContent = text;
  hint.dataset.tone = tone;
  hint.classList.add('show');
  scrim.classList.add('show');
  window.clearTimeout(captionTimer);
  if (ms) captionTimer = window.setTimeout(hideCaption, ms);
}
function hideCaption() {
  window.clearTimeout(captionTimer);
  hint.classList.remove('show');
  scrim.classList.remove('show');
}
const CAPTION_MS = 2200;
const captionFor = (s: DuckState, prev: DuckState): [string, Tone] =>
  s === 'walk' ? ['오리가 걸어와요…', 'walk']
  : s === 'go' ? ['오리가 걸어가요…', 'walk']
  : s === 'dance' ? ['신나게 춤추는 중!', 'dance']
  : prev === 'walk' || prev === 'go' ? ['도착했어요', 'done']
  : prev === 'dance' ? ['춤 끝!', 'done']
  : ['오리를 놓았어요', 'done'];
const marker = new TargetMarker();
scene.add(marker.mesh);
const behavior = new DuckBehavior(duck, (s, prev) => {
  comeBtn.classList.toggle('busy', s === 'walk');
  if (s !== 'go') marker.hide();
  if (duck.root.visible) { const [text, tone] = captionFor(s, prev); showCaption(text, tone, CAPTION_MS); }
});
const player = new THREE.Vector3();
if (params.has('debug')) (window as unknown as Record<string, unknown>).__duck = { duck, behavior, camera, scene, marker, exit: () => ar.end() };
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
    hideCaption();
    coach.hidden = false;         // until the first surface is found
  },
  onEnd() {
    hideCaption();
    coach.hidden = true;
    marker.hide();                // the destination ring belongs to the AR session's coordinates
    behavior.setState('idle');    // do not leave the duck "walking" in the plain viewer
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
    if (!point) { showCaption('바닥을 탭해 주세요', 'info', 1800); return; }
    marker.show(point);
    behavior.goTo(point);
  },
  onSurface(found) {
    if (!ar.isPlacing) return;
    coach.hidden = found;
    if (found) showCaption('탭해서 오리를 놓으세요');   // stays until the duck is placed
    else hideCaption();
  },
  onPlace(position, cam) {
    duck.root.position.copy(position);
    duck.root.rotation.y = yawToward(position, cam); // face the player
    duck.root.visible = true;
    coach.hidden = true;
    behavior.setState('idle');      // its caption: "오리를 놓았어요"
    setPlacedUi(true);
  },
});
scene.add(ar.reticle);

replaceBtn.onclick = () => {
  duck.root.visible = false;
  setPlacedUi(false);
  hideCaption();
  coach.hidden = false;
  ar.startPlacing();
};
photoBtn.onclick = () => setPhotoMode(true);
showUiBtn.onclick = () => setPhotoMode(false);
comeBtn.onclick = () => behavior.callToMe();
danceBtn.onclick = () => behavior.dance();
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
  if (params.has('scan')) {
    coach.hidden = false;           // ?ui=ar&scan: the "looking for the floor" state
  } else {
    setPlacedUi(true);
    showCaption(params.get('msg') ?? '오리를 놓았어요', (params.get('tone') as Tone) ?? 'done'); // stays visible for design review
  }
  if (params.has('photo')) setPhotoMode(true);
}

// ---- stale-cache guard: GitHub Pages lets browsers keep index.html for ~10 minutes, so a phone can show an old build
const buildEl = $('build');
if (__BUILD_ID__ !== 'dev') buildEl.textContent = `v${__BUILD_ID__}`;
async function checkForUpdate() {
  if (__BUILD_ID__ === 'dev') return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    const { id } = (await res.json()) as { id: string };
    if (id === __BUILD_ID__) return;
    const key = `reloaded-for-${id}`;
    let alreadyTried = false;
    try { alreadyTried = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch { /* storage blocked */ }
    if (!alreadyTried) location.replace(`${location.pathname}?v=${id}`); // a new URL skips the cached copy
    else buildEl.textContent = `v${__BUILD_ID__} · 새 버전이 있어요. 새로고침해 주세요`;
  } catch { /* offline: keep what we have */ }
}
void checkForUpdate();

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
