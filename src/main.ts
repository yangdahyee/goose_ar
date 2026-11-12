import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// M0: plain 3D viewer. AR (M2) and behaviour (M3) come later.
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bb, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 6, 4);
scene.add(sun);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;

let mixer: THREE.AnimationMixer | undefined;

new GLTFLoader().load(
  `${import.meta.env.BASE_URL}models/duck.glb`,
  (gltf) => {
    scene.add(gltf.scene);
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      mixer.clipAction(gltf.animations[0]).play();
    }
    status.textContent = `애니메이션: ${gltf.animations.map((a) => a.name).join(', ') || '없음'}`;
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
