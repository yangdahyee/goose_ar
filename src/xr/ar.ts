import * as THREE from 'three';
import { estimateFloorPoint, facesUp } from './placement';

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
  onPlace(position: THREE.Vector3, camera: THREE.Vector3, estimated?: boolean): void;
  /** The duck is already placed and the user tapped the screen: a ray from the camera through the touch point. */
  onMove(origin: THREE.Vector3, direction: THREE.Vector3): void;
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
    // Taps on overlay buttons must not count as a placement or a move. Taps on empty overlay area still do.
    overlay.addEventListener('beforexrselect', (e) => {
      if ((e.target as HTMLElement | null)?.closest('button')) e.preventDefault();
    });
  }

  get isPlacing() { return this.placing; }

  /** Show the reticle again and let the next tap place the duck. */
  startPlacing() {
    this.placing = true;
    this.hasSurface = false; // so onSurface fires again when the reticle reappears
  }

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
      this.hasSurface = false;

      const viewer = await session.requestReferenceSpace('viewer');
      this.hitSource = await this.startHitTest(session, viewer);

      session.addEventListener('select', this.onSelect);
      session.addEventListener('end', this.onSessionEnd);
      this.handlers.onStart();
    } catch (err) {
      this.overlay.hidden = true;
      throw err;
    }
  }

  /**
   * Ask for plane AND point hits. Planes are only reported once ARCore is sure of them, which takes the longest;
   * point hits (feature points) come much earlier and also work on plain floors. Older browsers that do not know
   * entityTypes get the default (planes only).
   */
  private async startHitTest(session: XRSession, viewer: XRReferenceSpace): Promise<XRHitTestSource | undefined> {
    try {
      return await session.requestHitTestSource!({ space: viewer, entityTypes: ['plane', 'point'] });
    } catch {
      return await session.requestHitTestSource!({ space: viewer });
    }
  }

  /** No floor was found: put the duck on an estimated one (see estimateFloorPoint). */
  placeEstimated() {
    if (!this.session || !this.placing) return;
    const camera = this.cameraPosition();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.renderer.xr.getCamera().getWorldQuaternion(new THREE.Quaternion()),
    );
    const position = estimateFloorPoint(camera, forward);
    this.placing = false;
    this.hasSurface = false;
    this.reticle.visible = false;
    this.handlers.onPlace(position, camera, true);
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
    // The nearest hit that faces up. Walls and ceilings are skipped, so they never look like "found the floor".
    let pose: XRPose | undefined;
    if (space) {
      for (const hit of frame.getHitTestResults(this.hitSource)) {
        const p = hit.getPose(space);
        if (p && facesUp(p.transform.matrix)) { pose = p; break; }
      }
    }
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

  private onSelect = (e: XRInputSourceEvent) => {
    if (!this.placing) { this.moveRequest(e); return; }
    if (!this.reticle.visible) return;
    const position = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
    const camera = this.cameraPosition();
    this.placing = false;
    this.hasSurface = false;
    this.reticle.visible = false;
    this.handlers.onPlace(position, camera);
  };

  /** Turn a tap into a world-space ray (origin, direction) and hand it to the app. */
  private moveRequest(e: XRInputSourceEvent) {
    const space = this.renderer.xr.getReferenceSpace();
    const pose = space ? e.frame.getPose(e.inputSource.targetRaySpace, space) : undefined;
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(m);
    this.handlers.onMove(origin, direction);
  }

  private onSessionEnd = () => {
    this.hitSource?.cancel();
    this.hitSource = undefined;
    this.session = undefined;
    this.hasSurface = false;
    this.reticle.visible = false;
    this.overlay.hidden = true;
    this.handlers.onEnd();
  };
}
