"""Export the roomducks duck (assets/roomducks_duck_only.blend) as the AR app's GLB.

Usage:  python tools/export_glb.py assets/roomducks_duck_only.blend public/models/duck_glass.glb   (needs `pip install bpy`)

What it does
  * bakes the eye gradient and the soft blush to textures (their shaders are procedural),
  * bakes every modifier at frame 1, and decimates the heavy meshes (body, feet, hat) for phones,
  * moves the duck to the origin facing -Y (glTF +Z), and parents the hat to the head and the cash to the body,
  * drops the original room animation and authors three in-place clips: Idle, Walk, Dance,
  * writes simple PBR materials with a clearcoat (the glass look). The original duck is a separate model
    (public/models/duck_plain.glb); src/duck/looks.ts softens the clearcoat at runtime.

Walk is built so the feet do not slide: ground speed = 2 * STRIDE / (WALK_FRAMES / fps) = 2.1 units/s.
"""
import math
import sys
import tempfile

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

src, dst = sys.argv[-2:]
bpy.ops.wm.open_mainfile(filepath=src)
sc = bpy.context.scene
sc.frame_set(1)
O = bpy.data.objects
TEX = tempfile.mkdtemp() + "/"
SZ = 256

# ------------------------------------------------------------------ budgets
BODY_RATIO, FOOT_RATIO = 0.17, 0.30      # decimate ratios (body 66k -> ~11k, feet 6k -> ~1.8k)
HAT_SUBSURF_LEVEL = 1                    # hat was level 2 (29k polys)

# ------------------------------------------------------------------ clips
WALK_FRAMES, IDLE_FRAMES, DANCE_FRAMES = 16, 48, 192
STRIDE, FOOT_LIFT = 0.35, 0.12


def visible(o):
    return not (o.hide_render or o.hide_get())


# ================================================================== 1. bake eye / blush textures
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 16
sc.cycles.use_denoising = False

for n in ("EyeP_L", "EyeP_R", "BlushP_L", "BlushP_R"):      # planar UVs from the local XY of each disc
    me = O[n].data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    bm = bmesh.new(); bm.from_mesh(me); uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = ((l.vert.co.x - x0) / (x1 - x0), (l.vert.co.y - y0) / (y1 - y0))
    bm.to_mesh(me); bm.free()


def bake(obj, mat, name, btype, noncolor=False):
    img = bpy.data.images.new(name, SZ, SZ, alpha=False)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    nt = mat.node_tree
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img; nt.nodes.active = tn
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    kw = dict(type=btype, margin=8, use_clear=True)
    if btype == 'DIFFUSE':
        kw['pass_filter'] = {'COLOR'}
    bpy.ops.object.bake(**kw)
    nt.nodes.remove(tn)
    return img


eye = O["EyeP_L"]
eye_img = bake(eye, eye.data.materials[0], "eye_color", 'DIFFUSE')
eye_img.filepath_raw = TEX + "eye.png"; eye_img.file_format = 'PNG'; eye_img.save()

bl = O["BlushP_L"]; bl_mat = bl.data.materials[0]
tmp = bl_mat.copy(); nt = tmp.node_tree                      # emit the soft-edge factor to get an alpha mask
mr = next(n for n in nt.nodes if n.type == 'MAP_RANGE'); out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
em = nt.nodes.new('ShaderNodeEmission')
nt.links.new(mr.outputs['Result'], em.inputs['Color']); nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
bl.data.materials[0] = tmp
mask_img = bake(bl, tmp, "blush_mask", 'EMIT', noncolor=True)
bl.data.materials[0] = bl_mat
alpha = np.array(mask_img.pixels[:]).reshape(SZ, SZ, 4)[:, :, 0]


def enc(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


rgba = np.zeros((SZ, SZ, 4), dtype=np.float32)
rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2], rgba[:, :, 3] = enc(1.0), enc(0.5), enc(0.55), alpha
blush_img = bpy.data.images.new("blush", SZ, SZ, alpha=True)
blush_img.pixels = rgba.ravel().tolist(); blush_img.alpha_mode = 'STRAIGHT'
blush_img.filepath_raw = TEX + "blush.png"; blush_img.file_format = 'PNG'; blush_img.save()
eye_tex = bpy.data.images.load(TEX + "eye.png"); blush_tex = bpy.data.images.load(TEX + "blush.png")

# ================================================================== 2. bake modifiers, decimate
def bake_modifiers(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    o.modifiers.clear()
    o.data = me


def decimate(o, ratio):
    m = o.modifiers.new("dec", 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    bake_modifiers(o)


for m in O["Hat_Smooth"].modifiers:                          # shrinkwrap is baked too, at this frame
    if m.type == 'SUBSURF':
        m.levels = m.render_levels = HAT_SUBSURF_LEVEL

for o in [o for o in O if o.type == 'MESH' and visible(o)]:
    if o.modifiers:
        bake_modifiers(o)
decimate(O["Duck_Body"], BODY_RATIO)
decimate(O["Duck_Foot_L"], FOOT_RATIO)
decimate(O["Duck_Foot_R"], FOOT_RATIO)
for n in ("Duck_Body", "Duck_Foot_L", "Duck_Foot_R", "Hat_Smooth", "Head"):
    for p in O[n].data.polygons:
        p.use_smooth = True

# ================================================================== 3. rest pose, hierarchy, cleanup
bpy.context.view_layer.update()
root, head, hat = O["Duck_Root"], O["Head"], O["Hat"]
w_root_old = root.matrix_world.copy()
world = {o.name: o.matrix_world.copy() for o in (hat, O["Cash_Stack_1"], O["Cash_Stack_2"])}

for o in list(O):                                            # the original room animation is not used
    o.animation_data_clear()
    if o.type == 'MESH' and o.data.shape_keys:
        o.data.shape_keys.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# duck to the origin facing -Y: children keep their local transform, only the root moves
root.parent = None
root.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()
to_origin = w_root_old.inverted()
for n in ("Hat", "Cash_Stack_1", "Cash_Stack_2"):            # unparented props follow the same move
    O[n].matrix_world = to_origin @ world[n]
bpy.context.view_layer.update()


def adopt(child, parent):                                    # parent without moving the child
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


adopt(hat, head)
adopt(O["Cash_Stack_1"], root)
adopt(O["Cash_Stack_2"], root)

for o in list(O):                                            # hidden helpers, metaballs, originals
    if o.hide_render or o.hide_get() or o.type == 'META':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()

# ================================================================== 4. in-place clips
foot_l, foot_r = O["Duck_Foot_L"], O["Duck_Foot_R"]
cash1, cash2 = O["Cash_Stack_1"], O["Cash_Stack_2"]
ANIMATED = (root, head, hat, foot_l, foot_r, cash1, cash2)
REST = {o.name: (o.location.copy(), o.rotation_euler.copy()) for o in ANIMATED}


def foot_pose(p):
    if p < 0.5:
        return (0, -STRIDE + 2 * STRIDE * (p / 0.5), 0)                    # stance: slides back
    q = (p - 0.5) / 0.5
    return (0, STRIDE - 2 * STRIDE * q, FOOT_LIFT * math.sin(math.pi * q))  # swing: lifts and goes forward


def pose_idle(f):
    p = (f - 1) / IDLE_FRAMES; s = math.sin(2 * math.pi * p); s2 = math.sin(2 * math.pi * p + 0.8)
    return {
        root: ((0, 0, 0.012 * s), (0, 0.02 * s, 0)),
        head: ((0, 0, 0.008 * s2), (0.02 * s2, 0, 0.03 * s)),
        hat: ((0, 0, 0), (0.012 * math.sin(2 * math.pi * p + 1.4), 0, 0)),
        cash1: ((0, 0, 0.012 * math.sin(2 * math.pi * p + 0.4)), (0, 0, 0)),
        cash2: ((0, 0, 0.012 * math.sin(2 * math.pi * p + 0.4)), (0, 0, 0)),
        foot_l: ((0, 0, 0), (0, 0, 0)), foot_r: ((0, 0, 0), (0, 0, 0)),
    }


def pose_walk(f):
    p = (f - 1) / WALK_FRAMES; s = math.sin(2 * math.pi * p); b = math.sin(4 * math.pi * p)
    return {
        root: ((0, 0, 0.04 * (1 - math.cos(4 * math.pi * p)) / 2), (0, 0.10 * s, 0.10 * s)),
        head: ((0, 0, -0.012 * math.cos(4 * math.pi * p)), (0.04 * math.sin(4 * math.pi * p + 0.5), -0.08 * s, -0.07 * s)),
        hat: ((0, 0, 0), (0.03 * math.sin(4 * math.pi * p + 1.0), 0.02 * s, 0)),
        cash1: ((0, 0, 0.015 * b), (-0.03 * b, 0, 0)), cash2: ((0, 0, 0.015 * b), (-0.03 * b, 0, 0)),
        foot_l: (foot_pose(p), (0, 0, 0)), foot_r: (foot_pose((p + 0.5) % 1.0), (0, 0, 0)),
    }


def pose_dance(f):
    t = f - 1
    amp = min(1.0, t / 8.0, (DANCE_FRAMES - t) / 12.0)       # ease in and out so it starts and ends at rest
    amp = max(0.0, amp)
    beat = 2 * math.pi * t / 12.0                            # hop every 0.5 s
    sway = 2 * math.pi * t / 24.0
    turn = 2 * math.pi * t / 48.0
    hop = abs(math.sin(beat / 2))                            # 0..1 per beat
    lift_l = max(0.0, math.sin(sway)); lift_r = max(0.0, -math.sin(sway))
    return {
        root: ((0, 0, amp * 0.13 * hop), (0, amp * 0.16 * math.sin(sway), amp * 0.40 * math.sin(turn))),
        head: ((0, 0, 0), (amp * 0.13 * math.sin(beat + 0.5), amp * 0.10 * math.sin(sway + 1.0), amp * 0.18 * math.sin(sway + 0.6))),
        hat: ((0, 0, 0), (amp * 0.10 * math.sin(beat + 1.2), amp * 0.06 * math.sin(sway), 0)),
        cash1: ((0, 0, amp * 0.05 * math.sin(beat + 0.3)), (amp * 0.08 * math.sin(beat), 0, 0)),
        cash2: ((0, 0, amp * 0.05 * math.sin(beat + 0.3)), (amp * 0.08 * math.sin(beat), 0, 0)),
        foot_l: ((0, amp * 0.10 * math.sin(sway), amp * 0.20 * lift_l), (0, 0, 0)),
        foot_r: ((0, -amp * 0.10 * math.sin(sway), amp * 0.20 * lift_r), (0, 0, 0)),
    }


def add_clip(name, frames, fn):
    for o in ANIMATED:
        o.animation_data_create()
        act = bpy.data.actions.new(f"{o.name}_{name}")
        o.animation_data.action = act
        for f in range(1, frames + 2):                       # last key == first: exact loop
            dl, dr = fn(f if f <= frames else 1)[o]
            l0, r0 = REST[o.name]
            o.location = (l0.x + dl[0], l0.y + dl[1], l0.z + dl[2])
            o.rotation_euler = (r0.x + dr[0], r0.y + dr[1], r0.z + dr[2])
            o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_euler', frame=f)
        ad = o.animation_data
        tr = ad.nla_tracks.new(); tr.name = name
        st = tr.strips.new(name, 0, act)                      # start at 0 so clip time starts at 0 s
        if hasattr(st, 'action_slot') and act.slots:
            st.action_slot = act.slots[0]
        ad.action = None
        o.location, o.rotation_euler = REST[o.name][0], REST[o.name][1]


add_clip("Idle", IDLE_FRAMES, pose_idle)
add_clip("Walk", WALK_FRAMES, pose_walk)
add_clip("Dance", DANCE_FRAMES, pose_dance)

# ================================================================== 5. simple PBR materials (glass look)
GLASS = {  # name: (base colour linear, roughness, clearcoat, clearcoat roughness)
    "Duck_White": ((0.95, 0.94, 0.90), 0.28, 0.35, 0.15),
    "Duck_Orange": ((1.0, 0.40, 0.04), 0.28, 0.35, 0.15),
    "Duck_Orange_Dark": ((0.90, 0.32, 0.03), 0.28, 0.35, 0.15),
    "Hat_Blue": ((0.45, 0.68, 0.86), 0.38, 0.20, 0.15),
    "Hat_Blue_Dark": ((0.34, 0.56, 0.76), 0.38, 0.20, 0.15),
    "Cash_Green": ((0.26, 0.58, 0.32), 0.35, 0.20, 0.15),
    "Cash_Band": ((0.97, 0.89, 0.68), 0.35, 0.20, 0.15),
}


def simple(m, color, rough=0.9, coat=0.0, coat_rough=0.15, emit=None, tex=None, alpha_tex=False):
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (*color, 1.0); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0
    if coat:
        b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = coat_rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1.0); b.inputs['Emission Strength'].default_value = 1
    if tex is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = tex
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if alpha_tex:
            nt.links.new(t.outputs['Alpha'], b.inputs['Alpha']); m.surface_render_method = 'BLENDED'
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])


used = {m for o in O if o.type == 'MESH' for m in o.data.materials if m}
for m in used:
    if m.name in GLASS:
        c, r, cc, ccr = GLASS[m.name]; simple(m, c, r, cc, ccr)
    elif m.name == "Duck_Eye_Painted":
        simple(m, (0.16, 0.06, 0.03), 0.04, 1.0, 0.03, tex=eye_tex)   # glossy eye, gradient baked
    elif m.name == "Duck_EyeHighlight":
        simple(m, (1, 1, 1), 0.5, emit=(1, 1, 1))
    elif m.name == "Duck_Blush_Soft":
        simple(m, (1, 0.5, 0.55), 0.35, tex=blush_tex, alpha_tex=True)
    else:
        print("WARNING: unhandled material", m.name)

# ================================================================== 6. export
sc.frame_set(1)
polys = sum(len(o.data.polygons) for o in O if o.type == 'MESH')
print("objects:", len(O), "| polygons:", polys)
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_apply=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_lights=False, export_cameras=False,
    export_force_sampling=True, export_optimize_animation_size=False,
    export_optimize_animation_keep_anim_object=True,
)
