#!/usr/bin/env python3
"""Assemble accepted small-motion bridges without removing source action frames.

Prepare texture-preserving bridge frames with preserve-rabbit-texture.py, using the reviewed
original362/generated20 (6), generated113/112 (2), generated112/original2
(10) pairs, anchored at clear original2. Each directory includes both exact endpoints; only its
interior frames are inserted. Original action timing remains 24 fps.
"""
from pathlib import Path
import json, shutil, hashlib, subprocess
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'evidence/momo015'; OUT=W/'asset-frames'; OUT.mkdir(exist_ok=True)
original=ROOT/'evidence/momo006/asset-rgba'
generated=ROOT/'evidence/momo013/graded-frames'
f=lambda p,n:p/f'frame-{n:04d}.png'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def bridge(folder,count,a,b):
    folder=W/'boundary'/folder
    assert Image.open(f(folder,1)).tobytes()==Image.open(a).tobytes()
    assert Image.open(f(folder,count+2)).tobytes()==Image.open(b).tobytes()
    return [f(folder,n) for n in range(2,count+2)]
entry=bridge('crisp-entry',6,f(original,362),f(generated,20))
settle=bridge('crisp-settle',2,f(generated,113),f(generated,112))
exit=bridge('crisp-exit',10,f(generated,112),f(original,2))
sequence=[f(original,n) for n in range(2,363)]+entry+[f(generated,n) for n in range(20,125)]+[f(generated,n) for n in range(123,112,-1)]+settle+[f(generated,112)]+exit+[f(original,2)]
assert len(sequence)==497
for n,p in enumerate(sequence,1):shutil.copyfile(p,f(OUT,n))
originalMapping={n:n-1 for n in range(2,363)}
assert all(sha(f(OUT,index))==sha(f(original,n)) for n,index in originalMapping.items())
assert all(sha(f(OUT,368+n-20))==sha(f(generated,n)) for n in range(20,125))
bounds=[]
for n,p in enumerate(sequence,1):
    alpha=np.asarray(Image.open(p).getchannel('A'));ys,xs=np.where(alpha>32)
    bounds.append([int(xs.min()),int(831-xs.max()),int(ys.min()),int(767-ys.max())])
assert min(min(x) for x in bounds)>0
asset=ROOT/'public/assets/momo-actions-crisp.webm'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(OUT/'frame-%04d.png'),'-frames:v',str(len(sequence)),'-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(asset)],check=True)
manifest={'frames':497,'fps':24,'durationSeconds':497/24,'originalFramesExact':361,'skippedFrame':1,'skippedReason':'Source first frame out of focus; adjacent frame2 has same starting pose','generatedFramesExact':105,'insertedFrames':18,'originalMapping':originalMapping,'segments':{'entry':[361,368],'roll':[368,472],'settle':[483,486],'exit':[486,497]},'minimumMargins':np.min(bounds,axis=0).tolist(),'assetSha256':sha(asset),'method':'Clear source2 loop anchor; retain existing motion and alpha; cubic RGB sampling with single-source white-fur detail, no new character, broad blur, sharpness normalization or new geometry','limits':'Existing small-motion interpolation still resamples pixels. A small real texture phase change can remain; no claim of identical fur strands.'}
shutil.copyfile(f(original,2),ROOT/'public/assets/momo-actions-crisp-poster.png')
(W/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
