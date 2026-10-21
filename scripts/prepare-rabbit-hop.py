#!/usr/bin/env python3
"""Append a rigid, occluded hop without altering any original rabbit frames.

Only local, deterministic pixel translation. No warp, blend, scaling or model.
Run first without --encode to inspect contact; then --encode for VP9 alpha.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import argparse, hashlib, json, math, shutil, subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'evidence/momo006/asset-rgba'
EVIDENCE = ROOT / 'evidence/momo009'
FRAMES = EVIDENCE / 'hop-frames'
ASSET = ROOT / 'public/assets/momo-actions-hop.webm'
FPS = 48
COUNT = 96
# 740px would hide the pet too long. 723px hides exactly three 48fps frames
# for the current alpha bounds, including both sides of the pose switch.
HEIGHT = 723

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def verify_decoded_prefix():
    paths = [('original', ROOT / 'public/assets/momo-actions.webm', 362),
             ('hop-prefix', ASSET, 724)]
    frame_hashes = []
    for name, path, count in paths:
        md5 = EVIDENCE / f'{name}-decoded.md5'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-c:v', 'libvpx-vp9', '-i', str(path), '-frames:v', str(count),
                        '-pix_fmt', 'rgba', '-f', 'framemd5', str(md5)], check=True)
        frame_hashes.append([line.rsplit(',', 1)[1].strip()
                             for line in md5.read_text().splitlines()
                             if line and not line.startswith('#')])
    expected = [value for value in frame_hashes[0] for _ in range(2)]
    assert len(expected) == len(frame_hashes[1]) == 724
    mismatch = [i + 1 for i, (a, b) in enumerate(zip(expected, frame_hashes[1])) if a != b]
    result = {'originalFrameCount': 362, 'hopPrefixFrameCount': 724,
              'exactDecodedRgbaMatches': 724 - len(mismatch), 'mismatchFrames': mismatch,
              'decodedPixelFormat': 'rgba',
              'method': 'Each original decoded RGBA frame MD5 repeated twice equals hop prefix MD5'}
    (EVIDENCE / 'hop-decoded-preservation.json').write_text(json.dumps(result, indent=2) + '\n')
    assert not mismatch

def make():
    EVIDENCE.mkdir(exist_ok=True)
    FRAMES.mkdir(exist_ok=True)
    originals = sorted(SRC.glob('frame-*.png'))
    assert len(originals) == 362
    prefix = []
    for i, source in enumerate(originals):
        source_hash = digest(source)
        for repeat in range(2):
            dest = FRAMES / f'frame-{i * 2 + repeat + 1:04d}.png'
            shutil.copyfile(source, dest)
            assert digest(dest) == source_hash
        prefix.append({'source': source.name, 'sha256': source_hash,
                       'outputFrames': [i * 2 + 1, i * 2 + 2]})
    a = np.asarray(Image.open(originals[-1]).convert('RGBA'))
    b = np.asarray(Image.open(originals[0]).convert('RGBA'))
    records = []
    for n in range(1, COUNT + 1):
        t = n / (COUNT + 1)
        shift = round(HEIGHT * math.sin(math.pi * t) ** 2)
        source = a if n <= COUNT // 2 else b
        out = np.zeros_like(source)
        out[:source.shape[0] - shift] = source[shift:]
        # The visible raster is copied exactly, including RGBA and alpha.
        assert np.array_equal(out[:source.shape[0] - shift], source[shift:])
        assert not np.any(out[source.shape[0] - shift:])
        dest = FRAMES / f'frame-{724 + n:04d}.png'
        Image.fromarray(out, 'RGBA').save(dest)
        assert np.array_equal(np.asarray(Image.open(dest)), out)
        records.append({'bridgeFrame': n, 'outputFrame': 724 + n,
                        'sourceFrame': 362 if n <= 48 else 1,
                        'offsetY': -shift, 'fullyTransparent': not bool(np.any(out[..., 3])),
                        'exactVisibleRgbaCopy': True, 'sha256': digest(dest)})
    assert records[47]['fullyTransparent'] and records[48]['fullyTransparent']
    hidden = [r['bridgeFrame'] for r in records if r['fullyTransparent']]
    assert 2 <= len(hidden) <= 4, hidden
    picks = [1, 12, 24, 36, 44, 46, 47, 48, 49, 50, 52, 60, 72, 84, 96]
    sheet = Image.new('RGB', (1200, 900), '#eaf0e6')
    for i, n in enumerate(picks):
        im = Image.open(FRAMES / f'frame-{724 + n:04d}.png').convert('RGBA')
        im.thumbnail((224, 256))
        panel = Image.new('RGBA', (240, 300), '#eaf0e6')
        panel.alpha_composite(im, ((240 - im.width) // 2, 28))
        r = records[n - 1]
        ImageDraw.Draw(panel).text((8, 8), f'{n}/96 y={r["offsetY"]} src={r["sourceFrame"]}', fill='#304532')
        sheet.paste(panel.convert('RGB'), ((i % 5) * 240, (i // 5) * 300))
    sheet.save(EVIDENCE / 'hop-contact.jpg', quality=95)
    manifest = {'fps': FPS, 'originalFrames': 362, 'originalRepeat': 2,
                'prefixFrames': 724, 'bridgeFrames': COUNT, 'totalFrames': 820,
                'durationSeconds': 820 / FPS, 'bridgeDurationSeconds': COUNT / FPS,
                'translationHeightPixels': HEIGHT, 'transparentBridgeFrames': hidden,
                'poseSwitchBridgeFrames': [48, 49], 'noWarp': True, 'noScale': True,
                'noBlend': True, 'noRotation': True, 'originalSpeedPreserved': True,
                'prefixSourceFilesByteExact': True,
                'method': 'integer translation, pose changes only while fully outside canvas',
                'limitation': 'Pet briefly jumps above the video viewport; no invented 3D turn.'}
    (EVIDENCE / 'hop-prefix-preservation.json').write_text(json.dumps(prefix, indent=2) + '\n')
    (EVIDENCE / 'hop-rigid-verification.json').write_text(json.dumps(records, indent=2) + '\n')
    (EVIDENCE / 'hop-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--encode', action='store_true')
    args = parser.parse_args()
    manifest = make()
    print(json.dumps(manifest))
    if args.encode:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-framerate', str(FPS), '-i', str(FRAMES / 'frame-%04d.png'),
                        '-frames:v', '820', '-an', '-c:v', 'libvpx-vp9',
                        '-pix_fmt', 'yuva420p', '-lossless', '1', '-auto-alt-ref', '0',
                        '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', str(ASSET)], check=True)
        manifest['asset'] = str(ASSET.relative_to(ROOT))
        manifest['assetSha256'] = digest(ASSET)
        manifest['assetBytes'] = ASSET.stat().st_size
        (EVIDENCE / 'hop-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print('encoded', manifest['assetSha256'])
        verify_decoded_prefix()
