import * as THREE from 'three';

/**
 * Two surface looks for the same GLB. Both are parameter presets of one physical material, taken from the
 * Blender file (Duck_White vs Duck_White_Plush and so on):
 *   glass  glossy, clearcoat, no sheen            (what the GLB ships with)
 *   plain  matte and soft: rough, sheen, no clearcoat
 * Colours are linear sRGB, like glTF base colour factors. `sheen` is Blender's Sheen Weight.
 */
export type Look = 'glass' | 'plain';
export const LOOKS: Look[] = ['glass', 'plain'];

interface Preset {
  color: [number, number, number];
  roughness: number;
  coat: number;
  coatRoughness: number;
  sheen: number;
  sheenRoughness: number;
  specular: number; // three's specularIntensity: 1 = Blender's Specular IOR Level 0.5
}

const glass = (color: Preset['color'], roughness: number, coat: number): Preset =>
  ({ color, roughness, coat, coatRoughness: 0.15, sheen: 0, sheenRoughness: 0.5, specular: 1 });
const plain = (color: Preset['color'], sheen: number): Preset =>
  ({ color, roughness: 0.95, coat: 0, coatRoughness: 0.03, sheen, sheenRoughness: 0.45, specular: 0.3 });

const PRESETS: Record<Look, Record<string, Preset>> = {
  glass: {
    Duck_White: glass([0.95, 0.94, 0.90], 0.28, 0.35),
    Duck_Orange: glass([1.0, 0.40, 0.04], 0.28, 0.35),
    Duck_Orange_Dark: glass([0.90, 0.32, 0.03], 0.28, 0.35),
    Hat_Blue: glass([0.45, 0.68, 0.86], 0.38, 0.20),
    Hat_Blue_Dark: glass([0.34, 0.56, 0.76], 0.38, 0.20),
    Cash_Green: glass([0.26, 0.58, 0.32], 0.35, 0.20),
    Cash_Band: glass([0.97, 0.89, 0.68], 0.35, 0.20),
  },
  plain: {
    Duck_White: plain([0.95, 0.93, 0.88], 0.55),
    Duck_Orange: plain([1.0, 0.38, 0.03], 0.40),
    Duck_Orange_Dark: plain([0.90, 0.30, 0.03], 0.40),
    Hat_Blue: plain([0.42, 0.66, 0.84], 0.35),
    Hat_Blue_Dark: plain([0.32, 0.54, 0.74], 0.35),
    Cash_Green: plain([0.24, 0.55, 0.30], 0.35),
    Cash_Band: plain([0.96, 0.88, 0.68], 0.35),
  },
};

/** Eyes, highlights and blush look the same in both looks and are left alone. */
export function applyLook(root: THREE.Object3D, look: Look) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      const p = PRESETS[look][m.name];
      const mat = m as THREE.MeshPhysicalMaterial;
      if (!p || !mat.isMeshPhysicalMaterial) continue;
      mat.color.setRGB(p.color[0], p.color[1], p.color[2], THREE.LinearSRGBColorSpace);
      mat.roughness = p.roughness;
      mat.clearcoat = p.coat;
      mat.clearcoatRoughness = p.coatRoughness;
      mat.sheen = p.sheen > 0 ? 1 : 0;
      mat.sheenColor.setScalar(p.sheen);
      mat.sheenRoughness = p.sheenRoughness;
      mat.specularIntensity = p.specular;
      mat.needsUpdate = true;
    }
  });
}
