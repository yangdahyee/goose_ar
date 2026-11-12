"""Export assets/duck.blend to a WebXR-friendly GLB.

Usage: python tools/export_glb.py <in.blend> <out.glb>   (needs `pip install bpy`)

What it does: bakes metaballs into meshes, drops render-hidden objects,
replaces procedural materials with plain PBR, bakes the eye/blush shaders
to textures, and exports baked animation.
"""
import sys,tempfile
import bpy,bmesh
import numpy as np
src,dst=sys.argv[-2:]
bpy.ops.wm.open_mainfile(filepath=src)
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=16; sc.cycles.use_denoising=False
TEX=tempfile.mkdtemp()+"/"
SZ=256

# planar UVs from local XY of every eye/blush disc (same mapping for L and R)
bounds={}
for n in ("EyeP_L","EyeP_R","BlushP_L","BlushP_R"):
    o=bpy.data.objects[n]; me=o.data
    xs=[v.co.x for v in me.vertices]; ys=[v.co.y for v in me.vertices]
    bounds[n]=(min(xs),max(xs),min(ys),max(ys))
    bm=bmesh.new(); bm.from_mesh(me); uv=bm.loops.layers.uv.new("UVMap")
    x0,x1,y0,y1=bounds[n]
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv=((l.vert.co.x-x0)/(x1-x0),(l.vert.co.y-y0)/(y1-y0))
    bm.to_mesh(me); bm.free()
    print(n,[round(b,3) for b in bounds[n]])

def bake(obj,mat,name,btype,noncolor=False):
    img=bpy.data.images.new(name,SZ,SZ,alpha=False)
    if noncolor: img.colorspace_settings.name='Non-Color'
    nt=mat.node_tree; tn=nt.nodes.new('ShaderNodeTexImage'); tn.image=img; nt.nodes.active=tn
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
    kw=dict(type=btype,margin=8,use_clear=True)
    if btype=='DIFFUSE': kw['pass_filter']={'COLOR'}
    bpy.ops.object.bake(**kw)
    nt.nodes.remove(tn); return img

# --- eye color
eye=bpy.data.objects["EyeP_L"]
eimg=bake(eye,eye.data.materials[0],"eye_color",'DIFFUSE')
eimg.filepath_raw=TEX+"eye.png"; eimg.file_format='PNG'; eimg.save()

# --- blush alpha: temp material emitting the mix factor
bl=bpy.data.objects["BlushP_L"]; bm_=bl.data.materials[0]
tmp=bm_.copy(); nt=tmp.node_tree
mr=next(n for n in nt.nodes if n.type=='MAP_RANGE'); out=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
em=nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value=1
nt.links.new(mr.outputs['Result'],em.inputs['Color']); nt.links.new(em.outputs['Emission'],out.inputs['Surface'])
bl.data.materials[0]=tmp
mimg=bake(bl,tmp,"blush_mask",'EMIT',noncolor=True)
bl.data.materials[0]=bm_
a=np.array(mimg.pixels[:]).reshape(SZ,SZ,4)[:,:,0]
print("blush alpha range",a.min(),a.max(),"center",a[SZ//2,SZ//2],"edge",a[0,SZ//2])
rgba=np.zeros((SZ,SZ,4),dtype=np.float32); rgba[:,:,0]=1.0; rgba[:,:,1]=0.5; rgba[:,:,2]=0.55; rgba[:,:,3]=a
bimg=bpy.data.images.new("blush",SZ,SZ,alpha=True); bimg.colorspace_settings.name='sRGB'
# stored RGB is treated as sRGB when saved: write sRGB-encoded constant
def enc(c): return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
rgba[:,:,0]=enc(1.0); rgba[:,:,1]=enc(0.5); rgba[:,:,2]=enc(0.55)
bimg.pixels=rgba.ravel().tolist(); bimg.alpha_mode='STRAIGHT'
bimg.filepath_raw=TEX+"blush.png"; bimg.file_format='PNG'; bimg.save()
eimg2=bpy.data.images.load(TEX+"eye.png"); bimg2=bpy.data.images.load(TEX+"blush.png")

# --- metaballs -> meshes
sc.frame_set(1); dg=bpy.context.evaluated_depsgraph_get()
for mb in [o for o in bpy.data.objects if o.type=='META']:
    e=mb.evaluated_get(dg); me=bpy.data.meshes.new_from_object(e,preserve_all_data_layers=True,depsgraph=dg)
    ob=bpy.data.objects.new(mb.name+"_Mesh",me); sc.collection.objects.link(ob)
    ob.parent=mb.parent; ob.matrix_parent_inverse=mb.matrix_parent_inverse.copy(); ob.matrix_basis=mb.matrix_basis.copy()
    for m in mb.data.materials: me.materials.append(m)
    for p in me.polygons: p.use_smooth=True
    bpy.data.objects.remove(mb)
for n in ("Ground","Light","Camera","Cam_Target"):
    o=bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.hide_render or o.hide_get(): bpy.data.objects.remove(o)

def simple(m,color,rough=0.9,emit=None,tex=None,alpha_tex=None):
    m.use_nodes=True; nt=m.node_tree; nt.nodes.clear()
    out=nt.nodes.new('ShaderNodeOutputMaterial'); b=nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value=color; b.inputs['Roughness'].default_value=rough; b.inputs['Metallic'].default_value=0
    if emit: b.inputs['Emission Color'].default_value=emit; b.inputs['Emission Strength'].default_value=1
    if tex is not None:
        t=nt.nodes.new('ShaderNodeTexImage'); t.image=tex; nt.links.new(t.outputs['Color'],b.inputs['Base Color'])
        if alpha_tex:
            nt.links.new(t.outputs['Alpha'],b.inputs['Alpha']); m.surface_render_method='BLENDED'
    nt.links.new(b.outputs['BSDF'],out.inputs['Surface'])
for m in bpy.data.materials:
    if not m.use_nodes or m.users==0: continue
    p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if m.name=='Duck_Eye_Painted': simple(m,(0.16,0.06,0.03,1),0.15,tex=eimg2)
    elif m.name=='Duck_EyeHighlight': simple(m,(1,1,1,1),0.5,emit=(1,1,1,1))
    elif m.name=='Duck_Blush_Soft': simple(m,(1,0.5,0.55,1),0.9,tex=bimg2,alpha_tex=True)
    elif p:
        r=p.inputs['Roughness'].default_value
        simple(m,tuple(p.inputs['Base Color'].default_value),max(0.6,r-0.1) if r>0.5 else r)

# ---------------------------------------------------------------- animations
# Clips: Idle (breathing), Walk (waddle), Dance (existing). Z up, the duck faces -Y.
# Walk is built so the feet do not slide: stance speed = 2*STRIDE / (WALK_FRAMES/fps).
import math
WALK_FRAMES=16; IDLE_FRAMES=48
STRIDE=0.35; FOOT_LIFT=0.12
HIPS0=(0,0,0.15); NECK0=(0,-0.05,1.3); ARMS0=(0,-0.55,1.1)

def split_feet():
    feet=bpy.data.objects.get("Feet_Meta_Mesh")
    bpy.ops.object.select_all(action='DESELECT'); feet.select_set(True); bpy.context.view_layer.objects.active=feet
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    parts=[o for o in bpy.data.objects if o.name.startswith("Feet_Meta_Mesh")]
    assert len(parts)==2,len(parts)
    for o in parts:
        cx=sum(v.co.x for v in o.data.vertices)/len(o.data.vertices)
        o.name="Foot_L" if cx>0 else "Foot_R"
    return bpy.data.objects["Foot_L"],bpy.data.objects["Foot_R"]

def foot_pose(p):
    if p<0.5: return (0,-STRIDE+2*STRIDE*(p/0.5),0)                      # stance: slides back
    q=(p-0.5)/0.5; return (0,STRIDE-2*STRIDE*q,FOOT_LIFT*math.sin(math.pi*q))  # swing: lifts forward

def add_clip(obj,name,start,end,fn):
    ad=obj.animation_data_create(); act=bpy.data.actions.new(f"{obj.name}_{name}")
    ad.action=act
    for f in range(start,end+1):
        loc,rot=fn(f); obj.location=loc; obj.rotation_euler=rot
        obj.keyframe_insert('location',frame=f); obj.keyframe_insert('rotation_euler',frame=f)
    push_to_nla(obj,name)

def push_to_nla(obj,name):
    ad=obj.animation_data; act=ad.action
    tr=ad.nla_tracks.new(); tr.name=name
    st=tr.strips.new(name,0,act)   # start at 0 so clip time starts at 0 s
    if hasattr(st,'action_slot') and act.slots: st.action_slot=act.slots[0]
    ad.action=None

def build_animations():
    foot_l,foot_r=split_feet()
    H,N,A=bpy.data.objects["Dance_Hips"],bpy.data.objects["Dance_Neck"],bpy.data.objects["Dance_Arms"]
    push_to_nla(H,"Dance"); push_to_nla(N,"Dance"); push_to_nla(A,"Dance")   # existing dance
    for ft in (foot_l,foot_r): add_clip(ft,"Dance",1,241,lambda f:((0,0,0),(0,0,0)))  # rest keys so Walk does not leak
    def idle(kind):
        def fn(f):
            p=(f-1)/IDLE_FRAMES; s=math.sin(2*math.pi*p); s2=math.sin(2*math.pi*p+0.8)
            if kind=='H': return ((0,0,HIPS0[2]+0.012*s),(0,0.02*s,0))
            if kind=='N': return ((0,NECK0[1],NECK0[2]+0.008*s2),(0.02*s2,0,0.03*s))
            return ((0,ARMS0[1],ARMS0[2]+0.012*math.sin(2*math.pi*p+0.4)),(0,0,0))
        return fn
    def walk(kind,phase=0.0):
        def fn(f):
            p=(f-1)/WALK_FRAMES; s=math.sin(2*math.pi*p); b=math.sin(4*math.pi*p)
            if kind=='H': return ((0,0,HIPS0[2]+0.04*(1-math.cos(4*math.pi*p))/2),(0,0.10*s,0.10*s))
            if kind=='N': return ((0,NECK0[1],NECK0[2]-0.012*math.cos(4*math.pi*p)),(0.04*math.sin(4*math.pi*p+0.5),-0.08*s,-0.07*s))
            if kind=='A': return ((0,ARMS0[1],ARMS0[2]+0.015*b),(-0.03*b,0,0))
            return (foot_pose((p+phase)%1.0),(0,0,0))
        return fn
    for kind,ob in (('H',H),('N',N),('A',A)):
        add_clip(ob,"Idle",1,IDLE_FRAMES+1,idle(kind)); add_clip(ob,"Walk",1,WALK_FRAMES+1,walk(kind))
    for ft in (foot_l,foot_r): add_clip(ft,"Idle",1,IDLE_FRAMES+1,lambda f:((0,0,0),(0,0,0)))
    add_clip(foot_l,"Walk",1,WALK_FRAMES+1,walk('F',0.0)); add_clip(foot_r,"Walk",1,WALK_FRAMES+1,walk('F',0.5))
    for ob in (H,N,A,foot_l,foot_r): ob.location=ob.location  # leave at last sampled value; NLA drives the export
build_animations()
sc.frame_set(1)
bpy.ops.export_scene.gltf(filepath=dst,export_format='GLB',export_apply=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_lights=False,export_cameras=False,export_force_sampling=True,export_optimize_animation_size=False,export_optimize_animation_keep_anim_object=True)
