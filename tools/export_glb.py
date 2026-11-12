"""Export assets/duck.blend to a WebXR-friendly GLB.

Usage: python tools/export_glb.py <in.blend> <out.glb>   (needs `pip install bpy`)

What it does: bakes metaballs into meshes, drops render-hidden objects,
replaces procedural materials with plain PBR, bakes the eye/blush shaders
to textures, and exports baked animation.
"""
import sys,tempfile,bmesh,numpy as np
import bpy
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
sc.frame_set(1)
bpy.ops.export_scene.gltf(filepath=dst,export_format='GLB',export_apply=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS',export_lights=False,export_cameras=False,export_force_sampling=True,export_frame_range=True)
