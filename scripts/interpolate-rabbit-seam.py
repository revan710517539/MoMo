#!/usr/bin/env python3
"""Evidence-first, short RGBA endpoint interpolation using macOS Vision.

Only small corresponding poses are suitable. This is not a character re-generator
or a guarantee of zero deformation. Writes a separate output folder; never edits
source PNGs or public assets. Requires existing Pillow/numpy/scipy, Swift/Vision,
and ffmpeg. Example:
  python3 scripts/interpolate-rabbit-seam.py --a A.png --b B.png \
    --out evidence/trial --frames 10 --compute

Outputs endpoints (exact source file copies), interior premultiplied-alpha frames,
flow consistency/Jacobian/bounds audit, a contact sheet and 12fps inspection clip.
The caller must visually accept anatomy before integrating interior frames only.
"""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates, gaussian_filter
import argparse,json,subprocess,shutil
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--a',required=True);p.add_argument('--b',required=True);p.add_argument('--out',required=True);p.add_argument('--frames',type=int,default=10);p.add_argument('--compute',action='store_true');args=p.parse_args()
if not 1 <= args.frames <= 24:raise ValueError('Use 1..24 interior frames for a short bridge')
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
a=np.asarray(Image.open(args.a).convert('RGBA'),dtype=np.float32)/255;b=np.asarray(Image.open(args.b).convert('RGBA'),dtype=np.float32)/255
if a.shape!=b.shape:raise ValueError('Endpoint dimensions must match')
h,w=a.shape[:2];y,x=np.mgrid[:h,:w].astype(np.float32)
if args.compute:
 for src,dst,name in [(args.a,args.b,'forward'),(args.b,args.a,'backward')]:subprocess.run(['swift',str(ROOT/'scripts/prepare-rabbit-loop-flow.swift'),src,dst,str(out/f'{name}.bin')],check=True)
f=np.fromfile(out/'forward.bin',dtype=np.float32).reshape(h,w,2);g=np.fromfile(out/'backward.bin',dtype=np.float32).reshape(h,w,2)
def sample(im,xx,yy):
 if im.ndim==2:return map_coordinates(im,[yy,xx],order=1,mode='nearest')
 return np.stack([map_coordinates(im[...,c],[yy,xx],order=1,mode='nearest') for c in range(im.shape[2])],-1)
# Vision source-to-target displacement; validate against opposite convention and sign.
errors={}
for name,flow in [('f',f),('g',g)]:
 for s in [-1,1]:errors[f'{name}:{s}']=float(np.mean(abs(a-sample(b,x+s*flow[...,0],y+s*flow[...,1]))))
# Forward f lives on A grid; backward g lives on B grid.
consf=np.linalg.norm(f+sample(g,x+f[...,0],y+f[...,1]),axis=2);consg=np.linalg.norm(g+sample(f,x+g[...,0],y+g[...,1]),axis=2)
mask=(a[...,3]>.9)|(b[...,3]>.9)
# Smooth the field by one source pixel; no hand-crafted anatomy anchors or TPS.
f=gaussian_filter(f,(1,1,0));g=gaussian_filter(g,(1,1,0))
def jac(flow):
 dx=np.gradient(flow[...,0]);dy=np.gradient(flow[...,1]);return (1+dx[1])*(1+dy[0])-dx[0]*dy[1]
metrics={'warpErrors':errors,'consistencyP50P90P99':np.percentile(consf[mask],[50,90,99]).tolist(),'flowMagnitudeP50P90P99':np.percentile(np.linalg.norm(f[mask],axis=1),[50,90,99]).tolist(),'fullJacobianP1P50P99':np.percentile(jac(f)[mask],[1,50,99]).tolist()}
metrics['maxDisplacementPixels']=float(np.max(np.linalg.norm(f[mask],axis=1)));metrics['fullJacobianMin']=float(jac(f)[mask].min());metrics['fullNegativeJacobianFraction']=float(np.mean(jac(f)[mask]<=0))
if metrics['flowMagnitudeP50P90P99'][-1]>24:raise RuntimeError('Flow unsuitable for short anatomy-preserving trial; use no candidate')
ap=a.copy();ap[...,:3]*=ap[...,3:4];bp=b.copy();bp[...,:3]*=bp[...,3:4]
frames=[];mids=[];bounds=[]
for n in range(args.frames+2):
 t=n/(args.frames+1);s=t*t*(3-2*t)
 if n==0:im=a.copy()
 elif n==args.frames+1:im=b.copy()
 else:
  # Fixed-point inverse maps converge to correct intermediate trajectories.
  ax=x.copy();ay=y.copy();bx=x.copy();by=y.copy()
  for _ in range(4):
   af=sample(f,ax,ay);bg=sample(g,bx,by);ax=x-s*af[...,0];ay=y-s*af[...,1];bx=x-(1-s)*bg[...,0];by=y-(1-s)*bg[...,1]
  aa=sample(ap,ax,ay);bb=sample(bp,bx,by)
  # Confidence only suppresses bad correspondence; don't erase either endpoint.
  ca=np.exp(-sample(consf,ax,ay)/4);cb=np.exp(-sample(consg,bx,by)/4)
  wa=(1-s)*ca;wb=s*cb;den=np.maximum(wa+wb,1e-8);im=(aa*wa[...,None]+bb*wb[...,None])/den[...,None]
  im[...,:3]/=np.maximum(im[...,3:4],1e-6)
  nj=float(np.mean(jac(f*s)[mask]<=0));njb=float(np.mean(jac(g*(1-s))[mask]<=0))
  if nj>0 or njb>0:raise RuntimeError('Intermediate field folds; reject this candidate')
  mids.append({'n':n,'t':s,'negativeJacobianFractionA':nj,'negativeJacobianFractionB':njb,'minimumJacobianA':float(jac(f*s)[mask].min()),'minimumJacobianB':float(jac(g*(1-s))[mask].min())})
 image=Image.fromarray(np.uint8(np.clip(im*255+.5,0,255)),'RGBA');image.save(out/f'frame-{n+1:04d}.png');frames.append(image)
 mm=np.asarray(image)[...,3]>128;yy,xx=np.where(mm);bounds.append({'index':n,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())],'opaqueArea':int(mm.sum())})
shutil.copyfile(args.a,out/'frame-0001.png');shutil.copyfile(args.b,out/f'frame-{args.frames+2:04d}.png')
metrics['steps']=[]
for i in range(1,len(frames)):
 before=np.asarray(frames[i-1]).astype(float)/255;after=np.asarray(frames[i]).astype(float)/255
 delta=np.abs(after-before)
 metrics['steps'].append({'index':i,'alphaMAD':float(delta[...,3].mean()),'rgbMAD':float(delta[...,:3].mean())})
metrics['endpointsCopiedExactly']=True;metrics['sourceA']=str(Path(args.a).resolve());metrics['sourceB']=str(Path(args.b).resolve());metrics['frames']=args.frames;metrics['bounds']=bounds;metrics['interpretation']='No fold detected is a numerical check, not a guarantee of identical anatomy. Visually review eyes, ear tips, face and scarf before use.'
metrics['intermediates']=mids;(out/'metrics.json').write_text(json.dumps(metrics,indent=2))
cols=4;rows=(len(frames)+cols-1)//cols;sheet=Image.new('RGB',(cols*300,rows*290),'#eef0e8')
for i,im in enumerate(frames):
 bg=Image.new('RGBA',(300,290),'#eef0e8');im=im.copy();im.thumbnail((290,268));bg.alpha_composite(im,((300-im.width)//2,20));ImageDraw.Draw(bg).text((8,5),str(i),fill='black');sheet.paste(bg.convert('RGB'),((i%cols)*300,(i//cols)*290))
sheet.save(out/'contact.jpg',quality=96)
# Repeated slow inspection cycle, no synthesized temporal samples.
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-framerate','12','-i',str(out/'frame-%04d.png'),'-vf','format=yuv420p','-c:v','libx264','-crf','17',str(out/'bridge.mp4')],check=True)
print(json.dumps(metrics))
