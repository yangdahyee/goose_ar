import * as THREE from 'three';

/**
 * The two ducks the player can choose between:
 *   glass  the new duck (duck_glass.glb): glossy, clearcoat
 *   plain  the original duck (duck_plain.glb): flat, matte colours
 */
export type Look = 'glass' | 'plain';
export const LOOKS: Look[] = ['glass', 'plain'];

export const MODEL_FILE: Record<Look, string> = { glass: 'duck_glass.glb', plain: 'duck_plain.glb' };

/** Light levels per duck. The glass duck needs a gentler setup, or its clearcoat flares; the plain duck keeps its original one. */
export interface Lighting { env: number; hemi: number; sun: number }
export const LIGHTING: Record<Look, Lighting> = {
  glass: { env: 0.30, hemi: 0.60, sun: 1.0 },
  plain: { env: 0.0, hemi: 1.6, sun: 2.0 },
};

/**
 * Softened clearcoat for the glass duck. The Blender file has coat 0.35 / 0.2 at roughness 0.15, which flares in
 * the app (a lit, reflective scene), so here the coat is lower and its highlight broader.
 */
const COAT: Record<string, number> = {
  Duck_White: 0.26, Duck_Orange: 0.26, Duck_Orange_Dark: 0.26,
  Hat_Blue: 0.15, Hat_Blue_Dark: 0.15, Cash_Green: 0.15, Cash_Band: 0.15,
};
const COAT_ROUGHNESS = 0.35;

export function applyGlassLook(root: THREE.Object3D) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      const mat = m as THREE.MeshPhysicalMaterial;
      if (!mat.isMeshPhysicalMaterial || !(m.name in COAT)) continue;
      mat.clearcoat = COAT[m.name];
      mat.clearcoatRoughness = COAT_ROUGHNESS;
    }
  });
}
