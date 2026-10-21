#!/usr/bin/env python3
"""Extract the exact source sequence with local macOS Vision masks; no motion synthesis."""
import hashlib, json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'output/rabbit-animation/rabbit-actions-15s.mp4'
WORK=ROOT/'evidence/momo006'
FRAMES=WORK/'asset-frames'; MASKS=WORK/'asset-masks'; RGBA=WORK/'asset-rgba'
ASSETS=ROOT/'public/assets'
def run(*args): subprocess.run([str(x) for x in args], check=True)
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
for p in [FRAMES,MASKS,RGBA,ASSETS]: p.mkdir(parents=True,exist_ok=True)
if '--reuse-masks' not in sys.argv:
 run('ffmpeg','-hide_banner','-loglevel','error','-y','-i',SRC,'-map','0:v:0','-fps_mode','passthrough',FRAMES/'frame-%04d.png')
 run('xcrun','swiftc',ROOT/'scripts/prepare-rabbit-video-mask.swift','-o',WORK/'asset-mask-runner')
 run(WORK/'asset-mask-runner',FRAMES,MASKS)
files=sorted(FRAMES.glob('frame-*.png')); assert len(files)==362
areas=[]; bboxes=[]; changes=[]; previous=None
for p in files:
 im=Image.open(p).convert('RGB'); mask=Image.open(MASKS/p.name).convert('L')
 assert im.size==mask.size==(832,768)
 a=np.asarray(mask); coords=np.argwhere(a>32)
 assert len(coords)>10000, p.name
 y0,x0=coords.min(axis=0); y1,x1=coords.max(axis=0)
 assert min(x0,y0)>1 and x1<830 and y1<766, (p.name,'clipped')
 bboxes.append([int(x0),int(y0),int(x1),int(y1)]); areas.append(int((a>127).sum()))
 if previous is not None: changes.append(float(np.abs(a.astype(float)-previous).mean()/255))
 previous=a.astype(float)
 rgba=im.copy(); rgba.putalpha(mask); rgba.save(RGBA/p.name)
Image.open(RGBA/files[0].name).save(ASSETS/'momo-actions-poster.png')
run('ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',RGBA/'frame-%04d.png','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',ASSETS/'momo-actions.webm')
# A contact sheet over alternating light/dark backgrounds demonstrates actual alpha.
indices=[0,35,71,107,143,179,215,251,287,323,347,361]
sheet=Image.new('RGB',(4*312,3*310),'white'); d=ImageDraw.Draw(sheet)
for n,i in enumerate(indices):
 im=Image.open(RGBA/files[i].name); im.thumbnail((300,277))
 bg=Image.new('RGBA',(312,310), '#273534' if n%2 else '#f3e4dc'); bg.alpha_composite(im,((312-im.width)//2,20))
 ImageDraw.Draw(bg).text((8,6),f'frame {i+1} / {i/24:.2f}s',fill='white' if n%2 else 'black')
 sheet.paste(bg.convert('RGB'),((n%4)*312,(n//4)*310))
sheet.save(WORK/'asset-alpha-contact.jpg',quality=94)
manifest={'source':str(SRC.relative_to(ROOT)),'sourceSha256':sha(SRC),'video':{'width':832,'height':768,'fps':24,'frames':len(files),'duration':len(files)/24,'sourceStartPtsSeconds':1/12,'sourceStartNormalizedToZero':True},'process':'macOS Vision VNGenerateForegroundInstanceMaskRequest, each original frame, original RGB retained, alpha only; VP9 lossless yuva420p; no generated motion, no interpolation, no dropped source frames','assets':{name:{'sha256':sha(ASSETS/name),'bytes':(ASSETS/name).stat().st_size} for name in ['momo-actions.webm','momo-actions-poster.png']},'validation':{'foregroundAreaRange':[min(areas),max(areas)],'unionBounds':[min(b[0] for b in bboxes),min(b[1] for b in bboxes),max(b[2] for b in bboxes),max(b[3] for b in bboxes)],'alphaFrameChangeMean':float(np.mean(changes)),'alphaFrameChangeMax':max(changes),'loopSeamAlphaMAD':float(np.abs(np.asarray(Image.open(MASKS/files[0].name)).astype(float)-np.asarray(Image.open(MASKS/files[-1].name)).astype(float)).mean()/255)},'limits':['Source itself is 24 fps; no fabricated 60 fps claim.','Source first/last poses differ. Loop uses original hard boundary unless application makes a separate explicitly disclosed transition.','Vision-derived alpha can have small hair/edge variation; not a ground-truth rotoscope.','VP9 yuv420 color conversion can differ slightly from source RGB; motion/time/geometry preserved.']}
(WORK/'asset-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
