#!/usr/bin/env python3
"""Validate VP9's actual decoded alpha and all-frame geometry, not just container tags."""
from pathlib import Path
import json,subprocess
import numpy as np
from PIL import Image
from scipy.ndimage import label
ROOT=Path(__file__).resolve().parents[1]; WORK=ROOT/'evidence/momo006'; ASSET=ROOT/'public/assets/momo-actions.webm'
p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-c:v','libvpx-vp9','-i',str(ASSET),'-vf','alphaextract','-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
rows=[]; extra_components=[]; area_jump=[]; prior=None
for n, file in enumerate(sorted((WORK/'asset-masks').glob('*.png'))):
 raw=p.stdout.read(832*768)
 assert len(raw)==832*768,(n,'missing alpha frame')
 decoded=np.frombuffer(raw,dtype=np.uint8).reshape(768,832); expected=np.asarray(Image.open(file).convert('L'))
 delta=np.abs(decoded.astype(np.int16)-expected.astype(np.int16));rows.append((int(delta.max()),float(delta.mean())))
 components,count=label(decoded>127); sizes=np.bincount(components.ravel());sizes[0]=0
 if (sizes>100).sum()!=1: extra_components.append(n+1)
 area=int((decoded>127).sum())
 if prior is not None and not .8<area/prior<1.2: area_jump.append(n+1)
 prior=area
assert not p.stdout.read(1),'unexpected extra frame'
assert p.wait()==0
assert len(rows)==362 and not extra_components and not area_jump
result={'decodedAlphaFrames':len(rows),'decodedAlphaMaxError':max(r[0] for r in rows),'decodedAlphaMeanError':float(np.mean([r[1] for r in rows])),'extraMajorComponentFrames':extra_components,'foregroundAreaJumpOver20PercentFrames':area_jump,'decoder':'ffmpeg -c:v libvpx-vp9 alphaextract','pixelAlpha':{'transparent':int((decoded==0).sum()),'opaque':int((decoded==255).sum()),'soft':int(((decoded>0)&(decoded<255)).sum())}}
manifest=WORK/'asset-manifest.json';data=json.loads(manifest.read_text());data['validation'].update(result);manifest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,indent=2))
