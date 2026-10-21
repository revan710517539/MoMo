#!/usr/bin/env python3
"""Build the reviewed MOMO017 single-source RGB transition, not an RGB dissolve.

832x768 reviewed rabbit only. Uses existing forward/backward Vision fields and
frame-0001..N+2.png alpha trajectory; never computes a new motion field. B RGB is
sampled once with cubic interpolation and unpremultiplied by its own alpha.
Only when B alpha<=.02 is A selected. A normalized, sigma4 colour-difference
field carries broad lighting towards B; the output image is never blurred or
sharpened, and the two high-frequency textures are never averaged.

--profile entry: 6 internal frames; --profile exit:10 internal frames.
Default boundary weighting uses B alpha. --edge-mode density reproduces the
earlier entry-light4 diagnostic candidate; production uses the reviewed palette
entry with alpha weighting.
Endpoints are exact source file copies. This cannot make unrelated source fur
or iris highlights identical. Review colour, contour, detail and actual playback;
alpha equality alone is not visual acceptance. Requires Pillow/numpy/scipy and
existing reviewed motion cache. --out must be new; no defaults are overwritten.
"""
from pathlib import Path
import argparse,json,shutil
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter,map_coordinates
p=argparse.ArgumentParser(description=__doc__)
for key in ['a','b','motion','out']:p.add_argument('--'+key,type=Path,required=True)
p.add_argument('--profile',choices=['entry','exit'],required=True);p.add_argument('--edge-mode',choices=['alpha','density'],default='alpha');q=p.parse_args()
if q.out.exists():raise ValueError('Output must be a new directory')
a=np.array(Image.open(q.a).convert('RGBA'),dtype=np.float32)/255
b=np.array(Image.open(q.b).convert('RGBA'),dtype=np.float32)/255
if a.shape!=b.shape or a.shape!=(768,832,4):raise ValueError('Only reviewed 832x768 RGBA sources supported')
h,w=a.shape[:2];y,x=np.mgrid[:h,:w].astype(np.float32)
def sample(im,xx,yy,order=1):
 return np.stack([map_coordinates(im[...,c],[yy,xx],order=order,mode='nearest') for c in range(im.shape[2])],-1)
f=gaussian_filter(np.fromfile(q.motion/'forward.bin',dtype=np.float32).reshape(h,w,2),(1,1,0))
g=gaussian_filter(np.fromfile(q.motion/'backward.bin',dtype=np.float32).reshape(h,w,2),(1,1,0))
if not np.isfinite(f).all() or not np.isfinite(g).all():raise ValueError('Nonfinite field')
ap=a.copy();ap[...,:3]*=ap[...,3:4];bp=b.copy();bp[...,:3]*=bp[...,3:4]
count=6 if q.profile=='entry' else 10;q.out.mkdir(parents=True);rows=[]
for n in range(count+2):
 t=n/(count+1);s=t*t*(3-2*t);ax=x.copy();ay=y.copy();bx=x.copy();by=y.copy()
 for _ in range(4):
  af=sample(f,ax,ay);bg=sample(g,bx,by)
  ax=x-s*af[...,0];ay=y-s*af[...,1];bx=x-(1-s)*bg[...,0];by=y-(1-s)*bg[...,1]
 aa=sample(ap,ax,ay,3);bb=sample(bp,bx,by,3)
 old=np.array(Image.open(q.motion/f'frame-{n+1:04d}.png').convert('RGBA'))
 rgbA=aa[...,:3]/np.maximum(aa[...,3:4],1e-6);rgbB=bb[...,:3]/np.maximum(bb[...,3:4],1e-6)
 valid=((aa[...,3]>.98)&(bb[...,3]>.98)).astype(np.float32)
 numerator=gaussian_filter((rgbA-rgbB)*valid[...,None],(4,4,0));denominator=gaussian_filter(valid,4)
 correction=numerator/np.maximum(denominator[...,None],1e-6 if q.edge_mode=='density' else 1e-8)
 edgeWeight=np.minimum(denominator/.9,1) if q.edge_mode=='density' else np.clip((bb[...,3]-.98)/.02,0,1)
 if q.edge_mode=='density':
  rgb=np.where((bb[...,3]>.02)[...,None],rgbB,rgbA)+(1-s)*correction*edgeWeight[...,None]
 else:
  rgb=np.where((bb[...,3]>.02)[...,None],rgbB+(1-s)*correction*edgeWeight[...,None],rgbA)
 if not np.isfinite(rgb).all():raise ValueError('Nonfinite RGB')
 pix=np.dstack([np.uint8(np.clip(rgb*255+.5,0,255)),old[...,3]])
 if n==0:pix=np.uint8(a*255+.5)
 elif n==count+1:pix=np.uint8(b*255+.5)
 if not np.array_equal(pix[...,3],old[...,3]):raise ValueError('Reviewed alpha changed')
 Image.fromarray(pix,'RGBA').save(q.out/f'frame-{n+1:04d}.png')
 rows.append({'frame':n+1,'alphaExact':True,'opaqueFallbackAPixels':int(np.sum((old[...,3]>242)&(bb[...,3]<=.02)))})
shutil.copyfile(q.a,q.out/'frame-0001.png');shutil.copyfile(q.b,q.out/f'frame-{count+2:04d}.png')
(q.out/'manifest.json').write_text(json.dumps({'profile':q.profile,'frames':count+2,'sourceA':str(q.a.resolve()),'sourceB':str(q.b.resolve()),'sigma':4,'method':'single B RGB + low-frequency colour-difference correction; no output blur or sharpening','framesChecked':rows},indent=2)+'\n')
