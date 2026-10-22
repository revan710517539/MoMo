#!/usr/bin/env python3
"""MOMO018: continuous specular light within the reviewed exit iris only.

Uses the actual colour-corrected bridge reflection, not raw-B subtraction. A
single positive catchlight island is extracted inside the pupil; a 9px opening
estimates the dark base only under that light island. It is not an output eye or
fur filter. The same real catchlight moves by less than3px inside the pupil, with
intensity bounded to measured endpoint peaks; no eye/iris geometry is moved.
A's glint anchor follows the existing reviewed flow, so redetection cannot jump
between iris rim and reflection. No whole-eye copy, shape scaling, fur mixing,
sharpening or gain on image edges. Everything outside the pupil and all alpha
remain exact; endpoints copy bridge files. Asset-specific832x768,12-frame exit.
Requires numpy/scipy/Pillow and reviewed motion. Refuses existing output.
"""
from pathlib import Path
import numpy as np,json
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates,gaussian_filter,grey_opening,label,binary_fill_holes,binary_closing,distance_transform_edt
import argparse,shutil
p=argparse.ArgumentParser(description=__doc__)
for k in ['bridge','source-a','motion','out']:p.add_argument('--'+k,type=Path,required=True)
q=p.parse_args();O=q.out
if O.exists():raise ValueError('Output must be new')
O.mkdir(parents=True)
A=np.array(Image.open(q.source_a)).astype(np.float32)/255
if A.shape!=(768,832,4):raise ValueError('Only reviewed832x768 source supported')
h,w=A.shape[:2];y,x=np.mgrid[:h,:w].astype(np.float32)
f=gaussian_filter(np.fromfile(q.motion/'forward.bin',np.float32).reshape(h,w,2),(1,1,0))
luma=lambda v:v@np.array([.2126,.7152,.0722],np.float32)
def sample(v,xx,yy,order=1):return np.stack([map_coordinates(v[...,i],[yy,xx],order=order,mode='nearest') for i in range(v.shape[2])],-1)
def island(v):
 roi=np.zeros((h,w),bool);roi[316:370,370:435]=True
 labs,_=label((luma(v)<.3)&roi);sizes=np.bincount(labs.ravel());sizes[0]=0
 pupil=binary_fill_holes(binary_closing(labs==sizes.argmax(),iterations=2))
 if not 300<int(pupil.sum())<2500:raise ValueError('Iris detection outside reviewed bounds')
 safe=distance_transform_edt(pupil)>=2
 lum=luma(v);seed=(lum>.32)&safe&(y<350)&roi
 labs,_=label(seed);sizes=np.bincount(labs.ravel());sizes[0]=0
 if sizes.max()==0:raise ValueError('no glint')
 glint=labs==sizes.argmax();near=distance_transform_edt(~glint)
 base=np.stack([grey_opening(v[...,c],size=(9,9)) for c in range(3)],-1)
 support=(near<2.5)&safe&(luma(v-base)>.015)
 layer=np.maximum(v-base,0)*support[...,None]
 weights=np.maximum(lum-.30,0)*glint;den=weights.sum();center=np.array([(weights*x).sum()/den,(weights*y).sum()/den])
 return layer,center,pupil,float(lum[glint].max()),int(glint.sum())
sourceLayer,sourceCenter,_,sourcePeak,_=island(A[...,:3])
rows=[];ims=[]
for n in range(12):
 old=np.array(Image.open(q.bridge/f'frame-{n+1:04d}.png'))
 if old.shape!=A.shape:raise ValueError('Bridge dimensions differ')
 rgb=old[...,:3].astype(np.float32)/255
 t=n/11;s=t*t*(3-2*t);ax=x.copy();ay=y.copy()
 for _ in range(4):af=sample(f,ax,ay);ax=x-s*af[...,0];ay=y-s*af[...,1]
 aw=sample(A[...,:3],ax,ay,3)
 if n in [0,11]:pix=old.copy();rows.append({'n':n,'endpointExact':True})
 else:
  lb,cb,pupil,pb,areaB=island(rgb)
  la=sample(sourceLayer,ax,ay,3);lw=np.maximum(luma(la),0);ca=np.array([(lw*x).sum()/lw.sum(),(lw*y).sum()/lw.sum()]);pa=float(luma(aw)[lw>.03].max())
  target=(1-s)*ca+s*cb;shift=target-cb
  if np.linalg.norm(shift)>3:raise ValueError('Reflection correspondence out of reviewed bounds')
  shifted=sample(lb,x-shift[0],y-shift[1],1)
  base=rgb-lb;targetPeak=(1-s)*pa+s*pb
  peakAt=np.unravel_index(luma(shifted).argmax(),(h,w));baseAt=float(luma(base)[peakAt]);amp=max(0,(targetPeak-baseAt))/max(float(luma(shifted)[peakAt]),1e-6)
  if not 0<=amp<=1.05:raise ValueError('Reflection intensity outside reviewed range')
  shifted*=amp
  allowed=distance_transform_edt(pupil)>=1
  shifted*=allowed[...,None]
  result=base+shifted
  if not np.isfinite(result).all() or np.any((result<0)|(result>1)):raise ValueError('Reflection would clip')
  pix=np.dstack([np.uint8(np.clip(result*255+.5,0,255)),old[...,3]])
  changed=(pix[...,:3]!=old[...,:3]).any(2);assert not np.any(changed&~pupil)
  if changed.sum()>200:raise ValueError('Reflection changed too much of the iris')
  rows.append({'n':n,'Apeak':pa,'Bpeak':pb,'targetPeak':targetPeak,'actualPeak':float(luma(result)[pupil].max()),'translation':shift.tolist(),'intensityFactor':float(amp),'changedPixels':int(changed.sum()),'newClip':int(np.sum((result<0)|(result>1))),'alphaExact':True})
 assert np.array_equal(pix[...,3],old[...,3])
 Image.fromarray(pix).save(O/f'frame-{n+1:04d}.png');ims.append((n,old,pix))
sheet=Image.new('RGB',(6*220,4*260),'#e5e6df')
for i,(n,old,pix) in enumerate(ims):
 for j,im in enumerate([old,pix]):
  crop=Image.fromarray(im).convert('RGBA').crop((350,290,460,420)).resize((220,260));bg=Image.new('RGBA',crop.size,'#e5e6df');bg.alpha_composite(crop);pos=((i%6)*220,((i//6)*2+j)*260);sheet.paste(bg.convert('RGB'),pos);ImageDraw.Draw(sheet).text(pos,str(n)+(' old' if j==0 else ' light'),fill='black')
sheet.save(O/'contact.png');(O/'metrics.json').write_text(json.dumps(rows,indent=2))
print(rows)

for i in [1,12]:shutil.copyfile(q.bridge/f'frame-{i:04d}.png',O/f'frame-{i:04d}.png')
