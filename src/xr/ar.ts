import * as THREE from 'three';

export async function isArSupported(): Promise<boolean> {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export interface ArHandlers {
  onStart(): void;
  onEnd(): void;
  /** The user tapped while the reticle was on a surface. */
  onPlace(position: THREE.Vector3, camera: THREE.Vector3): void;
  /** The reticle found (or lost) a surface. */
  onSurface(found: boolean): void;
}

/** WebXR AR session with a hit-test reticle. Owns the session, not the duck. */
export class ArController {
  readonly reticle: THREE.Mesh;
  private session?: XRSession;
  private hitSource?: XRHitTestSource;
  private hasSurface = false;
  private placing = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private overlay: HTMLElement,
    private handlers: ArHandlers,
  ) {
    const ring = new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    // Taps on overlay buttons must not count as "place the duck".
    overlay.addEventListener('beforexrselect', (e) => e.preventDefault());
  }

  get isPlacing() { return this.placing; }

  /** Show the reticle again and let the next tap place the duck. */
  startPlacing() { this.placing = true; }

  async start(): Promise<void> {
    this.overlay.hidden = false;
    try {
      const session = await navigator.xr!.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: this.overlay },
      });
      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(session);
      this.session = session;
      this.placing = true;

      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource!({ space: viewer });

      session.addEventListener('select', this.onSelect);
      session.addEventListener('end', this.onSessionEnd);
      this.handlers.onStart();
    } catch (err) {
      this.overlay.hidden = true;
      throw err;
    }
  }

  end() { void this.session?.end(); }

  /** Player (camera) position in world space. Only meaningful while a session is running. */
  cameraPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this.renderer.xr.getCamera().matrixWorld);
  }

  /** Call once per rendered frame. */
  update(frame?: XRFrame) {
    if (!frame || !this.hitSource || !this.placing) {
      this.reticle.visible = false;
      return;
    }
    const space = this.renderer.xr.getReferenceSpace();
    const hit = frame.getHitTestResults(this.hitSource)[0];
    const pose = hit && space ? hit.getPose(space) : undefined;
    if (pose) {
      this.reticle.matrix.fromArray(pose.transform.matrix);
      this.reticle.visible = true;
    } else {
      this.reticle.visible = false;
    }
    if (this.reticle.visible !== this.hasSurface) {
      this.hasSurface = this.reticle.visible;
      this.handlers.onSurface(this.hasSurface);
    }
  }

  private onSelect = () => {
    if (!this.placing || !this.reticle.visible) return;
    const position = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
    const camera = this.cameraPosition();
    this.placing = false;
    this.reticle.visible = false;
    this.handlers.onPlace(position, camera);
  };

  private onSessionEnd = () => {
    this.hitSource?.cancel();
    this.hitSource = undefined;
    this.session = undefined;
    this.reticle.visible = false;
    this.overlay.hidden = true;
    this.handlers.onEnd();
  };
}
