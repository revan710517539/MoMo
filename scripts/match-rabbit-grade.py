#!/usr/bin/env python3
"""Fixed, monotone photometric LUT for the accepted roll; no geometry or alpha edits.
Fit once on eroded/opaque fur and scarf quantile anchors from the two joins.
Render RGB with ffmpeg lut3d; original 362-frame source is never modified.
"""
from pathlib import Path
import argparse,json,subprocess
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'evidence/momo013'; W.mkdir(parents=True,exist_ok=True)
Q=[.1,.25,.5,.75,.9]
def rgba(p):return np.asarray(Image.open(p).convert('RGBA'),dtype=np.float64)/255

def masks(a):
 rgb=a[...,:3];r,g,b=rgb.transpose(2,0,1);l=rgb.mean(2);o=a[...,3]>.97
 return {'fur':o&(r>.3)&(np.ptp(rgb,axis=2)<.2)&(l>.38),
         'scarf':o&(g>r*.93)&(g>b*1.08)&(l<.6)}
def stats(a,selection):
 return {name:{'pixels':int(m.sum()),'rgbQuantiles':np.quantile(a[...,:3][m],Q,axis=0).tolist()} for name,m in selection.items()}
def diff(a,b):return float(np.abs(np.array(a)-np.array(b)).mean())
def main():
 p=argparse.ArgumentParser();p.add_argument('--skip-render',action='store_true');args=p.parse_args()
 pairs=[('entry',ROOT/'evidence/momo006/asset-rgba/frame-0362.png',20),('exit',ROOT/'evidence/momo006/asset-rgba/frame-0002.png',112)]
 anchors=[];src=[];dst=[]
 for name,original,n in pairs:
  ref=rgba(original);gen=rgba(ROOT/f'evidence/momo011/frames/frame-{363+n-20:04d}.png');rm=masks(ref);gm=masks(gen)
  rs=stats(ref,rm);gs=stats(gen,gm)
  src.extend(np.concatenate([gs[k]['rgbQuantiles'] for k in ('fur','scarf')]))
  dst.extend(np.concatenate([rs[k]['rgbQuantiles'] for k in ('fur','scarf')]))
  anchors.append((name,original,n,ref,gen,rm,gm,rs,gs))
 src=np.array(src);dst=np.array(dst);coef=[]
 for c in range(3):
  x=src[:,c];A=np.stack([x*(1-x),x*x*(1-x)],1);coef.append(np.linalg.lstsq(A,dst[:,c]-x,rcond=None)[0])
 coef=np.array(coef)
 def transform(rgb):return np.clip(rgb+rgb*(1-rgb)*(coef[:,0]+coef[:,1]*rgb),0,1)
 values=np.linspace(0,1,4097)[:,None]*np.ones((1,3));assert np.diff(transform(values),axis=0).min()>0
 cube=W/'color-match-fixed.cube';size=65
 with cube.open('w') as f:
  f.write('# Fixed monotone RGB match. Identical LUT for every generated frame.\nTITLE "Momo original-fur match"\nLUT_3D_SIZE 65\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
  for b in np.linspace(0,1,size):
   for g in np.linspace(0,1,size):
    for r in np.linspace(0,1,size):f.write(' '.join(f'{v:.9f}' for v in transform(np.array([r,g,b])))+'\n')
 out=W/'color-frames';out.mkdir(exist_ok=True)
 if not args.skip_render:
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-start_number','20','-i',str(ROOT/'evidence/momo010/frames/frame-%04d.png'),'-frames:v','105','-vf',f'lut3d=file={cube}:interp=tetrahedral','-pix_fmt','rgb24','-start_number','20',str(out/'frame-%04d.png')],check=True)
 panel=Image.new('RGB',(3*250,2*260),'#eef1e8');draw=ImageDraw.Draw(panel);report=[]
 for row,(name,original,n,ref,gen,rm,gm,rs,gs) in enumerate(anchors):
  rgb=np.asarray(Image.open(out/f'frame-{n:04d}.png').convert('RGB'),dtype=np.float64)/255
  graded=np.concatenate([rgb,gen[...,3:]],2);cs=stats(graded,gm)
  measured={k:{'beforeMeanAbsoluteQuantileRgbDifference':diff(gs[k]['rgbQuantiles'],rs[k]['rgbQuantiles']),'afterMeanAbsoluteQuantileRgbDifference':diff(cs[k]['rgbQuantiles'],rs[k]['rgbQuantiles'])} for k in ('fur','scarf')}
  report.append({'join':name,'generatedSourceFrame':n,'reference':str(original.relative_to(ROOT)),'referenceStats':rs,'beforeStats':gs,'afterStats':cs,'materialQuantileDifference':measured,'materialHighlightSpread':{k:{label:(np.array(st[k]['rgbQuantiles'])[4]-np.array(st[k]['rgbQuantiles'])[2]).tolist() for label,st in [('referenceStats',rs),('beforeStats',gs),('afterStats',cs)]} for k in ('fur','scarf')}})
  delta=np.abs(graded[...,:3]-gen[...,:3]); print(name, measured)
  for col,(im,label) in enumerate([(Image.open(original),'original reference'),(Image.fromarray(np.uint8(gen*255)),'generated before'),(Image.fromarray(np.uint8(graded*255)),'generated fixed LUT')]):
   im.thumbnail((240,225));x=col*250;y=row*260;panel.paste(im,(x+(250-im.width)//2,y),im if im.mode=='RGBA' else None);draw.text((x+5,y+232),name+': '+label,fill='#26382b')
 panel.save(W/'color-before-after.jpg',quality=95)
 (W/'color-metrics.json').write_text(json.dumps({'method':'Fixed monotone per-channel cubic rendered as one 65-cube RGB LUT; coefficients fitted once to fur/scarf 10th,25th,50th,75th,90th percentiles at entry/exit. Identical transform for all generated frames. No geometry, alpha or per-frame auto exposure.','formula':'y=x+x*(1-x)*(a+b*x)','coefficientsRGB':coef.tolist(),'anchors':report,'limits':['Material quantiles reduce shape/pose confounding but are not spatially matched photometry.','Generated fur detail and directional specular reflections differ; fixed grading cannot manufacture source texture or correct geometry.','Original source unchanged; grading only generated range 20..124 and replayed tail.']},indent=2)+'\n')
if __name__=='__main__':main()
