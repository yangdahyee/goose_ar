import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_LOOK, DUCK_HEIGHT_M, MAX_TAP_DISTANCE_M } from './config';
import { DuckBehavior, type DuckState } from './duck/behavior';
import { loadDuck, type Duck } from './duck/duck';
import { applyGlassLook, downgradeToStandard, LIGHTING, LOOKS, MODEL_FILE, type Look } from './duck/looks';
import { ShadowRig } from './duck/shadow';
import { Diag } from './ui/diag';
import { LookPicker } from './ui/picker';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ArController, DOM_OVERLAY_UNSUPPORTED, isArSupported } from './xr/ar';
import { browserAdvice } from './xr/browser';
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

// ---- ?diag: on-screen diagnostics for phones we cannot debug (the panel is filled in further down)
const diag = params.has('diag') ? new Diag() : undefined;

// A neutral studio environment: the glass look's clearcoat needs something to reflect. It is skipped when the GPU
// cannot render into float textures (or with ?noenv): the duck then has less shine, but it still shows.
const hasFloatTargets = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
let envMap: THREE.Texture | null = null;
if (!params.has('noenv') && hasFloatTargets) {
  try { envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; }
  catch (e) { diag?.log(`environment failed: ${e}`); }
}
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

const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 0.5); // intensities are set per duck (LIGHTING)
scene.add(hemi);
const shadow = new ShadowRig(); // sun + floor that only shows the duck's shadow
scene.add(shadow.group);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

// ---- the two ducks: chosen on the first visit, remembered, changeable from the viewer
const LOOK_KEY = 'goose-ar-look';
const isLook = (v: string | null): v is Look => v !== null && (LOOKS as string[]).includes(v);
function readStoredLook(): Look | null {
  try { const v = localStorage.getItem(LOOK_KEY); return isLook(v) ? v : null; } catch { return null; }
}
function storeLook(look: Look) {
  try { localStorage.setItem(LOOK_KEY, look); } catch { /* private mode: it just asks again next time */ }
}
const forcedLook = isLook(params.get('look')) ? (params.get('look') as Look) : null; // ?look=plain skips the picker
const storedLook = readStoredLook();
let currentLook: Look = forcedLook ?? storedLook ?? DEFAULT_LOOK;
const firstVisit = !forcedLook && !storedLook;
const ducks: Partial<Record<Look, Duck>> = {};
const behaviors: Partial<Record<Look, DuckBehavior>> = {};
let duck!: Duck;             // the duck in the scene right now
let behavior!: DuckBehavior; // and its behaviour

const LOOK_NAME: Record<Look, string> = { glass: '유리', plain: '일반' };
const changeLookBtn = $<HTMLButtonElement>('change-look');
const updateLookButton = () => { changeLookBtn.textContent = `질감 바꾸기 · ${LOOK_NAME[currentLook]}`; };

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

// While no floor is found, the card's tip changes the longer it takes, and after a while a last-resort button appears.
const coachText = $('coach-text'), placeAnywayBtn = $<HTMLButtonElement>('place-anyway');
const SCAN_STAGES: { after: number; text: string; fallback: boolean }[] = [
  { after: 0, text: '폰을 천천히 움직여서<br />바닥을 찾아 보세요', fallback: false },
  { after: 7, text: '바닥을 1~2m 앞에서 비춰 보세요<br />무늬나 물건이 있는 곳이 좋아요', fallback: false },
  { after: 16, text: '어둡거나 반짝이는 바닥은 어려워요<br />불을 켜거나 러그, 신발 쪽을 비춰 보세요', fallback: true },
];
let scanSince = 0;
let scanStage = -1;
/**
 * `restart` is only for a genuinely new search (AR start, "다시 놓기"). A floor that flickers in and out must not
 * restart the clock, or the 16 s "그냥 놓기" button would never appear.
 */
function showCoach(on: boolean, restart = false) {
  if (on && restart) { scanSince = performance.now(); scanStage = -1; }
  coach.hidden = !on;
}
function updateScanGuide(now: number) {
  if (coach.hidden) return;
  const secs = (now - scanSince) / 1000;
  let s = 0;
  SCAN_STAGES.forEach((st, i) => { if (secs >= st.after) s = i; });
  if (s === scanStage) return;
  scanStage = s;
  coachText.innerHTML = SCAN_STAGES[s].text;
  placeAnywayBtn.hidden = !SCAN_STAGES[s].fallback;
}
const captionFor = (s: DuckState, prev: DuckState): [string, Tone] =>
  s === 'walk' ? ['오리가 걸어와요…', 'walk']
  : s === 'go' ? ['오리가 걸어가요…', 'walk']
  : s === 'dance' ? ['신나게 춤추는 중!', 'dance']
  : prev === 'walk' || prev === 'go' ? ['도착했어요', 'done']
  : prev === 'dance' ? ['춤 끝!', 'done']
  : ['오리를 놓았어요', 'done'];
const marker = new TargetMarker();
scene.add(marker.mesh);
const onDuckState = (owner: Look) => (s: DuckState, prev: DuckState) => {
  comeBtn.classList.toggle('busy', s === 'walk');
  if (s !== 'go') marker.hide();
  if (ducks[owner]?.root.visible) { const [text, tone] = captionFor(s, prev); showCaption(text, tone, CAPTION_MS); }
};
const loading: Partial<Record<Look, Promise<Duck>>> = {};
let physicalBroken = false;   // set when the GPU could not compile the glass material
function ensureDuck(look: Look): Promise<Duck> {
  // One download per duck, even when the picker and the viewer ask at the same time.
  return (loading[look] ??= (async () => {
    const d = await loadDuck(`${import.meta.env.BASE_URL}models/${MODEL_FILE[look]}`);
    if (look === 'glass') {
      applyGlassLook(d.root);
      if (physicalBroken) downgradeToStandard(d.root);
    }
    ducks[look] = d;
    behaviors[look] = new DuckBehavior(d, onDuckState(look));
    return d;
  })().catch((e) => { delete loading[look]; throw e; }));
}
renderer.debug.onShaderError = () => {
  if (physicalBroken) return;
  physicalBroken = true;
  diag?.log('shader error: using plain materials');
  for (const d of Object.values(ducks)) downgradeToStandard(d.root);
  for (const d of picker?.ducks() ?? []) downgradeToStandard(d.root);
};
function applyLighting(look: Look) {
  // The glass duck's gentle lights assume environment reflections; without them it would look dark, so use the bright set.
  const l = look === 'glass' && !envMap ? LIGHTING.plain : LIGHTING[look];
  scene.environmentIntensity = l.env;
  hemi.intensity = l.hemi;
  shadow.light.intensity = l.sun;
}
/** Put the chosen duck in the scene (loading it first if needed). */
async function activate(look: Look) {
  const next = await ensureDuck(look);
  if (duck && duck !== next) scene.remove(duck.root);
  duck = next;
  behavior = behaviors[look]!;
  currentLook = look;
  duck.root.position.set(0, 0, 0);
  duck.root.rotation.set(0, 0, 0);
  duck.root.scale.setScalar(1);
  duck.root.visible = true;
  scene.add(duck.root);
  applyLighting(look);
  updateLookButton();
  duck.play('Idle', 0);
}

let picker: LookPicker | undefined;
/** Opens at once; each card fills in as its duck arrives, so the screen is never blank while a model downloads. */
function openPicker() {
  viewerUi.hidden = true;
  if (!picker) {
    picker = new LookPicker(renderer, $('picker'), envMap, VIEWER_BG, async (look) => {
      storeLook(look);
      try { await activate(look); } catch (e) { diag?.log(`activate ${look}: ${e}`); return; }
      statusEl.textContent = '재생: Idle';
      picker!.close();
      viewerUi.hidden = false;
    });
    for (const look of LOOKS) {
      ensureDuck(look)
        .then((d) => picker!.setDuck(look, d.clone()))
        .catch((e) => { diag?.log(`load ${look}: ${e}`); picker!.fail(look); });
    }
  }
  picker.open();
}
changeLookBtn.onclick = openPicker;

// First visit: show the picker before anything is downloaded, so the page is never blank.
if ((firstVisit && params.get('ui') !== 'ar') || params.has('pick')) openPicker();

let loadTip = '';
try {
  await activate(currentLook);
} catch (e) {
  diag?.log(`load ${currentLook}: ${e}`);
  const other: Look = currentLook === 'glass' ? 'plain' : 'glass';
  try {
    await activate(other);
    loadTip = ' · 고른 오리를 불러오지 못해서 다른 오리로 열었어요.';
  } catch (e2) {
    diag?.log(`load ${other}: ${e2}`);
    picker?.close();
    viewerUi.hidden = false;
    statusEl.textContent = '오리를 불러오지 못했어요. 통신이 안정적인 곳에서 새로고침해 주세요.';
    throw e2;
  }
}

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
statusEl.textContent = `재생: ${firstClip}${loadTip}`;
const t = params.get('t');
if (t) duck.freezeAt(firstClip, Number(t));
const player = new THREE.Vector3();

if (diag) {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  diag.set('build', typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '?');
  diag.set('ua', navigator.userAgent.replace(/^Mozilla\/5.0 /, ''));
  diag.set('screen', `${innerWidth}x${innerHeight} @${devicePixelRatio}`);
  diag.set('gpu', info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'n/a');
  diag.set('float rt', `${renderer.extensions.has('EXT_color_buffer_float')} (half: ${renderer.extensions.has('EXT_color_buffer_half_float')})`);
  diag.set('duck', currentLook);
  diag.set('environment', envMap ? 'on' : hasFloatTargets ? 'off (?noenv or failed)' : 'off (no float targets)');
  void isArSupported().then((ok) => diag.set('webxr AR', ok));
}
if (params.has('debug')) {
  (window as unknown as Record<string, unknown>).__duck = {
    get duck() { return duck; }, get behavior() { return behavior; }, get picker() { return picker; },
    camera, scene, marker, renderer, look: () => currentLook, exit: () => ar.end(),
  };
}
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
    showCoach(true, true);        // until the first surface is found
    if (diag) { ar.collectStats = true; diag.mount(overlay); diag.log('AR session started'); }
  },
  onEnd() {
    if (diag) { diag.mount(document.body); diag.log('AR session ended'); }
    hideCaption();
    showCoach(false);
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
    showCoach(!found);
    if (found) showCaption('탭해서 오리를 놓으세요');   // stays until the duck is placed
    else hideCaption();
  },
  onPlace(position, cam, estimated) {
    duck.root.position.copy(position);
    duck.root.rotation.y = yawToward(position, cam); // face the player
    duck.root.visible = true;
    showCoach(false);
    behavior.setState('idle');      // its caption: "오리를 놓았어요"
    setPlacedUi(true);
    if (estimated) showCaption('바닥 높이를 추정해서 놓았어요. 어긋나면 "다시 놓기"를 눌러 주세요', 'info', 4500);
  },
});
scene.add(ar.reticle);

placeAnywayBtn.onclick = () => ar.placeEstimated();
replaceBtn.onclick = () => {
  duck.root.visible = false;
  setPlacedUi(false);
  hideCaption();
  showCoach(true, true);
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
  catch (e) {
    const err = e as Error;
    statusEl.textContent =
      err.message === DOM_OVERLAY_UNSUPPORTED ? '이 브라우저는 AR 화면에 버튼을 띄우지 못해요. 안드로이드 Chrome으로 열어 주세요.'
      : err.name === 'NotSupportedError' ? '이 폰은 AR을 지원하지 않아요. (ARCore를 지원하는 폰과 최신 Chrome이 필요해요)'
      : `AR을 시작하지 못했어요: ${err.message}`;
    diag?.log(`start failed: ${err.name}: ${err.message}`);
  }
  startBtn.disabled = false;
};
// Samsung Internet and chat-app web views cannot run this AR page properly; say so instead of failing silently.
const browserTip = browserAdvice(navigator.userAgent);
diag?.set('browser tip', browserTip ?? 'none');
if (await isArSupported()) {
  startBtn.disabled = false;
  if (browserTip) statusEl.textContent += ` · ${browserTip}`;
} else {
  startBtn.title = 'WebXR AR 미지원';
  statusEl.textContent += browserTip ? ` · ${browserTip}` : ' · 이 기기는 AR 미지원 (안드로이드 Chrome + ARCore 필요)';
}

// ---- desktop preview of the AR overlay: ?ui=ar shows the placed-state controls over the plain viewer
if (params.get('ui') === 'ar') {
  viewerUi.hidden = true;
  overlay.hidden = false;
  if (params.has('scan')) {
    showCoach(true, true);          // ?ui=ar&scan: the "looking for the floor" state
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
let fpsFrames = 0, fpsSince = performance.now(), fps = 0;
renderer.setAnimationLoop((_time, frame) => {
  const dt = clock.getDelta();
  if (picker?.active) { picker.render(dt, clock.elapsedTime); return; }   // first-visit screen: only the previews
  duck.update(dt);
  shadow.follow(duck.root);
  ar.update(frame);
  updateScanGuide(performance.now());
  if (diag) {
    fpsFrames++;
    const now = performance.now();
    if (now - fpsSince >= 1000) { fps = Math.round((fpsFrames * 1000) / (now - fpsSince)); fpsFrames = 0; fpsSince = now; }
    diag.set('fps', fps);
    diag.set('materials', physicalBroken ? 'PLAIN (shader error)' : 'full');
    if (renderer.xr.isPresenting) {
      const s = ar.stats;
      diag.set('AR granted', s.features);
      diag.set('page UI (dom-overlay)', s.domOverlay);
      diag.set('tracking', `${s.poseOk ? 'ok' : 'NO POSE'}${s.emulated ? ' (position guessed)' : ''}  xr frames ${s.frames}`);
      diag.set('floor hits', `raw ${s.hitRaw}, facing up ${s.hitUp}, best up ${s.bestUp > -2 ? s.bestUp.toFixed(2) : '-'}`);
      diag.set('search', `${coach.hidden ? 'FOUND' : `${Math.round((performance.now() - scanSince) / 1000)}s, tip ${scanStage + 1}`}`);
    }
    diag.tick(now);
  }
  marker.update(clock.elapsedTime);
  if (renderer.xr.isPresenting && duck.root.visible) behavior.update(dt, ar.cameraPosition(player));
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});
