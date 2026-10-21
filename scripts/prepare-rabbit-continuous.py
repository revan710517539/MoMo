#!/usr/bin/env python3
"""Assemble accepted small-motion bridges without removing source action frames.

Prepare bridge frames with interpolate-rabbit-seam.py, using the reviewed
original362/generated20 (6), generated113/112 (2), generated112/original1
(10), and original1/original2 (4) pairs. Each bridge directory includes both exact endpoints; only its
interior frames are inserted. Original action timing remains 24 fps.
"""
from pathlib import Path
import json, shutil, hashlib, subprocess
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'evidence/momo014'; OUT=W/'asset-frames'; OUT.mkdir(exist_ok=True)
original=ROOT/'evidence/momo006/asset-rgba'
generated=ROOT/'evidence/momo013/graded-frames'
f=lambda p,n:p/f'frame-{n:04d}.png'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def bridge(folder,count,a,b):
    folder=W/'flow'/folder if folder else W/'flow'
    assert Image.open(f(folder,1)).tobytes()==Image.open(a).tobytes()
    assert Image.open(f(folder,count+2)).tobytes()==Image.open(b).tobytes()
    return [f(folder,n) for n in range(2,count+2)]
entry=bridge('entry',6,f(original,362),f(generated,20))
settle=bridge('settle',2,f(generated,113),f(generated,112))
exit=bridge('exit-first',10,f(generated,112),f(original,1))
start=bridge('start',4,f(original,1),f(original,2))
sequence=[f(original,1)]+start+[f(original,n) for n in range(2,363)]+entry+[f(generated,n) for n in range(20,125)]+[f(generated,n) for n in range(123,112,-1)]+settle+[f(generated,112)]+exit+[f(original,1)]
assert len(sequence)==502
for n,p in enumerate(sequence,1):shutil.copyfile(p,f(OUT,n))
originalMapping={n:n if n==1 else n+4 for n in range(1,363)}
assert all(sha(f(OUT,index))==sha(f(original,n)) for n,index in originalMapping.items())
assert all(sha(f(OUT,373+n-20))==sha(f(generated,n)) for n in range(20,125))
bounds=[]
for n,p in enumerate(sequence,1):
    alpha=np.asarray(Image.open(p).getchannel('A'));ys,xs=np.where(alpha>32)
    bounds.append([int(xs.min()),int(831-xs.max()),int(ys.min()),int(767-ys.max())])
assert min(min(x) for x in bounds)>0
asset=ROOT/'public/assets/momo-actions-continuous.webm'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(OUT/'frame-%04d.png'),'-frames:v',str(len(sequence)),'-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(asset)],check=True)
manifest={'frames':502,'fps':24,'durationSeconds':502/24,'originalFramesExact':362,'generatedFramesExact':105,'insertedFrames':22,'originalMapping':originalMapping,'segments':{'start':[1,6],'entry':[366,373],'roll':[373,477],'settle':[488,491],'exit':[491,502]},'minimumMargins':np.min(bounds,axis=0).tolist(),'assetSha256':sha(asset),'method':'small-motion bidirectional Vision optical-flow inverse sampling, confidence-weighted premultiplied-alpha blending; no new character or source-action deletion','limits':'Interpolated pixels are resampled estimates, not a new filmed gesture; zero geometric resampling is not claimed.'}
(W/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
