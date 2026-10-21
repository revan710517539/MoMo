#!/usr/bin/env python3
from pathlib import Path
from PIL import Image
import numpy as np,json,hashlib
R=Path(__file__).resolve().parents[1];W=R/'evidence/momo007';S=R/'evidence/momo006/asset-rgba';O=W/'asset-loop-frames'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
source=sorted(S.glob('frame-*.png'));allframes=sorted(O.glob('frame-*.png'))
assert len(source)==362 and len(allframes)==404
proof=[{'frame':i+1,'sourceSha256':sha(p),'outputSha256':sha(O/p.name)} for i,p in enumerate(source)]
assert all(p['sourceSha256']==p['outputSha256'] for p in proof)
def rgba(p):return np.asarray(Image.open(p).convert('RGBA'),np.float32)/255
A=rgba(source[-1]);B=rgba(source[0]);bridge=[A]+[rgba(p) for p in allframes[362:]]+[B]
def metric(a,b):
 pa=a.copy();pb=b.copy();pa[...,:3]*=pa[...,3:4];pb[...,:3]*=pb[...,3:4]
 union=(a[...,3]>.05)|(b[...,3]>.05)
 return {'premultipliedRgbMAD':float(np.abs(pa[...,:3]-pb[...,:3])[union].mean()),'alphaMAD':float(np.abs(a[...,3]-b[...,3]).mean()),'silhouetteIoU':float(((a[...,3]>.5)&(b[...,3]>.5)).sum()/((a[...,3]>.5)|(b[...,3]>.5)).sum())}
steps=[metric(a,b) for a,b in zip(bridge,bridge[1:])]
manifest={'sourceFrames':362,'sourceFps':24,'sourcePreservation':'all 362 original RGBA PNG files copied byte-for-byte, same sequence, same 1/24 second duration','bridgeFrames':42,'bridgeSampling':'n/43 for n=1..42; excludes both endpoints; no duplicate endpoint or freeze frames','totalFrames':404,'durationSeconds':404/24,'bridgeDurationSeconds':42/24,'method':'paired anatomy thin-plate-spline inverse warps, premultiplied bidirectional texture interpolation, signed-distance silhouette edge fusion, short ease-in/out with constant-speed middle pose timing; macOS Vision optical flow evaluated and rejected due double-ear correspondence failure','originalHardSeam':metric(A,B),'bridgeFirstStep':steps[0],'bridgeLastStep':steps[-1],'bridgeMaxRgbMAD':max(x['premultipliedRgbMAD'] for x in steps),'bridgeMaxAlphaMAD':max(x['alphaMAD'] for x in steps),'bridgeMinIoU':min(x['silhouetteIoU'] for x in steps),'limitations':['Synthesized 2D pose transition is appended, not a newly filmed 3D turn.','Large rear-side to front-side occlusion requires anatomy anchor correction.','Original 24 fps retained; no claim of 60 fps motion.']}
assert all(not np.array_equal(bridge[i],bridge[i+1]) for i in range(len(bridge)-1))
manifest['bridgeAdjacentDuplicateFrames']=0
(W/'asset-source-preservation.json').write_text(json.dumps(proof,indent=2))
old=json.loads((W/'asset-loop-manifest.json').read_text()) if (W/'asset-loop-manifest.json').exists() else {}
for key in ['encodedAsset','decodedSourceFrameEquality']:
 if key in old:manifest[key]=old[key]
(W/'asset-loop-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest,indent=2))
