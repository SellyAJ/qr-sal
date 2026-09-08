"""Regenerate synthetic QR fixtures. No downloaded documents or customer data.

Install: python -m pip install -r scripts/fixtures-requirements.txt
Run from any directory: python scripts/generate-fixtures.py
"""
from pathlib import Path
import base64
import json
import random
import cv2
import numpy as np
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test' / 'fixtures'
OUT.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(1)


def fixture(text, version=None, level=qrcode.constants.ERROR_CORRECT_H, mask=0, optimize=20):
    qr = qrcode.QRCode(version=version, error_correction=level, border=0, mask_pattern=mask)
    qr.add_data(text, optimize=optimize)
    qr.make(fit=version is None)
    bits = np.packbits(np.array(qr.modules, dtype=np.uint8).ravel()).tobytes()
    return dict(text=text, size=len(qr.modules), bits=base64.b64encode(bits).decode())


def save(name, generator, cases):
    (OUT / name).write_text(json.dumps(dict(generator=generator, cases=cases), ensure_ascii=True) + '\n', encoding='utf8')


cases = []
for version in range(1, 41):
    for level in [qrcode.constants.ERROR_CORRECT_L, qrcode.constants.ERROR_CORRECT_M,
                  qrcode.constants.ERROR_CORRECT_Q, qrcode.constants.ERROR_CORRECT_H]:
        cases.append(fixture('QSAL ' + str(version), version, level, version % 8))
for mask in range(8):
    for text in ['https://example.org/qr', '123456789012345', 'رمز — اختبار',
                 base64.b64encode(b'Synthetic QR Sal fixture. No personal or financial data.').decode()]:
        cases.append(fixture(text, mask=mask))
save('qr-matrices.json', 'Python qrcode 8.2; synthetic QR Model 2; independent encoder', cases)

rng = random.Random(20260907)
edges = []
for version, level, length in [(6, 1, 120), (12, 0, 240), (16, 1, 524), (25, 3, 600)]:
    text = ''.join(rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/') for _ in range(length))
    edges.append(fixture(text, version, level, version % 8, optimize=0))
save('qr-edge-matrices.json', 'Python qrcode 8.2; synthetic byte segments; seed 20260907; masks version % 8', edges)

blurred_cases = []
for index in [0, 1, 4, 5, 8, 9]:
    f = cases[index]
    n, scale, pad = f['size'], 16, 5
    bits = np.unpackbits(np.frombuffer(base64.b64decode(f['bits']), np.uint8))[:n*n].reshape(n, n)
    source = np.pad(235 - bits.astype(np.float32)*210, pad, constant_values=235)
    source = cv2.resize(source, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    yy, xx = np.mgrid[0:n, 0:n]
    for sx, sy in [(6, 6), (8, 8), (10, 6), (6, 10)]:
        blurred = cv2.GaussianBlur(source, (0, 0), sigmaX=sx, sigmaY=sy)
        values = np.zeros((n, n), np.float64)
        for dx, dy in [(0, 0), (-.16, -.16), (.16, -.16), (-.16, .16), (.16, .16)]:
            values += cv2.remap(blurred, ((xx+pad+.5+dx)*scale-.5).astype(np.float32),
                                ((yy+pad+.5+dy)*scale-.5).astype(np.float32), cv2.INTER_LINEAR)/5
        blurred_cases.append(dict(index=index, size=n, sigmaX=sx, sigmaY=sy,
                                  pixelsPerModule=scale, text=f['text'], values=values.ravel().tolist()))
save('qr-measured-blur.json', 'OpenCV 4.12 GaussianBlur; independently encoded synthetic matrices; 16 pixels/module', blurred_cases)

# The public demo's preview and download are the same real, decodable sample.
sample = qrcode.make('https://github.com/SellyAJ/qr-sal', error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
(ROOT / 'demo' / 'assets').mkdir(parents=True, exist_ok=True)
from PIL.PngImagePlugin import PngInfo
metadata = PngInfo()
metadata.add_text('Source', 'Synthetic QR generated with Python qrcode 8.2 by scripts/generate-fixtures.py. Payload: public QR Sal repository URL.')
sample.save(ROOT / 'demo' / 'assets' / 'sample.png', pnginfo=metadata)
print(json.dumps(dict(matrices=len(cases), edgeCases=len(edges), blurCases=len(blurred_cases))))
