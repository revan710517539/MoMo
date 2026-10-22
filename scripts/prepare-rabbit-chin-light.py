#!/usr/bin/env python3
"""Reproduce the reviewed cached chin-tail illumination candidate (105..124).

Explicit dependencies: reviewed gen112 full-precision application mask .npy,
reviewed corrected gen112 anchor PNG, its fixed3-channel RGB additive offset,
original palette/source frame directory, and existing original2->gen Vision
backward-0105.bin..0124.bin cache (832x768x2 little-endian float32).

The mask/offset are reviewed inputs, not silently refitted here. Mask provenance
is the shared-white-chin fit and broad application envelope established for the
anchor. This helper does NOT discover anatomy, estimate flow or read another
local script. Flow only transports the application mask; RGB is never warped.
Gaussian1 retains the reviewed cache-field processing, not an output filter.

Only105..124 at832x768 RGBA are supported.105 copies the original file;112 checks
computed pixels against the reviewed PNG and copies that PNG byte for byte.
Other output frames use the unchanged reviewed arithmetic. Output must be new.
The105->112 smoothstep is a light ramp, not whole-loop constant illumination.
Requires NumPy, Pillow and SciPy. No application assets/defaults are edited.
"""
from pathlib import Path
import argparse,hashlib,json,shutil
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter,map_coordinates,distance_transform_edt

p=argparse.ArgumentParser(description=__doc__)
for key in ['source-dir','flow-cache','anchor-mask','anchor-png','out']:
 p.add_argument('--'+key,type=Path,required=True)
p.add_argument('--rgb-offset',nargs=3,type=float,required=True,metavar=('R','G','B'))
q=p.parse_args()
if q.out.exists():raise ValueError('Output must be a fresh directory')
h,w=768,832;y,x=np.mgrid[:h,:w].astype(np.float32)
clip=lambda a:np.clip(a,0,1)
fixed=np.asarray(q.rgb_offset,dtype=np.float32)
if not np.isfinite(fixed).all() or np.max(np.abs(fixed))>=.04:
 raise ValueError('Reviewed additive RGB offset must be finite and abs<.04')
anchor=np.load(q.anchor_mask,allow_pickle=False)
if anchor.shape!=(h,w) or anchor.dtype.kind!='f' or not np.isfinite(anchor).all() or anchor.min()<0 or anchor.max()>1:
 raise ValueError('Anchor must be a finite 768x832 floating material mask in [0,1]')
chinROI=(x>235)&(x<485)&(y>405)&(y<470)
if np.any(anchor[~chinROI]>0):raise ValueError('Anchor extends outside the reviewed chin envelope')

def read_rgba(path):
 im=Image.open(path)
 if im.size!=(w,h) or im.mode!='RGBA':raise ValueError(f'Expected832x768 RGBA:{path}')
 return np.array(im,dtype=np.float32)/255

def read_flow(n):
 path=q.flow_cache/f'backward-{n:04d}.bin'
 if path.stat().st_size!=h*w*2*4:raise ValueError(f'Invalid flow size:{path}')
 field=np.fromfile(path,dtype=np.float32).reshape(h,w,2)
 if not np.isfinite(field).all():raise ValueError(f'Nonfinite flow:{path}')
 return gaussian_filter(field,(1,1,0))

def sample(im,xx,yy,order=1):
 if im.ndim==2:return map_coordinates(im,[yy,xx],order=order,mode='nearest')
 return np.stack([map_coordinates(im[...,c],[yy,xx],order=order,mode='nearest') for c in range(im.shape[2])],-1)

def green(im):
 rgb=im[...,:3];mx=rgb.max(2);mn=rgb.min(2);d=mx-mn;sat=d/np.maximum(mx,1e-8);hue=np.zeros_like(d)
 for c in range(3):
  k=(mx==rgb[...,c])&(d>1e-8)
  if c==0:hue[k]=((rgb[...,1]-rgb[...,2])[k]/d[k])%6
  elif c==1:hue[k]=(rgb[...,2]-rgb[...,0])[k]/d[k]+2
  else:hue[k]=(rgb[...,0]-rgb[...,1])[k]/d[k]+4
 hue/=6
 return (hue>.100)&(hue<.255)&(sat>.15)&((rgb[...,1]-rgb[...,2])>.025)

anchorG=read_flow(112)
anchorPNG=np.uint8(read_rgba(q.anchor_png)*255+.5)
source112=read_rgba(q.source_dir/'frame-0112.png')
anchorComputed=source112.copy();anchorComputed[...,:3]+=fixed*anchor[...,None]
if np.any((anchorComputed<0)|(anchorComputed>1)) or not np.array_equal(np.uint8(anchorComputed*255+.5),anchorPNG):
 raise ValueError('Anchor/source112/mask/offset disagree; refuse a silently changed fit')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
q.out.mkdir(parents=True);F=q.out/'frames';M=q.out/'masks';F.mkdir();M.mkdir()
rows=[]
for n in range(105,125):
 path=q.source_dir/f'frame-{n:04d}.png';a=read_rgba(path);g=read_flow(n);bx=x.copy();by=y.copy()
 for _ in range(4):v=sample(g,bx,by);bx=x-v[...,0];by=y-v[...,1]
 ag=sample(anchorG,bx,by);xx=bx+ag[...,0];yy=by+ag[...,1];mask=clip(sample(anchor,xx,yy))
 noseMouth=sample((np.hypot(x-301,y-400)<40).astype(np.float32),xx,yy)>.001
 eyes=sample(((np.hypot(x-400,y-350)<50)|(np.hypot(x-278,y-338)<35)).astype(np.float32),xx,yy)>.001
 safety=(a[...,3]>.999)&(distance_transform_edt(a[...,3]>.999)>20)&~green(a)&~noseMouth&~eyes
 before=mask.copy();mask*=safety
 if n==112:
  mask=anchor.copy()
  noseMouth=np.hypot(x-301,y-400)<40
  eyes=(np.hypot(x-400,y-350)<50)|(np.hypot(x-278,y-338)<35)
 t=clip((n-105)/7);weight=t*t*(3-2*t);b=a.copy();b[...,:3]+=fixed*mask[...,None]*weight
 if not np.isfinite(b).all() or np.any((b<0)|(b>1)):raise ValueError(f'Clipping/nonfinite RGB at{n}')
 pix=np.uint8(b*255+.5);old=np.uint8(a*255+.5)
 if not np.array_equal(pix[...,3],old[...,3]):raise ValueError(f'Alpha changed at{n}')
 if not np.array_equal(pix[mask==0],old[mask==0]):raise ValueError(f'Protected outer RGB changed at{n}')
 if not np.array_equal(pix[green(a)],old[green(a)]):raise ValueError(f'Green scarf changed at{n}')
 if not np.array_equal(pix[noseMouth],old[noseMouth]) or not np.array_equal(pix[eyes],old[eyes]):
  raise ValueError(f'Protected eye/nose/mouth RGB changed at{n}')
 introduced=int(np.sum((old[...,:3]<255)&(pix[...,:3]==255)))
 if introduced:raise ValueError(f'New8-bit saturation at{n}:{introduced}')
 target=F/f'frame-{n:04d}.png'
 if n==105:shutil.copyfile(path,target)
 elif n==112:
  if not np.array_equal(pix,anchorPNG):raise ValueError('Computed112 changed from reviewed anchor')
  shutil.copyfile(q.anchor_png,target)
 else:Image.fromarray(pix).save(target)
 Image.fromarray(np.uint8(mask*255)).save(M/f'frame-{n:04d}.png')
 rows.append({'n':n,'sourceSHA256':sha(path),'flowSHA256':sha(q.flow_cache/f'backward-{n:04d}.bin'),'weight':float(weight),'alphaExact':True,'outsideMaskExact':True,'eyesNoseMouthExact':True,'scarfMaskRGBExact':True,'introducedClips':introduced,'changedPixels':int(np.sum(np.any(pix!=old,2))),'dynamicSafetyClippedMaskPixels':int(np.sum((before>0)&~safety)),'anchorExplicitAt112':n==112,'maskPixels':int(np.sum(mask>0)),'maximumRGBAddedFloat':(fixed*weight*mask.max()).tolist()})
if sha(F/'frame-0105.png')!=sha(q.source_dir/'frame-0105.png') or sha(F/'frame-0112.png')!=sha(q.anchor_png):
 raise ValueError('Exact source105/anchor112 file contract failed')
metadata={'sourceDirectory':str(q.source_dir.resolve()),'flowCacheDirectory':str(q.flow_cache.resolve()),'fixedRGBOffset':fixed.tolist(),'anchorMask':str(q.anchor_mask.resolve()),'anchorMaskSHA256':sha(q.anchor_mask),'anchorPNG':str(q.anchor_png.resolve()),'anchorPNGSHA256':sha(q.anchor_png),'source112SHA256':sha(q.source_dir/'frame-0112.png'),'anchorFlow112SHA256':sha(q.flow_cache/'backward-0112.bin'),'anchor112FileExact':True,'source105FileExact':True,'method':'Reviewed additive chin field; cached mask-only material-coordinate transport; no whole-RGB warp/filter/mix/gain','limits':'105->112 is a7-frame light ramp on turning action,112+fixed parameter; material mask coverage can change with pose. No claim of constant whole-loop light or fur/highlight restoration.','frames':rows}
(q.out/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps({'frames':20,'source105FileExact':True,'anchor112FileExact':True,'output':str(q.out)}))
