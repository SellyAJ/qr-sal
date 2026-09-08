import { createScanner, imageFromBlob } from './lib/browser.mjs';

const $ = (id) => document.getElementById(id);
const scanner = createScanner();
const context = $('canvas').getContext('2d');
let generation = 0,
  busy = false,
  sourceFile = null,
  sourceImage = null,
  pdfTask = null,
  pdf = null;
let pageNumber = 1,
  records = [],
  activeRender = null;
const maxPixels = 8_000_000;
const options = () => ({
  timeLimitMs: Number($('budget').value),
  multiple: $('multiple').checked,
  recovery: $('recovery').checked,
  trace: $('trace').checked,
});

function status(text, state = '') {
  $('status').textContent = text;
  $('status').dataset.state = state;
}
function setBusy(value) {
  busy = value;
  $('cancel').hidden = !value;
  for (const id of ['choose', 'sample', 'rescan', 'replace', 'previous', 'next'])
    $(id).disabled = value;
  $('loaded-actions').hidden = !sourceFile || value;
  $('clear').hidden = !sourceFile;
  $('results').setAttribute('aria-busy', String(value));
  if (!records.some((record) => record.result.codes.length)) renderResults();
  updatePages();
}
function updatePages() {
  $('page-controls').hidden = !pdf;
  $('page-label').textContent = `Page ${pageNumber} of ${pdf?.numPages ?? 1}`;
  $('previous').disabled = busy || pageNumber <= 1;
  $('next').disabled = busy || pageNumber >= (pdf?.numPages ?? 1);
}
function stop() {
  generation++;
  scanner.cancel();
  activeRender?.cancel();
  activeRender = null;
  setBusy(false);
}
function clear() {
  stop();
  pdfTask?.destroy().catch(() => {});
  pdfTask = null;
  pdf = null;
  sourceFile = null;
  sourceImage = null;
  records = [];
  pageNumber = 1;
  $('file').value = '';
  $('file-name').textContent = 'No file selected';
  $('canvas').width = 1;
  $('canvas').height = 1;
  $('preview').hidden = true;
  $('empty-source').hidden = false;
  $('source-hint').textContent = 'Multiple QR codes supported';
  $('timing').textContent = 'QR Model 2 · JavaScript · MIT licensed';
  renderResults();
  setBusy(false);
  status('Ready when you are');
}
function paint(image, codes = []) {
  const canvas = $('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  context.putImageData(image, 0, 0);
  context.strokeStyle = '#2458dc';
  context.lineWidth = Math.max(2, image.width / 280);
  for (const code of codes) {
    if (!code.corners?.length) continue;
    context.beginPath();
    code.corners.forEach((p, index) =>
      index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y),
    );
    context.closePath();
    context.stroke();
  }
  $('empty-source').hidden = true;
  $('preview').hidden = false;
}
async function renderPdfPage(number, job) {
  const page = await pdf.getPage(number);
  if (job !== generation) return null;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, Math.sqrt(maxPixels / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const render = page.render({ canvasContext: ctx, viewport, background: 'white' });
  activeRender = render;
  await render.promise;
  if (activeRender === render) activeRender = null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  page.cleanup();
  canvas.width = 1;
  canvas.height = 1;
  return image;
}
async function showPage(number) {
  if (!pdf || busy) return;
  const job = generation;
  setBusy(true);
  try {
    const image = await renderPdfPage(number, job);
    if (!image || job !== generation) return;
    pageNumber = number;
    paint(image, records.find((record) => record.page === number)?.result.codes ?? []);
  } catch {
    if (job === generation)
      status('This page could not be rendered. Try another PDF.', 'error');
  } finally {
    if (job === generation) setBusy(false);
  }
}
async function copy(text, button) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = label;
    }, 1800);
  } catch {
    status(
      'Clipboard is unavailable. Select the decoded text and copy it directly.',
      'error',
    );
  }
}
function renderResults() {
  const host = $('results');
  host.replaceChildren();
  let count = 0;
  for (const record of records)
    for (const code of record.result.codes) {
      count++;
      const item = document.createElement('article');
      item.className = 'result-item';
      const heading = document.createElement('div');
      heading.className = 'result-heading';
      const title = document.createElement('h3');
      title.textContent = `QR ${count}${pdf ? ` · Page ${record.page}` : ''}`;
      const button = document.createElement('button');
      button.className = 'text-button';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', `Copy QR ${count} text`);
      button.addEventListener('click', () => copy(code.text, button));
      heading.append(title, button);
      const content = document.createElement('pre');
      content.textContent = code.text;
      const meta = document.createElement('p');
      meta.textContent = `Version ${code.version} · ${code.size} × ${code.size} · ECC ${code.errorCorrection} · ${code.correctedCodewords} corrected codewords`;
      item.append(heading, content, meta);
      host.append(item);
    }
  $('result-count').textContent = String(count);
  $('copy-all').disabled = count === 0;
  $('download').disabled = records.length === 0;
  if (!count) {
    const empty = document.createElement('div');
    empty.className = 'empty-result';
    const title = document.createElement('h3');
    title.textContent = !sourceFile
      ? 'Your results, right here.'
      : busy
        ? 'Reading QR content…'
        : 'No QR decoded.';
    const p = document.createElement('p');
    p.textContent = !sourceFile
      ? 'Select a file to see its QR content and detected regions.'
      : busy
        ? 'Results appear here as each page finishes.'
        : 'Try a sharper image, a close-up, or more scan time.';
    empty.append(title, p);
    host.append(empty);
  }
}
async function run() {
  if (!sourceFile || busy) return;
  const job = ++generation;
  const settings = options();
  records = [];
  renderResults();
  setBusy(true);
  const pages = pdf?.numPages ?? 1;
  try {
    for (let number = 1; number <= pages; number++) {
      if (job !== generation) return;
      pageNumber = number;
      updatePages();
      status(`Scanning${pages > 1 ? ` page ${number} of ${pages}` : ''}…`, 'busy');
      const image = pdf ? await renderPdfPage(number, job) : sourceImage;
      if (job !== generation || !image) return;
      paint(image);
      const result = await scanner.scan(image, settings);
      if (job !== generation) return;
      records.push({ page: number, width: image.width, height: image.height, result });
      paint(image, result.codes);
      renderResults();
      const milliseconds = records.reduce(
        (sum, record) => sum + record.result.elapsedMs,
        0,
      );
      $('timing').textContent =
        `${(milliseconds / 1000).toFixed(2)} s decoding · ${records.length}/${pages} pages processed`;
    }
    const count = records.reduce((sum, record) => sum + record.result.codes.length, 0);
    const limited = records.some((record) => record.result.timedOut);
    status(
      count
        ? `${count} result${count === 1 ? '' : 's'} found.${limited ? ' Time limit reached; more codes may remain.' : ''}`
        : `No readable QR found. ${limited ? 'Time limit reached. ' : ''}Try a sharper close-up or a longer scan.`,
      count ? 'success' : 'error',
    );
  } catch (error) {
    if (job === generation)
      status(
        error.name === 'AbortError'
          ? 'Scan cancelled. Previous page results are retained.'
          : error.message || 'Could not scan this file. Try another image.',
        'error',
      );
  } finally {
    if (job === generation) setBusy(false);
  }
}
async function openFile(file) {
  if (!file) return;
  clear();
  const job = generation;
  if (file.size > 50 * 1024 * 1024) {
    status('This file is larger than 50 MB. Choose a smaller file.', 'error');
    return;
  }
  sourceFile = file;
  $('file-name').textContent = file.name || 'Sample image';
  setBusy(true);
  status('Opening file…', 'busy');
  try {
    if (file.type === 'application/pdf') {
      const pdfjs = await import('./vendor/pdf.mjs');
      if (job !== generation) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        './vendor/pdf.worker.mjs',
        import.meta.url,
      ).href;
      const data = new Uint8Array(await file.arrayBuffer());
      if (job !== generation) return;
      pdfTask = pdfjs.getDocument({
        data,
        isEvalSupported: false,
        cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
        wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
      });
      const document = await pdfTask.promise;
      if (job !== generation) {
        await document.destroy();
        return;
      }
      pdf = document;
      if (pdf.numPages > 100)
        throw new Error('This PDF has more than 100 pages. Split it into smaller files.');
      $('source-hint').textContent = `${pdf.numPages} pages · scanned in order`;
    } else {
      const image = await imageFromBlob(file, { maxPixels });
      if (job !== generation) return;
      sourceImage = image;
      $('source-hint').textContent = `${image.width} × ${image.height} px processed`;
    }
    setBusy(false);
    await run();
  } catch (error) {
    if (job !== generation) return;
    const message =
      error.name === 'PasswordException'
        ? 'This PDF is password-protected. Open an unlocked copy.'
        : error.message || 'Could not open this file. Try a PNG, JPG or PDF.';
    clear();
    status(message, 'error');
  } finally {
    if (job === generation && !busy) setBusy(false);
  }
}
$('choose').onclick = $('replace').onclick = () => $('file').click();
$('file').onchange = () => openFile($('file').files[0]);
$('sample').onclick = async () => {
  try {
    const response = await fetch('./assets/sample.png');
    if (!response.ok)
      throw new Error('Sample could not be loaded. Choose your own image instead.');
    await openFile(
      new File([await response.blob()], 'qr-sal-sample.png', { type: 'image/png' }),
    );
  } catch (error) {
    status(error.message, 'error');
  }
};
$('clear').onclick = clear;
$('cancel').onclick = () => {
  stop();
  if (!sourceImage && !pdf) clear();
  status('Cancelled. You can scan again when ready.');
};
$('rescan').onclick = run;
$('previous').onclick = () => showPage(pageNumber - 1);
$('next').onclick = () => showPage(pageNumber + 1);
$('copy-all').onclick = () =>
  copy(
    records
      .flatMap((record) => record.result.codes.map((code) => code.text))
      .join('\n\n'),
    $('copy-all'),
  );
$('download').onclick = () => {
  const json = JSON.stringify(
    {
      engine: records[0]?.result.engine,
      pagesProcessed: records.length,
      totalPages: pdf?.numPages ?? 1,
      complete:
        records.length === (pdf?.numPages ?? 1) &&
        !records.some((record) => record.result.timedOut),
      note: 'Complete refers to the scan budget, not proof that every QR was found.',
      pages: records,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'qr-sal-results.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
for (const type of ['dragenter', 'dragover'])
  $('drop-zone').addEventListener(type, (event) => {
    event.preventDefault();
    $('drop-zone').classList.add('dragging');
  });
$('drop-zone').addEventListener('dragleave', () =>
  $('drop-zone').classList.remove('dragging'),
);
$('drop-zone').addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop-zone').classList.remove('dragging');
  openFile(event.dataTransfer.files[0]);
});
window.addEventListener('pagehide', clear);
