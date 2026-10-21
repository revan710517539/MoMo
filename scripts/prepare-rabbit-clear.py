#!/usr/bin/env python3
"""Assemble MOMO017's reviewed clear bridges without deleting source actions.

Original frames2..362 (361); entry6; generated20..124 (105); natural reverse
123..112 (12); exit10; original2 endpoint (1):495 frames at24fps. Only two
artificial settle-blend frames are removed. Source input directories are explicit;
colour-treated generated inputs must have the original reviewed alpha. All
silhouettes, bounds and endpoints are checked before lossless VP9 encoding.
No source is overwritten, and output/asset must not already exist.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess
import numpy as np
from PIL import Image
p=argparse.ArgumentParser(description=__doc__)
for k in ['original','generated','generated-reference','entry','exit','out','asset']:p.add_argument('--'+k,type=Path,required=True)
q=p.parse_args()
if q.out.exists() or q.asset.exists():raise ValueError('Output and asset must be new')
f=lambda d,n:d/f'frame-{n:04d}.png'
sha=lambda v:hashlib.sha256(v.read_bytes()).hexdigest()
sequence=[f(q.original,n) for n in range(2,363)]+[f(q.entry,n) for n in range(2,8)]+[f(q.generated,n) for n in range(20,125)]+[f(q.generated,n) for n in range(123,111,-1)]+[f(q.exit,n) for n in range(2,12)]+[f(q.original,2)]
assert len(sequence)==495
assert sha(f(q.entry,1))==sha(f(q.original,362))
assert sha(f(q.entry,8))==sha(f(q.generated,20))
assert sha(f(q.exit,1))==sha(f(q.generated,112))
assert sha(f(q.exit,12))==sha(f(q.original,2))
for n in range(20,125):
 assert np.array_equal(np.array(Image.open(f(q.generated,n)))[...,3],np.array(Image.open(f(q.generated_reference,n)))[...,3]),f'Generated alpha changed {n}'
q.out.mkdir(parents=True);margins=[];source=[]
for n,path in enumerate(sequence,1):
 im=np.array(Image.open(path).convert('RGBA'));assert im.shape==(768,832,4)
 y,x=np.where(im[...,3]>32);margin=[int(x.min()),int(831-x.max()),int(y.min()),int(767-y.max())];assert min(margin)>0
 margins.append(margin);shutil.copyfile(path,f(q.out,n));source.append({'frame':n,'source':str(path.resolve()),'sha256':sha(path)})
assert sha(sequence[0])==sha(sequence[-1])
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','24','-i',str(q.out/'frame-%04d.png'),'-frames:v','495','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0','-row-mt','1','-deadline','good','-cpu-used','3',str(q.asset)],check=True)
(q.out.parent/'asset-manifest.json').write_text(json.dumps({'frames':495,'fps':24,'duration':495/24,'originalActions2to362FileExact':True,'generatedActionOrder20to124Preserved':True,'naturalReverse123to112':True,'removedArtificialSettleFrames':2,'minimumMargins':np.min(margins,axis=0).tolist(),'firstLastFileExact':True,'assetSha256':sha(q.asset),'sources':source},indent=2)+'\n')
print(json.dumps({'frames':495,'asset':str(q.asset),'sha256':sha(q.asset)}))
