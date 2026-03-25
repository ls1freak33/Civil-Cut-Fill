pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = { pdfDoc:null, pageNum:1, pageCount:0, viewport:null, mode:null, scalePoints:[], boundary:[], existingPoints:[], proposedPoints:[], feetPerPixel:null };
const el = Object.fromEntries(['pdfFile','pdfCanvas','overlayCanvas','viewer','pageInfo','prevPage','nextPage','modeStatus','cursorStatus','knownDistance','saveScale','scaleStatus','modeScale','modeBoundary','clearBoundary','pointElevation','modeExisting','modeProposed','undoPoint','clearPoints','gridSpacing','adjustPct','runCalc','results','loadStatus','pointCounts'].map(id=>[id,document.getElementById(id)]));
const pdfCtx = el.pdfCanvas.getContext('2d', { alpha:false });
const overlayCtx = el.overlayCanvas.getContext('2d');

function setStatus(msg, isError=false){ el.loadStatus.textContent = msg; el.loadStatus.style.background = isError ? '#fee2e2' : '#eef2ff'; el.loadStatus.style.color = isError ? '#991b1b' : '#3730a3'; }
function setMode(mode){ state.mode=mode; el.modeStatus.textContent=`Mode: ${mode||'none'}`; setTimeout(()=>el.viewer.scrollIntoView({behavior:'smooth',block:'start'}),50); }
function updatePointCounts(){ el.pointCounts.textContent=`Existing: ${state.existingPoints.length} | Proposed: ${state.proposedPoints.length}`; }
function drawPoint(pt,color,label){ overlayCtx.beginPath(); overlayCtx.arc(pt.x,pt.y,5,0,Math.PI*2); overlayCtx.fillStyle=color; overlayCtx.fill(); if(label){ overlayCtx.font='14px Arial'; overlayCtx.fillStyle=color; overlayCtx.fillText(String(label), pt.x+8, pt.y-8);} }
function drawOverlay(){ overlayCtx.clearRect(0,0,el.overlayCanvas.width,el.overlayCanvas.height);
  if(state.boundary.length){ overlayCtx.beginPath(); overlayCtx.moveTo(state.boundary[0].x,state.boundary[0].y); for(let i=1;i<state.boundary.length;i++) overlayCtx.lineTo(state.boundary[i].x,state.boundary[i].y); if(state.boundary.closed) overlayCtx.closePath(); overlayCtx.strokeStyle='#15803d'; overlayCtx.lineWidth=2; overlayCtx.stroke(); state.boundary.forEach(p=>drawPoint(p,'#15803d')); }
  if(state.scalePoints.length){ if(state.scalePoints.length===2){ overlayCtx.beginPath(); overlayCtx.moveTo(state.scalePoints[0].x,state.scalePoints[0].y); overlayCtx.lineTo(state.scalePoints[1].x,state.scalePoints[1].y); overlayCtx.strokeStyle='#dc2626'; overlayCtx.lineWidth=2; overlayCtx.stroke(); }
    state.scalePoints.forEach((p,i)=>drawPoint(p,'#dc2626',`S${i+1}`)); }
  state.existingPoints.forEach(p=>drawPoint(p,'#2563eb',p.elev));
  state.proposedPoints.forEach(p=>drawPoint(p,'#ea580c',p.elev));
}
function getCanvasPoint(evt){ const rect = el.overlayCanvas.getBoundingClientRect(); const touch = evt.touches?.[0] || evt.changedTouches?.[0]; const clientX = touch ? touch.clientX : evt.clientX; const clientY = touch ? touch.clientY : evt.clientY; return { x: clientX - rect.left + el.viewer.scrollLeft, y: clientY - rect.top + el.viewer.scrollTop }; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function pointInPolygon(point, polygon){ let inside=false; for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){ const xi=polygon[i].x, yi=polygon[i].y, xj=polygon[j].x, yj=polygon[j].y; const intersect=((yi>point.y)!==(yj>point.y)) && (point.x < (xj-xi)*(point.y-yi)/((yj-yi)||1e-9)+xi); if(intersect) inside=!inside; } return inside; }
function boundsOfPolygon(poly){ return { minX:Math.min(...poly.map(p=>p.x)), maxX:Math.max(...poly.map(p=>p.x)), minY:Math.min(...poly.map(p=>p.y)), maxY:Math.max(...poly.map(p=>p.y)) }; }
function idwElevation(target, points, power=2){ if(!points.length) return null; let num=0, den=0; for(const pt of points){ const d=Math.hypot(target.x-pt.x,target.y-pt.y); if(d<1e-6) return pt.elev; const w=1/Math.pow(d,power); num+=w*pt.elev; den+=w; } return num/den; }

async function loadPdf(file){ try{ setStatus('Loading PDF...'); const bytes = await file.arrayBuffer(); state.pdfDoc = await pdfjsLib.getDocument({data:bytes,useWorker:true}).promise; state.pageCount=state.pdfDoc.numPages; state.pageNum=1; await renderPage(); setStatus('PDF loaded. You can now pick scale points.'); } catch(err){ console.error(err); setStatus(`PDF failed to load: ${err?.message || err}`, true); } }
async function renderPage(){ try{ const page = await state.pdfDoc.getPage(state.pageNum); const unscaled = page.getViewport({scale:1}); const targetWidth = Math.max(900, el.viewer.clientWidth - 20 || 900); const scale = targetWidth / unscaled.width; const viewport = page.getViewport({scale}); state.viewport = viewport; [el.pdfCanvas, el.overlayCanvas].forEach(c=>{ c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height); c.style.width = `${Math.ceil(viewport.width)}px`; c.style.height = `${Math.ceil(viewport.height)}px`; }); el.viewer.style.minHeight = `${Math.max(520, Math.min(viewport.height + 30, 1400))}px`; el.viewer.scrollTop = 0; el.viewer.scrollLeft = 0; await page.render({canvasContext:pdfCtx, viewport}).promise; el.pageInfo.textContent = `Page ${state.pageNum} / ${state.pageCount}`; drawOverlay(); } catch(err){ console.error(err); setStatus(`Page failed to render: ${err?.message || err}`, true); } }
function handleTap(evt){ if(!state.pdfDoc) return; evt.preventDefault(); const pt = getCanvasPoint(evt); el.cursorStatus.textContent = `X: ${Math.round(pt.x)} Y: ${Math.round(pt.y)}`;
  if(state.mode==='scale'){ if(state.scalePoints.length>=2) state.scalePoints=[]; state.scalePoints.push(pt); drawOverlay(); return; }
  if(state.mode==='boundary'){ if(state.boundary.closed) { state.boundary=[]; state.boundary.closed=false; } if(state.boundary.length>=3 && dist(pt, state.boundary[state.boundary.length-1]) < 18){ state.boundary.closed=true; } else { state.boundary.push(pt); } drawOverlay(); return; }
  if(state.mode==='existing' || state.mode==='proposed'){ const elev = Number(el.pointElevation.value); if(Number.isNaN(elev)){ alert('Enter elevation first.'); return; } const arr = state.mode==='existing' ? state.existingPoints : state.proposedPoints; arr.push({...pt, elev}); updatePointCounts(); drawOverlay(); }
}
function runCalculation(){ if(!state.feetPerPixel) return alert('Set scale first.'); if(state.boundary.length<3) return alert('Draw a boundary first.'); if(state.existingPoints.length<3 || state.proposedPoints.length<3) return alert('Add at least 3 existing and 3 proposed points.'); const gridFt=Number(el.gridSpacing.value||5), adjustPct=Number(el.adjustPct.value||0), gridPx=gridFt/state.feetPerPixel, b=boundsOfPolygon(state.boundary); let cutCf=0, fillCf=0, cells=0; const cellAreaSf=gridFt*gridFt; for(let x=b.minX+gridPx/2;x<=b.maxX-gridPx/2;x+=gridPx){ for(let y=b.minY+gridPx/2;y<=b.maxY-gridPx/2;y+=gridPx){ const p={x,y}; if(!pointInPolygon(p,state.boundary)) continue; const eg=idwElevation(p,state.existingPoints), pg=idwElevation(p,state.proposedPoints); if(eg==null||pg==null) continue; const delta=pg-eg, volCf=Math.abs(delta)*cellAreaSf; if(delta>0) fillCf+=volCf; else cutCf+=volCf; cells++; }} const factor=1+adjustPct/100; const cutCy=cutCf/27, fillCy=fillCf/27; el.results.innerHTML=`<strong>Results</strong><br>Grid cells used: ${cells}<br>Approx. sampled area: ${(cells*cellAreaSf).toFixed(0)} SF<br>Cut: ${cutCy.toFixed(1)} CY<br>Fill: ${fillCy.toFixed(1)} CY<br>Net (fill - cut): ${(fillCy-cutCy).toFixed(1)} CY<br>Adjusted Cut: ${(cutCy*factor).toFixed(1)} CY<br>Adjusted Fill: ${(fillCy*factor).toFixed(1)} CY`; }

el.pdfFile.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) loadPdf(f); });
el.prevPage.addEventListener('click', async()=>{ if(state.pdfDoc && state.pageNum>1){ state.pageNum--; await renderPage(); }});
el.nextPage.addEventListener('click', async()=>{ if(state.pdfDoc && state.pageNum<state.pageCount){ state.pageNum++; await renderPage(); }});
el.modeScale.addEventListener('click', ()=>{ state.scalePoints=[]; setMode('scale'); drawOverlay(); });
el.saveScale.addEventListener('click', ()=>{ const dft=Number(el.knownDistance.value); if(state.scalePoints.length!==2 || !dft) return alert('Pick 2 scale points and enter known distance in feet.'); const dpx=dist(state.scalePoints[0],state.scalePoints[1]); state.feetPerPixel=dft/dpx; el.scaleStatus.textContent=`Scale: ${state.feetPerPixel.toFixed(5)} ft/pixel`; });
el.modeBoundary.addEventListener('click', ()=>setMode('boundary'));
el.clearBoundary.addEventListener('click', ()=>{ state.boundary=[]; state.boundary.closed=false; drawOverlay(); });
el.modeExisting.addEventListener('click', ()=>setMode('existing'));
el.modeProposed.addEventListener('click', ()=>setMode('proposed'));
el.undoPoint.addEventListener('click', ()=>{ if(state.proposedPoints.length){ state.proposedPoints.pop(); } else if(state.existingPoints.length){ state.existingPoints.pop(); } updatePointCounts(); drawOverlay(); });
el.clearPoints.addEventListener('click', ()=>{ state.existingPoints=[]; state.proposedPoints=[]; updatePointCounts(); drawOverlay(); });
el.runCalc.addEventListener('click', runCalculation);
el.overlayCanvas.addEventListener('click', handleTap);
el.overlayCanvas.addEventListener('touchstart', handleTap, {passive:false});
window.addEventListener('resize', ()=>{ if(state.pdfDoc) renderPage(); });
updatePointCounts();