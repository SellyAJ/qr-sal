"""Evaluate a local BoofCV qrcodes directory; photographs/payloads are not published.

python -m pip install Pillow==12.3.0 numpy==2.2.6 opencv-python-headless==4.12.0.88 zxing-cpp==3.0.0
python scripts/benchmark.py /path/to/qrcodes --output benchmark-results.json

The directory must contain detection/ and decoding/. Obtain the archive from
https://boofcv.org/notwiki/regression/fiducial/qrcodes_v2.zip and inspect its terms.
This script reads annotations only after decoding; they are never sent to readers.
"""
import argparse
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import time
from PIL import Image, ImageOps
import cv2
import numpy as np
import zxingcpp


def annotations(file, orientation, width, height):
    lines = [line.strip() for line in file.read_text().splitlines() if line.strip() and not line.startswith('#')]
    if not lines:
        raise ValueError('Empty annotation')
    if lines[0] == 'SETS':
        rows = [list(map(float, line.split())) for line in lines[1:]]
        if any(len(row) != 8 for row in rows):
            raise ValueError('Invalid SETS annotation')
        quads = [[row[i:i+2] for i in range(0, 8, 2)] for row in rows]
    else:
        rows = [list(map(float, line.split())) for line in lines]
        if len(rows) % 4 or any(len(row) != 2 for row in rows):
            raise ValueError('Invalid point annotation')
        quads = [rows[i:i+4] for i in range(0, len(rows), 4)]
    def transform(point):
        x, y = point
        return {2:(width-x,y), 3:(width-x,height-y), 4:(x,height-y), 5:(y,x),
                6:(height-y,x), 7:(height-y,width-x), 8:(y,width-x)}.get(orientation,(x,y))
    unique = {}
    for quad in quads:
        oriented = [transform(point) for point in quad]
        unique[tuple(sorted(oriented))] = oriented
    return len(quads), list(unique.values())


def overlap(a, b):
    a = cv2.convexHull(np.asarray(a, np.float32))
    b = cv2.convexHull(np.asarray(b, np.float32))
    area = cv2.intersectConvexConvex(a, b)[0]
    return area / max(.00001, cv2.contourArea(a) + cv2.contourArea(b) - area)


def match(a, b):
    candidates = sorted([(overlap(x, y), i, j) for i, x in enumerate(a) for j, y in enumerate(b)], reverse=True)
    used_a, used_b, pairs = set(), set(), []
    for score, i, j in candidates:
        if score < .1:
            break
        if i not in used_a and j not in used_b:
            pairs.append((i,j)); used_a.add(i); used_b.add(j)
    return pairs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--time-limit-ms', type=int, default=35000)
    parser.add_argument('--limit', type=int, help='A smoke test only; not the full-corpus score')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output exists; choose a new output path to preserve prior measurements')
    if not 100 <= args.time_limit_ms <= 60000:
        parser.error('Time limit must be 100–60000 ms')
    corpus = args.corpus.resolve()
    if not (corpus / 'detection').is_dir() or not (corpus / 'decoding').is_dir():
        parser.error('Expected a qrcodes directory containing detection/ and decoding/')
    files = sorted(p for p in corpus.rglob('*') if p.suffix.lower() in ('.jpg','.jpeg','.png'))
    if args.limit:
        files = files[:args.limit]
    engine = Path(__file__).resolve().with_name('benchmark-worker.mjs')
    process = subprocess.Popen(['node', str(engine)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               text=True, encoding='utf8', bufsize=1)
    rows = []
    cv2.setNumThreads(1)
    try:
        with tempfile.TemporaryDirectory(prefix='qr-sal-') as temporary:
            buffer_file = Path(temporary) / 'pixels.gray'
            for file in files:
                relative = file.relative_to(corpus).as_posix()
                row = dict(source=relative, sourceSha256=hashlib.sha256(file.read_bytes()).hexdigest())
                with Image.open(file) as original:
                    orientation = original.getexif().get(274, 1)
                    width, height = original.size
                    image = ImageOps.exif_transpose(original)
                    if image.width * image.height > 20_000_000:
                        raise ValueError('Image exceeds 20 million pixels')
                    if image.mode in ('RGBA','LA') or 'transparency' in image.info:
                        rgba = image.convert('RGBA'); image = Image.new('RGBA', rgba.size, 'white'); image.alpha_composite(rgba)
                    gray = image.convert('L')
                raw = gray.tobytes(); buffer_file.write_bytes(raw)
                row['pixelsSha256'] = hashlib.sha256(raw).hexdigest()
                process.stdin.write(json.dumps(dict(file=str(buffer_file), width=gray.width, height=gray.height,
                                                   timeLimitMs=args.time_limit_ms)) + '\n'); process.stdin.flush()
                line = process.stdout.readline()
                if not line:
                    raise RuntimeError('QR Sal benchmark worker exited unexpectedly')
                ours = json.loads(line)
                if 'error' in ours:
                    raise RuntimeError(ours['error'])
                start = time.perf_counter()
                reference = zxingcpp.read_barcodes(np.frombuffer(raw,np.uint8).reshape(gray.height,gray.width),
                    formats=zxingcpp.BarcodeFormat.QRCode, try_rotate=True, try_downscale=True, try_invert=True,
                    text_mode=zxingcpp.TextMode.Plain, return_errors=False)
                elapsed = (time.perf_counter()-start)*1000
                reference = [code for code in reference if code.valid]
                a = [[(p['x'],p['y']) for p in code['corners']] for code in ours['codes']]
                b = [[(getattr(code.position, p).x,getattr(code.position, p).y) for p in
                      ('top_left','top_right','bottom_right','bottom_left')] for code in reference]
                row.update(qrSalResults=len(a), zxingResults=len(b), qrSalMs=ours['elapsedMs'], zxingMs=elapsed,
                           timedOut=ours['timedOut'], pairedTextConflicts=sum(ours['codes'][i]['text'] != reference[j].text for i,j in match(a,b)))
                annotation = file.with_suffix('.txt')
                if relative.startswith('detection/'):
                    raw_count, quads = annotations(annotation,orientation,width,height)
                    row.update(rawAnnotations=raw_count, distinctRegions=len(quads), qrSalMatched=len(match(a,quads)), zxingMatched=len(match(b,quads)))
                elif relative.startswith('decoding/'):
                    expected = annotation.read_bytes().decode('utf8')
                    normalize = lambda value: value.replace('\r\n','\n').rstrip('\n')
                    row.update(controlExact=any(code['text']==expected for code in ours['codes']),
                               controlNewlineNormalized=any(normalize(code['text'])==normalize(expected) for code in ours['codes']))
                rows.append(row)
                print(f'{len(rows)}/{len(files)} images processed', flush=True)
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
    summary = dict(images=len(rows), physicalRegions=sum(r.get('distinctRegions',0) for r in rows),
        qrSalMatched=sum(r.get('qrSalMatched',0) for r in rows), zxingMatched=sum(r.get('zxingMatched',0) for r in rows),
        qrSalImagesWithResult=sum(r['qrSalResults']>0 for r in rows), zxingImagesWithResult=sum(r['zxingResults']>0 for r in rows),
        timeLimitHits=sum(r['timedOut'] for r in rows), pairedTextConflicts=sum(r['pairedTextConflicts'] for r in rows))
    report = dict(schemaVersion=1, timeLimitMs=args.time_limit_ms, partialRun=bool(args.limit),
                  method='One-to-one greedy polygon IoU >= 0.10; exact duplicate annotations removed; EXIF applied to pixels and polygons',
                  note='Spatial coverage, not guaranteed payload accuracy. Unequal compute. No raw payloads in this report.', summary=summary, images=rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x',encoding='utf8') as stream:
        json.dump(report,stream,indent=2)
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
