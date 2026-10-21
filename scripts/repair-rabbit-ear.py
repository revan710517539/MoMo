#!/usr/bin/env python3
"""Candidate only: rigid ear-tip outpaint patch. Never modifies original assets.
The donor was generated separately. Only source-missing pixels and a narrow ear
join may be composited; neither face nor body comes from the donor.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates, gaussian_filter1d, gaussian_filter
from scipy.optimize import least_squares
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'evidence/momo013/ear-repair';OUT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/'evidence/momo010/rgba'
donor=np.asarray(Image.open(ROOT/'assets-source/rabbit/ear-donor.png').convert('RGBA'),dtype=float)/255
# Isolate one left ear. Polygon follows the ear base, excluding face/other ear.
m=Image.new('L',(donor.shape[1],donor.shape[0]));ImageDraw.Draw(m).polygon([(195,348),(373,343),(469,390),(527,441),(485,532),(427,561),(330,526),(247,455)],fill=255)
donor[:,:,3]*=np.asarray(m)/255
donor=donor[340:565,190:532]
D=donor; pivot=np.array([280.,140.])

def sample(params,x,y,channels=False):
 scale,angle,rx,ry=params;c=np.cos(angle);s=np.sin(angle)
 u=(c*(x-rx)+s*(y-ry))/scale+pivot[0]
 v=(-s*(x-rx)+c*(y-ry))/scale+pivot[1]
 if channels:return np.stack([map_coordinates(D[:,:,k],[v,u],order=1,mode='constant',cval=0) for k in range(4)],-1)
 return map_coordinates(D[:,:,3],[v,u],order=1,mode='constant',cval=0)

records=[]; fit={}
for group in [range(41,57),range(70,88)]:
 for n in group:
  source=np.asarray(Image.open(SOURCE/f'frame-{n:04d}.png').convert('RGBA'),dtype=float)/255
  yy=np.where(source[:,0,3]>.125)[0];lo,hi=int(yy.min()),int(yy.max());cy=(lo+hi)/2
  y,x=np.mgrid[max(0,lo-35):min(768,hi+36),0:58];target=gaussian_filter(source[y,x,3],1)
  initial=[.55,0 if n<60 else -.18,100,cy+35]
  def residual(p):
   pred=gaussian_filter(sample(p,x,y),1)
   weight=np.where(x<8,8.,.25)
   return np.r_[((pred-target)*weight).ravel(),(p[0]-.55)*4, (p[1]-(0 if n<60 else -.18))*.15]
  r=least_squares(residual,initial,bounds=([.4,-.65,50,cy-15],[.8,.6,170,cy+85]),max_nfev=90)
  fit[n]=r.x
 keys=list(group);sm=gaussian_filter1d(np.array([fit[n] for n in keys]),1.0,axis=0,mode='nearest')
 # Keep seam translations fitted precisely; smooth scale/angle only.
 for n,p in zip(keys,sm):
  prior=fit[n].copy(); prior[:2]=p[:2]
  source=np.asarray(Image.open(SOURCE/f'frame-{n:04d}.png').convert('RGBA'),dtype=float)/255
  yy=np.where(source[:,0,3]>.125)[0];lo,hi=int(yy.min()),int(yy.max());y,x=np.mgrid[lo-30:hi+31,0:6];target=gaussian_filter(source[y,x,3],.7)
  def seam(q):
   params=np.r_[prior[:2],q];return (gaussian_filter(sample(params,x,y),.7)-target).ravel()
  fixed=least_squares(seam,prior[2:],max_nfev=70);prior[2:]=fixed.x;fit[n]=prior

# Smooth global translation, ONLY generated segment. This is not shape warping.
def offset(n):
 if n<27 or n>104:return 0
 if n<42:return 64*(.5-.5*np.cos(np.pi*(n-27)/15))
 if n<=88:return 64
 return 64*(.5+.5*np.cos(np.pi*(n-88)/16))

frames=OUT/'frames';frames.mkdir(exist_ok=True)
for n in range(1,127):
 src=np.asarray(Image.open(SOURCE/f'frame-{n:04d}.png').convert('RGBA'),dtype=float)/255
 original=src.copy(); pad=128
 canvas=np.zeros((768,832+2*pad,4));canvas[:,pad:pad+832]=src
 if n in fit:
  p=fit[n]; y,x=np.mgrid[0:768,-pad:832+pad]
  patch=sample(p,x,y,True)
  # Photometric correction at the seam. Restrict sample to opaque ear pixels.
  inside=(x>=0)&(x<20)&(patch[:,:,3]>.7)
  sy=np.clip(y,0,767);sx=np.clip(x,0,831)
  valid=inside&(src[sy,sx,3]>.7)
  delta=np.median(src[sy[valid],sx[valid],:3]-patch[valid,:3],axis=0)
  patch[:,:,:3]=np.clip(patch[:,:,:3]+delta,0,1)
  # Repair source-mask edge feather and match local scanline illumination,
  # preventing the former frame boundary from becoming a dark vertical seam.
  rowvalid=valid.sum(axis=1)>2
  rowdelta=np.zeros((768,3))
  for row in np.where(rowvalid)[0]:
   rowdelta[row]=np.median(src[row,sx[row,valid[row]],:3]-patch[row,valid[row],:3],axis=0)
  weights=gaussian_filter1d(rowvalid.astype(float),3)
  rowdelta=gaussian_filter1d(rowdelta,3,axis=0)/np.maximum(weights[:,None],1e-8)
  spatial=np.clip((x+28)/28,0,1)
  patch[:,:,:3]=np.clip(patch[:,:,:3]+rowdelta[:,None,:]*spatial[:,:,None],0,1)
  # Missing pixels only. 8px seam crossfade is confined to ear intersection.
  w=np.clip((8-x)/8,0,1);w[x<0]=1
  w*=patch[:,:,3]
  # x>=0 outside ear patch receives no modifications.
  base=canvas.copy();pa=patch[:,:,3]*np.clip((8-x)/8,0,1);pa[x<0]=patch[x<0,3]
  a=base[:,:,3];pa[x>=0]*=(a[x>=0]>.08);aa=pa+a*(1-pa)
  rgb=(patch[:,:,:3]*pa[:,:,None]+base[:,:,:3]*a[:,:,None]*(1-pa[:,:,None]))/np.maximum(aa[:,:,None],1e-8)
  canvas=np.dstack([rgb,aa])
  # Byte-exact restoration outside the small allowed ear join, including hidden RGB.
  canvas[:,pad+8:pad+832]=original[:,8:]
  records.append({'frame':n,'rigidFit':p.tolist(),'donorColorDeltaRGB':delta.tolist()})
 # Integer translation keeps original visible pixels exact except 8px join.
 dx=int(round(offset(n)));result=canvas[:,pad-dx:pad-dx+832]
 Image.fromarray(np.uint8(np.clip(result,0,1)*255+.5),'RGBA').save(frames/f'frame-{n:04d}.png')
(out_manifest:=OUT/'manifest.json').write_text(json.dumps({'method':'single isolated donor ear, similarity only; missing left pixels and <=8px ear join; smooth generated-segment translation max64px','fit':records},indent=2)+'\n')
ns=[40,41,43,46,50,54,56,57,69,70,73,76,80,84,87,88]; sheet=Image.new('RGB',(4*416,4*400),'#284134');d=ImageDraw.Draw(sheet)
for i,n in enumerate(ns):
 im=Image.open(frames/f'frame-{n:04d}.png');im.thumbnail((416,384));x=i%4*416;y=i//4*400;sheet.paste(im,(x,y+16),im);d.text((x+5,y+2),str(n),fill='white')
sheet.save(OUT/'candidate-contact.jpg'); print(out_manifest)
