# Contributing

Start with a small, reproducible problem. For a decoder issue, include the version, settings, browser/Node version, exact expected text when known, and whether the input can be shared publicly. **Do not post receipts, credentials, personal QR payloads, or diagnostic traces without checking their contents.** Prefer a synthetic reproduction.

Install Node.js 22+, run `npm ci`, then `npm test` and `npm run check:types`. Core code is under `src/core`; the stable public boundary is `src/index.mjs` and its declarations. The worker adapter is separate. The demo is plain HTML/CSS/JavaScript under `demo`.

Algorithm changes need independent fixtures and regression evidence. Preserve exact previously decoded payloads and physical regions. Do not fix a test by supplying the expected answer to the scanner, silently dropping difficult cases, or weakening correction checks. Report time budgets and negative controls alongside gains.

Regenerate synthetic fixtures with:

```sh
python -m pip install -r scripts/fixtures-requirements.txt
python scripts/generate-fixtures.py
```

The qrcode encoder and OpenCV blur generator are test tools, not runtime decoder dependencies. `qr-rs-erasures.json` contains independently encoded synthetic Reed–Solomon blocks. The binary/bitmap examples contain synthetic or public-project-only text. Public benchmark photographs are not included.

Before publishing changes, run `npm run check:privacy`, a dedicated secret scanner such as Gitleaks, and inspect `npm pack --dry-run`. Never commit `.env` files, user paths, downloaded corpora, private documents or raw benchmark outputs containing personal text. Keep upstream notices intact.
