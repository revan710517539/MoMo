#!/usr/bin/env python3
"""Assemble the reviewed source-safe material candidate, keeping every pose.

Inputs: the 0.7.7 497-frame sequence and MOMO016 v2 material candidate.
No source keyframe is overwritten. Alpha and source-action order are checked
against the baseline; only white-fur RGB detail and its two joins change.
"""
from pathlib import Path
import hashlib,json,shutil,subprocess
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'evidence/momo016';OUT=W/'asset-frames';OUT.mkdir(exist_ok=True)
BASE=ROOT/'evidence/momo015/asset-frames';C=W/'tail/v2'
f=lambda p,n:p/f'frame-{n:04d}.png'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sequence=[f(BASE,n) for n in range(1,498)]
for n in range(105,125):sequence[368+n-20-1]=f(C/'frames',n)
for n in range(123,112,-1):sequence[473+123-n-1]=f(C/'frames',n)
sequence[485]=f(C/'frames',112)
for i in range(2):sequence[483+i]=f(C/'settle',i+2)
for i in range(10):sequence[486+i]=f(C/'exit',i+2)
changed=[];margins=[]
for n,p in enumerate(sequence,1):
    im=np.asarray(Image.open(p).convert('RGBA'));old=np.asarray(Image.open(f(BASE,n)).convert('RGBA'))
    assert np.array_equal(im[...,3],old[...,3]),f'Alpha changed at {n}'
    if not np.array_equal(im,old):changed.append(n)
    y,x=np.where(im[...,3]>32);margins.append([int(x.min()),int(831-x.max()),int(y.min()),int(767-y.max())])
    shutil.copyfile(p,f(OUT,n))
assert np.array_equal(np.asarray(Image.open(sequence[0])),np.asarray(Image.open(sequence[-1])))
assert all(sha(f(OUT,n))==sha(f(BASE,n)) for n in range(1,362))
assert all(sha(f(OUT,368+n-20))==sha(f(BASE,368+n-20)) for n in range(20,105))
assert min(min(b) for b in margins)>0
asset=ROOT/'public/assets/momo-actions-material.webm'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(OUT/'frame-%04d.png'),'-frames:v','497','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(asset)],check=True)
manifest={'frames':497,'fps':24,'durationSeconds':497/24,'changedRGBFrames':changed,'alphaAllExact':True,'sourceFrames2to362Exact':True,'allPosesAndTimingPreserved':True,'minimumMargins':np.min(margins,axis=0).tolist(),'assetSha256':sha(asset),'method':'Source B material-space safe mask and real white-fur detail follow existing poses; no gain normalization, output blur, sharpening or new silhouette/motion field.','limits':'Small source phase/contrast differences remain possible; desktop repeated playback acceptance required.'}
(W/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
