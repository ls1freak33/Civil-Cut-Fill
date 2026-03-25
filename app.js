import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';

const state = {
  pdfDoc: null,
  pageNum: 1,
  pageCount: 0,
  viewport: null,
  mode: null,
  scalePoints: [],
  boundary: [],
  existingPoints: [],
  proposedPoints: [],
  feetPerPixel: null,
};

const el = {
  pdfFile: document.getElementById('pdfFile'),
  pdfCanvas: document.getElementById('pdfCanvas'),
  overlayCanvas: document.getElementById('overlayCanvas'),
  viewer: document.getElementById('viewer'),
  pageInfo: document.getElementById('pageInfo'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  modeStatus: document.getElementById('modeStatus'),
  cursorStatus: document.getElementById('cursorStatus'),
  knownDistance: document.getElementById('knownDistance'),
  saveScale: document.getElementById('saveScale'),
  scaleStatus: document.getElementById('scaleStatus'),
  modeScale: document.getElementById('modeScale'),
  modeBoundary: document.getElementById('modeBoundary'),
  clearBoundary: document.getElementById('clearBoundary'),
  pointElevation: document.getElementById('pointElevation'),
  modeExisting: document.getElementById('modeExisting'),
  modeProposed: document.getElementById('modeProposed'),
  undoPoint: document.getElementById('undoPoint'),
  clearPoints: document.getElementById('clearPoints'),
  pointCounts: document.getElementById('pointCounts'),
  gridSpacing: document.getElementById('gridSpacing'),
  adjustPct: document.getElementById('adjustPct'),
  runCalc: document.getElementById('runCalc'),
  results: document.getElementById('results'),
  exportJson: document.getElementById('exportJson'),
  importJson: document.getElementById('importJson'),
};

const pdfCtx = el.pdfCanvas.getContext('2d');
const overlayCtx = el.overlayCanvas.getContext('2d');

function setMode(mode) {
  state.mode = mode;
  el.modeStatus.textContent = `Mode: ${mode || 'none'}`;
  if (mode && el.viewer) {
    el.viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updatePointCounts() {
  el.pointCounts.textContent = `Existing: ${state.existingPoints.length} | Proposed: ${state.proposedPoints.length}`;
}

async function loadPdf(file) {
  const bytes = await file.arrayBuffer();
  state.pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
  state.pageCount = state.pdfDoc.numPages;
  state.pageNum = 1;
  await renderPage();
}

async function renderPage() {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.pageNum);
  const viewport = page.getViewport({ scale: 1.6 });
  state.viewport = viewport;
  el.pdfCanvas.width = viewport.width;
  el.pdfCanvas.height = viewport.height;
  el.overlayCanvas.width = viewport.width;
  el.overlayCanvas.height = viewport.height;
  await page.render({ canvasContext: pdfCtx, viewport }).promise;
  el.viewer.style.minHeight = `${Math.max(500, Math.min(viewport.height + 24, 1200))}px`;
  el.pageInfo.textContent = `Page ${state.pageNum} / ${state.pageCount}`;
  drawOverlay();
}

function getCanvasPoint(evt) {
  const rect = el.overlayCanvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawPoint(pt, color, label) {
  overlayCtx.beginPath();
  overlayCtx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
  overlayCtx.fillStyle = color;
  overlayCtx.fill();
  if (label) {
    overlayCtx.font = '12px Arial';
    overlayCtx.fillStyle = color;
    overlayCtx.fillText(label, pt.x + 6, pt.y - 6);
  }
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);

  if (state.boundary.length) {
    overlayCtx.beginPath();
    overlayCtx.moveTo(state.boundary[0].x, state.boundary[0].y);
    for (let i = 1; i < state.boundary.length; i++) overlayCtx.lineTo(state.boundary[i].x, state.boundary[i].y);
    overlayCtx.strokeStyle = '#15803d';
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();
    for (const pt of state.boundary) drawPoint(pt, '#15803d');
  }

  if (state.scalePoints.length) {
    if (state.scalePoints.length === 2) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(state.scalePoints[0].x, state.scalePoints[0].y);
      overlayCtx.lineTo(state.scalePoints[1].x, state.scalePoints[1].y);
      overlayCtx.strokeStyle = '#dc2626';
      overlayCtx.lineWidth = 2;
      overlayCtx.stroke();
    }
    state.scalePoints.forEach((pt, i) => drawPoint(pt, '#dc2626', `S${i+1}`));
  }

  state.existingPoints.forEach((pt, i) => drawPoint(pt, '#2563eb', `${pt.elev}`));
  state.proposedPoints.forEach((pt, i) => drawPoint(pt, '#ea580c', `${pt.elev}`));
}

function polygonClosed(poly) {
  return poly.length >= 3;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function boundsOfPolygon(poly) {
  return {
    minX: Math.min(...poly.map(p => p.x)),
    maxX: Math.max(...poly.map(p => p.x)),
    minY: Math.min(...poly.map(p => p.y)),
    maxY: Math.max(...poly.map(p => p.y)),
  };
}

function idwElevation(target, points, power = 2) {
  if (!points.length) return null;
  let num = 0;
  let den = 0;
  for (const pt of points) {
    const d = Math.hypot(target.x - pt.x, target.y - pt.y);
    if (d < 1e-6) return pt.elev;
    const w = 1 / Math.pow(d, power);
    num += w * pt.elev;
    den += w;
  }
  return num / den;
}

function runCalculation() {
  if (!state.feetPerPixel) {
    alert('Set scale first.');
    return;
  }
  if (state.boundary.length < 3) {
    alert('Draw a boundary first.');
    return;
  }
  if (state.existingPoints.length < 3 || state.proposedPoints.length < 3) {
    alert('Add at least 3 existing and 3 proposed points.');
    return;
  }

  const gridFt = Number(el.gridSpacing.value || 5);
  const adjustPct = Number(el.adjustPct.value || 0);
  const gridPx = gridFt / state.feetPerPixel;
  const b = boundsOfPolygon(state.boundary);

  let cutCf = 0;
  let fillCf = 0;
  let cells = 0;
  const cellAreaSf = gridFt * gridFt;

  for (let x = b.minX + gridPx / 2; x <= b.maxX - gridPx / 2; x += gridPx) {
    for (let y = b.minY + gridPx / 2; y <= b.maxY - gridPx / 2; y += gridPx) {
      const p = { x, y };
      if (!pointInPolygon(p, state.boundary)) continue;
      const eg = idwElevation(p, state.existingPoints);
      const pg = idwElevation(p, state.proposedPoints);
      if (eg == null || pg == null) continue;
      const delta = pg - eg;
      const volCf = Math.abs(delta) * cellAreaSf;
      if (delta > 0) fillCf += volCf;
      else cutCf += volCf;
      cells++;
    }
  }

  const adjustFactor = 1 + adjustPct / 100;
  const cutCy = cutCf / 27;
  const fillCy = fillCf / 27;
  const adjCutCy = cutCy * adjustFactor;
  const adjFillCy = fillCy * adjustFactor;
  const netCy = fillCy - cutCy;
  const sampleAreaSf = cells * cellAreaSf;

  el.results.innerHTML = `
    <strong>Results</strong><br>
    Grid cells used: ${cells}<br>
    Approx. sampled area: ${sampleAreaSf.toFixed(0)} SF<br>
    Cut: ${cutCy.toFixed(1)} CY<br>
    Fill: ${fillCy.toFixed(1)} CY<br>
    Net (fill - cut): ${netCy.toFixed(1)} CY<br>
    Adjusted Cut: ${adjCutCy.toFixed(1)} CY<br>
    Adjusted Fill: ${adjFillCy.toFixed(1)} CY
  `;
}

el.pdfFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) await loadPdf(file);
});

el.prevPage.addEventListener('click', async () => {
  if (state.pdfDoc && state.pageNum > 1) { state.pageNum--; await renderPage(); }
});

el.nextPage.addEventListener('click', async () => {
  if (state.pdfDoc && state.pageNum < state.pageCount) { state.pageNum++; await renderPage(); }
});

el.modeScale.addEventListener('click', () => {
  state.scalePoints = [];
  setMode('scale');
  drawOverlay();
});

el.saveScale.addEventListener('click', () => {
  const dft = Number(el.knownDistance.value);
  if (state.scalePoints.length !== 2 || !dft) {
    alert('Pick 2 scale points and enter known distance in feet.');
    return;
  }
  const px = dist(state.scalePoints[0], state.scalePoints[1]);
  state.feetPerPixel = dft / px;
  el.scaleStatus.textContent = `Scale: ${state.feetPerPixel.toFixed(5)} ft / pixel`;
});

el.modeBoundary.addEventListener('click', () => setMode('boundary'));
el.clearBoundary.addEventListener('click', () => { state.boundary = []; drawOverlay(); });
el.modeExisting.addEventListener('click', () => setMode('existing'));
el.modeProposed.addEventListener('click', () => setMode('proposed'));

el.undoPoint.addEventListener('click', () => {
  if (state.mode === 'proposed' && state.proposedPoints.length) state.proposedPoints.pop();
  else if (state.existingPoints.length) state.existingPoints.pop();
  updatePointCounts();
  drawOverlay();
});

el.clearPoints.addEventListener('click', () => {
  state.existingPoints = [];
  state.proposedPoints = [];
  updatePointCounts();
  drawOverlay();
});

el.runCalc.addEventListener('click', runCalculation);

el.overlayCanvas.addEventListener('mousemove', (evt) => {
  const p = getCanvasPoint(evt);
  el.cursorStatus.textContent = `X: ${p.x.toFixed(0)} Y: ${p.y.toFixed(0)}`;
});

el.overlayCanvas.addEventListener('click', (evt) => {
  const p = getCanvasPoint(evt);
  if (state.mode === 'scale') {
    if (state.scalePoints.length < 2) state.scalePoints.push(p);
  } else if (state.mode === 'boundary') {
    state.boundary.push(p);
  } else if (state.mode === 'existing' || state.mode === 'proposed') {
    const elev = Number(el.pointElevation.value);
    if (Number.isNaN(elev)) {
      alert('Enter elevation first.');
      return;
    }
    const point = { ...p, elev };
    if (state.mode === 'existing') state.existingPoints.push(point);
    else state.proposedPoints.push(point);
    updatePointCounts();
  }
  drawOverlay();
});

el.overlayCanvas.addEventListener('dblclick', (evt) => {
  if (state.mode === 'boundary' && polygonClosed(state.boundary)) {
    drawOverlay();
  }
});

el.exportJson.addEventListener('click', () => {
  const payload = {
    feetPerPixel: state.feetPerPixel,
    boundary: state.boundary,
    existingPoints: state.existingPoints,
    proposedPoints: state.proposedPoints,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cutfill-session.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

el.importJson.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  state.feetPerPixel = data.feetPerPixel || null;
  state.boundary = data.boundary || [];
  state.existingPoints = data.existingPoints || [];
  state.proposedPoints = data.proposedPoints || [];
  el.scaleStatus.textContent = state.feetPerPixel ? `Scale: ${state.feetPerPixel.toFixed(5)} ft / pixel` : 'Scale: not set';
  updatePointCounts();
  drawOverlay();
});

updatePointCounts();