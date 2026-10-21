#!/usr/bin/env python3
"""Splice the accepted first articulated-roll candidate after the untouched source.
Requires local original RGBA frames and candidate RGB frames/Vision masks.
No pose warping, blending, rotation or retiming. Audio is omitted.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--original-frames',type=Path,default=ROOT/'evidence/momo006/asset-rgba');p.add_argument('--candidate-frames',type=Path,default=ROOT/'evidence/momo010/frames');p.add_argument('--candidate-masks',type=Path,default=ROOT/'evidence/momo010/masks');p.add_argument('--work',type=Path,default=ROOT/'evidence/momo011');p.add_argument('--start',type=int,default=20);p.add_argument('--end',type=int,default=124);a=p.parse_args()
out=a.work/'frames';out.mkdir(parents=True,exist_ok=True)
original=sorted(a.original_frames.glob('frame-*.png'));assert len(original)==362
for i,f in enumerate(original,1):shutil.copyfile(f,out/f'frame-{i:04d}.png')
for n,i in enumerate(range(a.start,a.end+1),363):
 im=Image.open(a.candidate_frames/f'frame-{i:04d}.png').convert('RGB');mask=Image.open(a.candidate_masks/f'frame-{i:04d}.png').convert('L');assert im.size==mask.size==(832,768);im.putalpha(mask);im.save(out/f'frame-{n:04d}.png')
asset=ROOT/'public/assets/momo-actions-roll.webm';count=362+a.end-a.start+1
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(out/'frame-%04d.png'),'-frames:v',str(count),'-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(asset)],check=True)
manifest={'sourceFrames':362,'candidateRangeInclusive':[a.start,a.end],'bridgeFrames':count-362,'totalFrames':count,'fps':24,'durationSeconds':count/24,'assetSha256':sha(asset),'candidate':'first HeyGen candidate, side roll and get up','processing':'Vision alpha only, same RGB and geometry; no warp/blend/rotation/retiming','knownLimitations':['User accepted existing ear-tip crop in first candidate.','Generated endpoint texture and head angle differ slightly; direct splice is not mathematically seamless.']}
(a.work/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
