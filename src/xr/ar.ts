import * as THREE from 'three';
import { estimateFloorPoint, facesUp } from './placement';

export const DOM_OVERLAY_UNSUPPORTED = 'DOM_OVERLAY_UNSUPPORTED';

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

/** Numbers for the ?diag panel. Only collected when `collectStats` is on. */
export interface ArStats {
  frames: number;       // XR frames since the session started
  hitRaw: number;       // hit results in the last frame
  hitUp: number;        // of those, how many face up
  bestUp: number;       // the largest "up" value among them (1 = a floor, 0 = a wall, -1 = a ceiling)
  poseOk: boolean;      // the viewer pose exists, i.e. tracking works
  emulated: boolean;    // tracking is degraded: the position is guessed
  features: string;     // what the session actually granted
  domOverlay: string;   // 'screen' / 'floating' / 'head-locked', or NONE if the page UI is not shown
}

/** WebXR AR session with a hit-test reticle. Owns the session, not the duck. */
export class ArController {
  readonly reticle: THREE.Mesh;
  private session?: XRSession;
  private hitSource?: XRHitTestSource;
  private hasSurface = false;
  private placing = true;
  collectStats = false;
  readonly stats: ArStats = { frames: 0, hitRaw: 0, hitUp: 0, bestUp: -2, poseOk: false, emulated: false, features: '-', domOverlay: '-' };

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
      // `domOverlayState` is null when the browser did not grant dom-overlay: then none of our buttons, tips or
      // captions would be visible, and the player could not do anything. (Undefined means "not implemented", e.g. emulators.)
      if ((session as XRSession & { domOverlayState?: unknown }).domOverlayState === null) {
        await session.end().catch(() => undefined);
        throw new Error(DOM_OVERLAY_UNSUPPORTED);
      }
      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(session);
      this.session = session;
      this.placing = true;
      this.hasSurface = false;
      const granted = session as XRSession & { enabledFeatures?: string[]; domOverlayState?: { type: string } };
      Object.assign(this.stats, {
        frames: 0, hitRaw: 0, hitUp: 0, bestUp: -2, poseOk: false, emulated: false,
        features: granted.enabledFeatures?.join(',') ?? 'n/a', domOverlay: granted.domOverlayState?.type ?? 'NONE',
      });

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
   * Hit-test against whatever surface is in the middle of the screen: floor, desk, laptop, wall. Only planes (the
   * browser default): asking for feature points as well, or for up-facing surfaces only, made the duck go on the
   * floor and nowhere else, which made it hard to see from the front.
   */
  private async startHitTest(session: XRSession, viewer: XRReferenceSpace): Promise<XRHitTestSource | undefined> {
    return await session.requestHitTestSource!({ space: viewer });
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
    if (this.collectStats && frame) {
      const sp = this.renderer.xr.getReferenceSpace();
      const vp = sp ? frame.getViewerPose(sp) : null;
      this.stats.frames++;
      this.stats.poseOk = !!vp;
      this.stats.emulated = !!vp?.emulatedPosition;
    }
    if (!frame || !this.hitSource || !this.placing) {
      this.reticle.visible = false;
      return;
    }
    const space = this.renderer.xr.getReferenceSpace();
    // The nearest hit, whatever way the surface faces. (`up` below is only counted for the ?diag panel.)
    let pose: XRPose | undefined;
    if (space) {
      const results = frame.getHitTestResults(this.hitSource);
      let up = 0, best = -2;
      for (const hit of results) {
        const p = hit.getPose(space);
        if (!p) continue;
        best = Math.max(best, p.transform.matrix[5]);
        if (facesUp(p.transform.matrix)) up++;
        pose ??= p;
      }
      if (this.collectStats) Object.assign(this.stats, { hitRaw: results.length, hitUp: up, bestUp: best });
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
