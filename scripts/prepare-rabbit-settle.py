#!/usr/bin/env python3
"""Preserve the entire roll and append a short source-frame head settling gesture.

No generated pixels, geometric transforms, interpolation or speed changes. The
12-frame return uses only the settled tail of the generated take, never the roll
or get-up itself. The original 362-frame prefix remains byte-for-byte untouched.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rgba(path):return np.asarray(Image.open(path).convert('RGBA'),dtype=np.float32)/255

def difference(a,b):
    mask=(a[...,3]>.1)|(b[...,3]>.1)
    pa=a[...,:3]*a[...,3:];pb=b[...,:3]*b[...,3:]
    aa=a[...,3]>.3;ab=b[...,3]>.3
    return {'foregroundPremultipliedRgbMAD':float(np.abs(pa-pb)[mask].mean()),
            'fullFramePremultipliedRgbMAD':float(np.abs(pa-pb).mean()),
            'alphaMAD':float(np.abs(a[...,3]-b[...,3]).mean()),
            'silhouetteIoU':float((aa&ab).sum()/(aa|ab).sum())}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,default=ROOT/'evidence/momo012');parser.add_argument('--skip-encode',action='store_true');args=parser.parse_args()
    args.work.mkdir(parents=True,exist_ok=True);out=args.work/'asset-frames';out.mkdir(exist_ok=True)
    old=ROOT/'evidence/momo011/frames';original=ROOT/'evidence/momo006/asset-rgba'
    sequence=[old/f'frame-{n:04d}.png' for n in range(1,468)]
    sequence += [old/f'frame-{363+n-20:04d}.png' for n in range(123,111,-1)]
    sequence += [original/'frame-0002.png']
    assert len(sequence)==480
    for i,source in enumerate(sequence,1):shutil.copyfile(source,out/f'frame-{i:04d}.png')
    prefix=all(sha(out/f'frame-{i:04d}.png')==sha(original/f'frame-{i:04d}.png') for i in range(1,363));assert prefix
    old_exit=difference(rgba(old/'frame-0467.png'),rgba(original/'frame-0001.png'))
    pairs=[];previous=rgba(sequence[0])
    for i,path in enumerate(sequence[1:]+sequence[:1],1):
        current=rgba(path);pairs.append({'fromFrame':i,'toFrame':i%480+1,**difference(previous,current)});previous=current
    relevant=[p for p in pairs if p['fromFrame']>=467]
    asset=ROOT/'public/assets/momo-actions-settle.webm'
    if not args.skip_encode:
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(out/'frame-%04d.png'),'-frames:v','480','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(asset)],check=True)
    manifest={'sourceFrames':362,'sourcePngPrefixExact':prefix,'generatedRollRangeInclusive':[20,124],
      'addedSettlingSequence':'generated 123..112 descending, then original frame 2, then native loop to original frame 1',
      'addedFrames':13,'addedSeconds':13/24,'totalFrames':480,'fps':24,'durationSeconds':20,
      'processing':'copy existing intact RGBA frames only; no warp, dissolve, rotation, geometry change, offscreen cut or retiming',
      'oldExit':old_exit,'newSettlingPairs':relevant,
      'maxNewSettlingStep':max(relevant,key=lambda x:x['foregroundPremultipliedRgbMAD']),
      'maxEntireLoopStep':max(pairs,key=lambda x:x['foregroundPremultipliedRgbMAD']),
      'assetSha256':sha(asset) if asset.exists() else None,
      'knownLimitations':['The accepted first roll take already crops an ear tip.','Generated and original texture are not identical; a smaller residual source change remains at frame 479 to 480.','The small 0.5 second head return reuses the settled tail backwards, not a newly generated gesture.']}
    (args.work/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (args.work/'asset-step-metrics.json').write_text(json.dumps(pairs,indent=2)+'\n')
    contact=Image.new('RGB',(6*230,2*235),'#eef1e8');draw=ImageDraw.Draw(contact)
    ids=[465,467,469,471,473,475,477,479,480,1,2,3]
    for j,index in enumerate(ids):
      im=Image.open(sequence[index-1]);im.thumbnail((225,208));x=j%6*230;y=j//6*235;contact.paste(im,(x,y),im);draw.text((x+5,y+212),str(index),fill='black')
    contact.save(args.work/'asset-final-contact.jpg');print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
