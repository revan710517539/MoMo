#!/usr/bin/env python3
"""Preserve source-safe rabbit fur on the reviewed MOMO016 v2 exit/settle bridge.

Exact reviewed candidate algorithm. Requires an existing motion cache containing
forward.bin/backward.bin (832x768x2 float32) and frame-0001..N+2.png with the
reviewed alpha trajectory. Fields come from prepare-rabbit-loop-flow.swift and
the prior interpolate-rabbit-seam.py run; this tool never computes new geometry.

Only --profile exit --frames 10 (A=carried gen112, B=original2) and --profile
settle --frames 2 (A=carried gen113, B=carried gen112) are supported. Endpoints
remain byte-identical; cubic RGB follows the existing inverse maps. Source-B
white-fur detail is separated before sampling, and its safe fixed material mask
(alpha margin>=18px, feature and scarf exclusion) shares the sampling coordinates.
The legacy destination mask still applies. No output blur, gain or sharpening.
Alpha is checked against the reviewed trajectory; protected RGB is checked
against its unchanged cubic baseline. Numerical checks do not prove anatomy or
lack of temporal crawling. --out must be a new directory; no defaults are edited.
"""
import argparse,json,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates,gaussian_filter,distance_transform_edt
p=argparse.ArgumentParser(description=__doc__)
for key in ['a','b','motion','out']:p.add_argument('--'+key,required=True,type=Path)
p.add_argument('--frames',required=True,type=int);p.add_argument('--profile',choices=['settle','exit'],default='exit');q=p.parse_args()
if (q.profile,q.frames) not in [('settle',2),('exit',10)]:raise ValueError('Only reviewed MOMO016 settle2/exit10 are supported')
if q.out.exists():raise ValueError('Output must not exist; never overwrite reviewed candidates')
q.out.mkdir(parents=True)
a=np.asarray(Image.open(q.a).convert('RGBA'),dtype=np.float32)/255;b=np.asarray(Image.open(q.b).convert('RGBA'),dtype=np.float32)/255
if a.shape!=b.shape or a.shape!=(768,832,4):raise ValueError('Only matching 832x768 reviewed rabbit assets are supported')
h,w=a.shape[:2];y,x=np.mgrid[:h,:w].astype(np.float32)
def sample(im,xx,yy,order=1):
 if im.ndim==2:return map_coordinates(im,[yy,xx],order=order,mode='nearest')
 return np.stack([map_coordinates(im[...,c],[yy,xx],order=order,mode='nearest') for c in range(im.shape[2])],-1)
f=np.fromfile(q.motion/'forward.bin',dtype=np.float32).reshape(h,w,2);g=np.fromfile(q.motion/'backward.bin',dtype=np.float32).reshape(h,w,2)
consf=np.linalg.norm(f+sample(g,x+f[...,0],y+f[...,1]),axis=2);consg=np.linalg.norm(g+sample(f,x+g[...,0],y+g[...,1]),axis=2)
# Identical field smoothing and inverse iterations to interpolate-rabbit-seam.py.
f=gaussian_filter(f,(1,1,0));g=gaussian_filter(g,(1,1,0));ap=a.copy();bp=b.copy();ap[...,:3]*=ap[...,3:4];bp[...,:3]*=bp[...,3:4]
clip=lambda v:np.clip(v,0,1)
circles=[(400,350,43),(278,338,28),(301,400,36)]
sourceDetail=bp[...,:3]-gaussian_filter(bp[...,:3],(1,1,0))
sourceMask=clip((b[...,:3].min(2)-.55)/.12)*clip((.23-(b[...,0]-b[...,2]))/.06)
sourceMask*=clip((distance_transform_edt(b[...,3]>.98)-18)/10)
for cx,cy,r in circles:sourceMask*=clip((np.hypot(x-cx,y-cy)-r-5)/12)
sourceMask*=clip((430-y)/14)+((y>515)*clip((y-515)/14));sourceMask=clip(sourceMask)
rows=[];frames=[];prev=None
for n in range(q.frames+2):
 t=n/(q.frames+1);s=t*t*(3-2*t);ax=x.copy();ay=y.copy();bx=x.copy();by=y.copy()
 for _ in range(4):
  af=sample(f,ax,ay);bg=sample(g,bx,by);ax=x-s*af[...,0];ay=y-s*af[...,1];bx=x-(1-s)*bg[...,0];by=y-(1-s)*bg[...,1]
 aa=sample(ap,ax,ay);bb=sample(bp,bx,by);aa3=sample(ap,ax,ay,3);bb3=sample(bp,bx,by,3)
 ca=np.exp(-sample(consf,ax,ay)/4);cb=np.exp(-sample(consg,bx,by)/4);wa=(1-s)*ca;wb=s*cb;den=np.maximum(wa+wb,1e-8)
 im=(aa*wa[...,None]+bb*wb[...,None])/den[...,None];alpha=im[...,3:4]
 cubic=(aa3[...,:3]*wa[...,None]+bb3[...,:3]*wb[...,None])/den[...,None]/np.maximum(alpha,1e-6)
 lowa=gaussian_filter(aa3[...,:3],(1,1,0));lowb=gaussian_filter(bb3[...,:3],(1,1,0))
 low=(lowa*wa[...,None]+lowb*wb[...,None])/den[...,None]
 single=(low+sample(sourceDetail,bx,by,3))/np.maximum(alpha,1e-6)
 mask=clip((cubic.min(2)-.55)/.12)*clip((.23-(cubic[...,0]-cubic[...,2]))/.06)
 mask*=clip((distance_transform_edt(alpha[...,0]>.95)-10)/8)
 for cx,cy,r in circles:mask*=clip((np.hypot(x-cx,y-cy)-r)/12)
 mask*=clip((440-y)/14)+((y>500)*clip((y-500)/14));mask=clip(mask)*clip(sample(sourceMask,bx,by))
 im[...,:3]=cubic*(1-mask[...,None])+single*mask[...,None]
 protectedRGB=np.uint8(np.clip(cubic*255+.5,0,255))
 if n==0:im=a.copy()
 elif n==q.frames+1:im=b.copy()
 pix=np.uint8(np.clip(im*255+.5,0,255))
 if n not in [0,q.frames+1] and not np.array_equal(pix[...,:3][mask==0],protectedRGB[mask==0]):raise RuntimeError('Protected cubic RGB changed')
 if not np.isfinite(im).all():raise RuntimeError('Nonfinite output')
 old=np.array(Image.open(q.motion/f'frame-{n+1:04d}.png').convert('RGBA'))
 if not np.array_equal(pix[...,3],old[...,3]):raise RuntimeError('Alpha trajectory diverged from reviewed motion')
 image=Image.fromarray(pix,'RGBA');image.save(q.out/f'frame-{n+1:04d}.png');frames.append(image)
 gray=pix[245:315,360:430,:3].mean(2)/255
 opaque=(pix[...,3]>240)&(mask>.9)
 row={'n':n,'highFrequencyRMS':float(np.std(gray-gaussian_filter(gray,1))),'alphaExact':True,'protectedRGBExact':True,'furRGBMean':np.mean(pix[...,:3][opaque]/255,axis=0).tolist() if opaque.any() else None}
 if prev is not None:
  row['furStepMAD']=float(np.abs(pix[...,:3].astype(float)-prev[...,:3])[opaque].mean()/255) if opaque.any() else None
 rows.append(row);prev=pix
 if n==(q.frames+1)//2:Image.fromarray(np.uint8(mask*255),'L').save(q.out/'mask.png')
shutil.copyfile(q.a,q.out/'frame-0001.png');shutil.copyfile(q.b,q.out/f'frame-{q.frames+2:04d}.png')
cols=4;cw=400;ch=400;sheet=Image.new('RGB',(cols*cw,((len(frames)+cols-1)//cols)*ch),'#d8d9cf')
for i,im in enumerate(frames):
 crop=im.crop((240,200,560,520)).resize((cw,ch));bg=Image.new('RGBA',crop.size,'#d8d9cf');bg.alpha_composite(crop);sheet.paste(bg.convert('RGB'),((i%cols)*cw,(i//cols)*ch));ImageDraw.Draw(sheet).text(((i%cols)*cw+4,(i//cols)*ch+4),str(i),fill='black')
sheet.save(q.out/'contact.jpg',quality=98)
report={'sourceA':str(q.a.resolve()),'sourceB':str(q.b.resolve()),'motion':str(q.motion.resolve()),'profile':q.profile,'frames':q.frames,'method':'MOMO016 v2 source-safe B detail and fixed source mask sampled together; existing inverse maps/alpha and cubic RGB; no gain or final blur','limits':'Real source B texture phase changes at first interior frame; existing geometry still uses reviewed flow. Numerical alpha equality is not anatomical approval.','metrics':rows}
(q.out/'metrics.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
