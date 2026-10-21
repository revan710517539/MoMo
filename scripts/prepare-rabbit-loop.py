#!/usr/bin/env python3
"""Append an anatomy-registered RGBA bridge. Keeps all original frames byte exact.
Local-only processing; no generated character, external service, model download or original asset mutation.
"""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import map_coordinates, gaussian_filter, zoom, distance_transform_edt
from scipy.interpolate import RBFInterpolator
import json,hashlib,subprocess,shutil
ROOT=Path(__file__).resolve().parents[1]; W=ROOT/'evidence/momo007'; SRC=ROOT/'evidence/momo006/asset-rgba'
OUT=W/'asset-loop-frames';OUT.mkdir(exist_ok=True)
files=sorted(SRC.glob('frame-*.png')); H,WD=768,832
A=np.asarray(Image.open(files[-1]).convert('RGBA'),dtype=np.float32)/255
B=np.asarray(Image.open(files[0]).convert('RGBA'),dtype=np.float32)/255
# A pure Vision optical-flow trial was rejected (retained as evidence only).
# Source-to-target anatomy correspondences below handle the large turn explicitly.
y,x=np.mgrid[:H,:WD].astype(np.float32)
Ap=A.copy();Ap[...,:3]*=Ap[...,3:4]
Bp=B.copy();Bp[...,:3]*=Bp[...,3:4]
for i,p in enumerate(files):shutil.copyfile(p,OUT/f'frame-{i+1:04d}.png')
# Explicit paired anatomy anchors correct large occlusions the neural optical flow cannot match.
PA=np.array([[0,0],[831,0],[0,767],[831,767],[416,0],[0,400],[831,400],
[203,123],[251,154],[291,208],[307,248],[239,259],[213,199],
[445,115],[460,170],[443,232],[415,276],[348,245],[369,190],
[300,245],[238,306],[236,354],[360,352],[281,416],[204,401],[231,449],[337,449],[420,410],[448,343],
[252,480],[307,491],[374,470],[452,406],[331,539],
[269,540],[294,610],[279,687],[320,701],[358,681],[394,708],[467,706],[560,702],
[598,454],[637,525],[645,583],[698,606],[694,653],[648,687],[596,702],[520,412]],float)
PB=np.array([[0,0],[831,0],[0,767],[831,767],[416,0],[0,400],[831,400],
[379,114],[405,137],[418,194],[414,243],[344,245],[346,184],
[570,155],[571,206],[544,268],[505,309],[438,267],[473,203],
[400,243],[291,290],[278,333],[400,350],[302,396],[235,389],[272,438],[383,450],[484,427],[507,353],
[303,470],[384,490],[458,480],[511,436],[531,539],
[280,529],[291,607],[307,690],[353,706],[397,680],[421,709],[485,703],[551,694],
[591,490],[619,550],[625,596],[624,620],[613,651],[590,677],[563,696],[548,458]],float)
# TPS maps the shared intermediate anatomy back to each source; interpolate coarse
# maps, then sample premultiplied pixels. No raw two-pose crossfade is used.
cx,cy=np.meshgrid(np.linspace(0,WD-1,105),np.linspace(0,H-1,97)); sample=np.stack([cx.ravel(),cy.ravel()],1)
def warp_anchor(im,source,mid):
 mapped=RBFInterpolator(mid,source,kernel='thin_plate_spline',smoothing=0)(sample)
 mx=zoom(mapped[:,0].reshape(cx.shape),(H/cx.shape[0],WD/cx.shape[1]),order=3)
 my=zoom(mapped[:,1].reshape(cy.shape),(H/cy.shape[0],WD/cy.shape[1]),order=3)

 return np.stack([map_coordinates(im[...,c],[my,mx],order=1,mode='constant') for c in range(4)],2)
bridge=[];N=42
for n in range(1,N+1):
 t=n/(N+1);r=.08
 s=(t*t/(2*r*(1-r)) if t<r else (1-(1-t)**2/(2*r*(1-r)) if t>1-r else (t-r/2)/(1-r)))
 mid=PA*(1-s)+PB*s
 aa=warp_anchor(Ap,PA,mid);bb=warp_anchor(Bp,PB,mid)
 p=aa*(1-s)+bb*s
 p[...,:3]/=np.maximum(p[...,3:4],1e-7)
 # Interpolate signed silhouette distance rather than leaving two translucent edges.
 da=distance_transform_edt(aa[...,3]>.5)-distance_transform_edt(aa[...,3]<=.5)
 db=distance_transform_edt(bb[...,3]>.5)-distance_transform_edt(bb[...,3]<=.5)
 silhouette=np.clip((1-s)*da+s*db+.5,0,1)
 edge_weight=4*s*(1-s)
 p[...,3]=p[...,3]*(1-edge_weight)+silhouette*edge_weight
 im=Image.fromarray(np.uint8(np.clip(p*255+.5,0,255)),'RGBA');im.save(OUT/f'frame-{len(files)+n:04d}.png');bridge.append(im)
indices=[0,6,13,20,27,34,41,42,43]
ims=[Image.fromarray(np.uint8(A*255))]+bridge+[Image.fromarray(np.uint8(B*255))]
sheet=Image.new('RGB',(960,960),'white')
for n,i in enumerate(indices):
 im=ims[i].copy();im.thumbnail((310,290));bg=Image.new('RGBA',(320,320),'#24312d');bg.alpha_composite(im,((320-im.width)//2,20));ImageDraw.Draw(bg).text((5,5),f'bridge {i}/{N+1}',fill='white');sheet.paste(bg.convert('RGB'),((n%3)*320,n//3*320))
sheet.save(W/'asset-bridge-contact.jpg',quality=95)
print('generated',len(files),N)
if '--encode' in __import__('sys').argv:
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(OUT/'frame-%04d.png'),'-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(ROOT/'public/assets/momo-actions-loop.webm')],check=True)

