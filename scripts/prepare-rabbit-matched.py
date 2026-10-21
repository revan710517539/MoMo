#!/usr/bin/env python3
"""Grade repaired roll frames; preserve every original action and 24 fps timing.

Inputs: original RGBA extraction (momo006), repaired RGBA (momo013).
Run repair-rabbit-ear.py first. Color uses one checked-in fixed LUT. Detail
compensation is deterministic by source index, including the settling replay.
"""
from pathlib import Path
import subprocess, shutil, json, hashlib
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'evidence/momo013'
graded=W/'graded-frames'; graded.mkdir(exist_ok=True)
rgb=W/'graded-rgb'; rgb.mkdir(exist_ok=True)
out=W/'asset-frames'; out.mkdir(exist_ok=True)
expr='clip(A+(A-B)*(0.09+0.29*min(1,max(0,(N-1)/92))),0,65535)'
filt="[0:v]lut3d=file=assets-source/rabbit/matched-grade.cube:interp=tetrahedral,format=gbrp16le,split=2[a][b];[b]gblur=sigma=1:steps=6[g];[a][g]blend=all_expr="+expr.replace(',',r'\,')+",format=rgb24[out]"
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-start_number','20','-i',str(W/'ear-repair/frames/frame-%04d.png'),'-filter_complex',filt,'-map','[out]','-frames:v','105','-start_number','20',str(rgb/'frame-%04d.png')],cwd=ROOT,check=True)
for n in range(20,125):
    im=Image.open(rgb/f'frame-{n:04d}.png').convert('RGBA')
    im.putalpha(Image.open(W/f'ear-repair/frames/frame-{n:04d}.png').getchannel('A'))
    im.save(graded/f'frame-{n:04d}.png')
original=ROOT/'evidence/momo006/asset-rgba'
sequence=[original/f'frame-{n:04d}.png' for n in range(1,363)]+[graded/f'frame-{n:04d}.png' for n in range(20,125)]+[graded/f'frame-{n:04d}.png' for n in range(123,111,-1)]+[original/'frame-0002.png']
assert len(sequence)==480
for n,p in enumerate(sequence,1): shutil.copyfile(p,out/f'frame-{n:04d}.png')
asset=ROOT/'public/assets/momo-actions-matched.webm'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(out/'frame-%04d.png'),'-frames:v','480','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(asset)],check=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest={'frames':480,'fps':24,'seconds':20,'originalPrefixExact':all(sha(sequence[n-1])==sha(out/f'frame-{n:04d}.png') for n in range(1,363)),'assetSha256':sha(asset),'generatedRange':[20,124],'settleReplay':[123,112],'earRepair':'local synthesized missing tip; rigid whole-frame translation only, no body warp','grade':'fixed LUT and source-index sigma1 residual .09 to .38, clipped in 16-bit','limitations':['Synthesized missing ear pixels are estimates.','Detail compensation cannot reconstruct original strand direction.']}
(W/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
