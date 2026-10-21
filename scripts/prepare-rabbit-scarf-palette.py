#!/usr/bin/env python3
"""Candidate-only additive scarf palette matching for the reviewed rabbit assets.

105 generated frames20..124, exact alpha and RGB outside material mask. Per-channel
constant offset in each scarf-mask interior preserves texture contrast (no gain).
Offsets fit robust medians in existing endpoint flow correspondence;20..112
smoothstep between fits,112+fixed. HSV seed, deterministic material components,
filled knitting holes, 3px internal boundary feather. No image/output convolution.
Flow caches and all source inputs must already exist; no hidden model calls.
Never publishes an app asset. Fresh output directory required.
"""
import argparse
from pathlib import Path
import numpy as np,json
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates,gaussian_filter,binary_closing,binary_fill_holes,distance_transform_edt,label
p=argparse.ArgumentParser(description=__doc__)
for k in ['generated','original','entry-flow','exit-flow','out']:p.add_argument('--'+k,type=Path,required=True)
q=p.parse_args();W=q.out;G=q.generated;orig=q.original
if W.exists():raise ValueError('Refuse to overwrite reviewed output')
W.mkdir(parents=True)
h,w=768,832;y,x=np.mgrid[:h,:w].astype(np.float32)
def load(p):return np.array(Image.open(p).convert('RGBA'),dtype=np.float32)/255
clip=lambda a:np.clip(a,0,1)
def material_mask(a):
 rgb=a[...,:3];mx=rgb.max(2);mn=rgb.min(2);d=mx-mn;s=d/np.maximum(mx,1e-8);hue=np.zeros_like(d)
 sel=(mx==rgb[...,0])&(d>1e-8);hue[sel]=((rgb[...,1]-rgb[...,2])[sel]/d[sel])%6
 sel=(mx==rgb[...,1])&(d>1e-8);hue[sel]=(rgb[...,2]-rgb[...,0])[sel]/d[sel]+2
 sel=(mx==rgb[...,2])&(d>1e-8);hue[sel]=(rgb[...,0]-rgb[...,1])[sel]/d[sel]+4
 hue/=6
 seed=(hue>.100)&(hue<.255)&(s>.20)&(a[...,3]>.97)&((rgb[...,1]-rgb[...,2])>.025)
 seed=binary_fill_holes(binary_closing(seed,iterations=2));labs,num=label(seed)
 # Discard isolated colour speckles; the scarf forms large material components.
 sizes=np.bincount(labs.ravel());sizes[0]=0
 if sizes.max()==0:return np.zeros_like(a[...,3])
 primary=int(np.argmax(sizes));near=distance_transform_edt(labs!=primary)
 keep=np.zeros(len(sizes),dtype=bool);keep[primary]=True
 for c in range(1,len(sizes)):
  if sizes[c]>=max(80,.12*sizes[primary]) and np.min(near[labs==c])<80:keep[c]=True
 seed=keep[labs]
 # Feather only inside the selected material; no RGB/output convolution.
 return clip(distance_transform_edt(seed)/3)*(a[...,3]>.97)
def sample(a,xx,yy,order=1):return np.stack([map_coordinates(a[...,c],[yy,xx],order=order,mode='nearest') for c in range(a.shape[2])],-1)
def warpBtoA(B,flow):
 g=gaussian_filter(np.fromfile(flow,dtype=np.float32).reshape(h,w,2),(1,1,0));bx=x.copy();by=y.copy()
 for _ in range(4):
  bg=sample(g,bx,by);bx=x-bg[...,0];by=y-bg[...,1]
 bp=B.copy();bp[...,:3]*=bp[...,3:4];bb=sample(bp,bx,by,3);out=bb.copy();out[...,:3]/=np.maximum(bb[...,3:4],1e-6)
 return out
O0=load(orig/'frame-0362.png');G0=load(G/'frame-0020.png');G1=load(G/'frame-0112.png');O1=load(orig/'frame-0002.png')
G0warp=warpBtoA(G0,q.entry_flow/'backward.bin');O1warp=warpBtoA(O1,q.exit_flow/'backward.bin')
fit0=(material_mask(O0)>.99)&(material_mask(G0warp)>.99)&(O0[...,3]>.99)&(G0warp[...,3]>.99)
fit1=(material_mask(G1)>.99)&(material_mask(O1warp)>.99)&(G1[...,3]>.99)&(O1warp[...,3]>.99)
if fit0.sum()<1000 or fit1.sum()<1000:raise ValueError('Insufficient matched scarf material')
c0=np.median((O0[...,:3]-G0warp[...,:3])[fit0],axis=0);c1=np.median((O1warp[...,:3]-G1[...,:3])[fit1],axis=0)
if np.max(np.abs(np.r_[c0,c1]))>.12:raise ValueError('Palette fit exceeds reviewed additive range')
F=W/'frames';M=W/'masks';F.mkdir(exist_ok=False);M.mkdir(exist_ok=False);rows=[]
for n in range(20,125):
 a=load(G/f'frame-{n:04d}.png');m=material_mask(a);t=clip((n-20)/92);s=t*t*(3-2*t);c=c0*(1-s)+c1*s
 b=a.copy();b[...,:3]=clip(a[...,:3]+m[...,None]*c);pix=np.uint8(b*255+.5);old=np.uint8(a*255+.5)
 assert np.array_equal(pix[...,3],old[...,3]);assert np.array_equal(pix[m==0],old[m==0])
 Image.fromarray(pix).save(F/f'frame-{n:04d}.png');Image.fromarray(np.uint8(m*255)).save(M/f'frame-{n:04d}.png')
 rows.append({'n':n,'offset':c.tolist(),'alphaExact':True,'outsideMaskExact':True,'maskPixels':int((m>0).sum()),'corePixels':int((m==1).sum()),'clippedRGBComponents':int(np.sum(((a[...,:3]+m[...,None]*c)>1)|((a[...,:3]+m[...,None]*c)<0)))})
# Quantify endpoint colour gap in matched source coordinates after correction.
newG0=load(F/'frame-0020.png');newG1=load(F/'frame-0112.png');newG0warp=warpBtoA(newG0,q.entry_flow/'backward.bin')
luma=lambda rgb:rgb@np.array([.2126,.7152,.0722],dtype=np.float32)
report={'entryOffset':c0.tolist(),'exitOffset':c1.tolist(),'entryFitPixels':int(fit0.sum()),'exitFitPixels':int(fit1.sum()),'entryOldMedianRGBGap':np.median((G0warp[...,:3]-O0[...,:3])[fit0],0).tolist(),'entryNewMedianRGBGap':np.median((newG0warp[...,:3]-O0[...,:3])[fit0],0).tolist(),'exitOldMedianRGBGap':np.median((O1warp[...,:3]-G1[...,:3])[fit1],0).tolist(),'exitNewMedianRGBGap':np.median((O1warp[...,:3]-newG1[...,:3])[fit1],0).tolist(),'entryOldMedianLumaGap':float(np.median(luma(G0warp[...,:3]-O0[...,:3])[fit0])),'entryNewMedianLumaGap':float(np.median(luma(newG0warp[...,:3]-O0[...,:3])[fit0])),'exitOldMedianLumaGap':float(np.median(luma(O1warp[...,:3]-G1[...,:3])[fit1])),'exitNewMedianLumaGap':float(np.median(luma(O1warp[...,:3]-newG1[...,:3])[fit1])),'method':'Additive RGB palette offset on constant material-mask interior, no gain; 20->112 smoothstep between robust endpoint offsets;112+constant','frames':rows}
(W/'metrics.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='frames'}))
