/* ===== App: estado, cena 3D, pose ===== */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const tick = () => new Promise(r => setTimeout(r, 0));
const T3 = t => GEO.mat4FromRT([1, 0, 0, 0, 1, 0, 0, 0, 1], t);
const S = {
  upper: null, lower: null, center: [0, 0, 0], cl: [0, 0, 0],
  M: GEO.mat4Identity(), undo: [], mode: 'auto', heatOn: false, heat: null, heatRun: 0, busy: false, cancel: false
};
window.__S = S;

/* ---------- cena ---------- */
const stage = $('stage'), canvas = $('gl');
let renderer = null, scene, camera, orbit, tc, pivot, upObj = null, loObj = null, matcap = null, triad = null;
const clipPlanes = [];
const baseUp = [0.99, 0.95, 0.86], baseLo = [0.70, 0.82, 0.96];
S.radius = 50; S.bounds = null; S.sect = { on: false, axis: 0, t: 0.5, flip: false };
let rafPending = false;

/* matcap procedural: luz principal em cima à esquerda, preenchimento frio embaixo, borda clara. Sombreia por normal de tela, então a forma aparece em qualquer ângulo. */
function makeMatcap() {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(n * 0.36, n * 0.30, n * 0.02, n * 0.5, n * 0.5, n * 0.5);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.30, '#f3f5f6'); bg.addColorStop(0.62, '#d3d9dc'); bg.addColorStop(0.88, '#97a2a8'); bg.addColorStop(1, '#b4bec3');
  g.fillStyle = bg; g.fillRect(0, 0, n, n);
  const fl = g.createRadialGradient(n * 0.80, n * 0.86, 0, n * 0.80, n * 0.86, n * 0.40);
  fl.addColorStop(0, 'rgba(255,255,255,0.30)'); fl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fl; g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(c);
}
function labelSprite(txt, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(txt, 32, 34); g.fillStyle = color; g.fillText(txt, 32, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(0.62, 0.62, 1); return sp;
}
function buildTriad() {
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 20);
  cam.up.set(0, 0, 1);
  for (const [name, d, hex, css] of [['X', [1, 0, 0], 0xf0645a, '#f0645a'], ['Y', [0, 1, 0], 0x4fd08f, '#4fd08f'], ['Z', [0, 0, 1], 0x6c9bff, '#6c9bff']]) {
    const v = new THREE.Vector3(...d);
    sc.add(new THREE.ArrowHelper(v, new THREE.Vector3(), 1.05, hex, 0.3, 0.17));
    const l = labelSprite(name, css); l.position.copy(v.multiplyScalar(1.42)); sc.add(l);
  }
  triad = { sc, cam };
}
function drawTriad(w, h) {
  if (!triad) return;
  const size = Math.round(Math.max(56, Math.min(92, Math.min(w, h) * 0.2)));
  const dir = camera.position.clone().sub(orbit.target).normalize().multiplyScalar(6);
  triad.cam.position.copy(dir); triad.cam.lookAt(0, 0, 0);
  const x = w - size - 10, y = 10;
  renderer.setScissorTest(true); renderer.setViewport(x, y, size, size); renderer.setScissor(x, y, size, size);
  renderer.autoClear = false; renderer.clearDepth();
  renderer.render(triad.sc, triad.cam);
  renderer.setScissorTest(false); renderer.autoClear = true;
}
function renderNow() {
  if (!renderer) return;
  /* near/far acompanham a distância à cena: sem corte ao dar zoom e sem brigar de profundidade no contato */
  const d = camera.position.distanceTo(orbit.target), r = Math.max(S.radius, 5);
  camera.near = Math.max(0.02, d - r * 1.6); camera.far = d + r * 2.5; camera.updateProjectionMatrix();
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setViewport(0, 0, w, h); renderer.setScissorTest(false);
  renderer.render(scene, camera);
  drawTriad(w, h);
}
function requestRender() {
  if (!renderer || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderNow(); });
}
function initScene() {
  if (typeof THREE === 'undefined') { $('err').textContent = 'Não foi possível carregar a biblioteca 3D. Recarregue a página.'; return false; }
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { $('err').textContent = 'Este navegador não conseguiu iniciar o WebGL. Ative a aceleração por hardware e recarregue.'; return false; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
  camera.up.set(0, 0, 1);               // nunca mudar: o OrbitControls guarda este eixo na criação
  camera.position.set(60, -110, 70);
  scene.add(camera);
  matcap = makeMatcap();
  orbit = new THREE.OrbitControls(camera, canvas);
  orbit.rotateSpeed = 0.9; orbit.screenSpacePanning = true;
  orbit.addEventListener('change', requestRender);
  pivot = new THREE.Group(); scene.add(pivot);
  tc = new THREE.TransformControls(camera, canvas);
  tc.setSpace('world'); tc.setSize(0.9);
  tc.addEventListener('change', requestRender);
  tc.addEventListener('dragging-changed', e => {
    orbit.enabled = !e.value;
    if (e.value) pushUndo(); else { readPivot(); afterPoseChange(); }
  });
  tc.addEventListener('objectChange', () => { readPivot(); });
  scene.add(tc);
  buildTriad();
  canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); window.__status && window.__status('Contexto 3D perdido, restaurando…'); });
  canvas.addEventListener('webglcontextrestored', () => { window.__status && window.__status(''); requestRender(); });
  const ro = new ResizeObserver(resize); ro.observe(stage); resize();
  return true;
}
function resize() {
  if (!renderer) return;
  const w = Math.max(10, stage.clientWidth), h = Math.max(10, stage.clientHeight);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
}

/* ---------- geometria dos arcos ---------- */
function colorArray(entry, base, useOrig) {
  const n = entry.work.nv, c = new Float32Array(n * 3);
  const col = entry.mesh.col;
  for (let i = 0; i < n; i++) {
    if (useOrig && col) { c[i * 3] = col[i * 3] / 255; c[i * 3 + 1] = col[i * 3 + 1] / 255; c[i * 3 + 2] = col[i * 3 + 2] / 255; }
    else { c[i * 3] = base[0]; c[i * 3 + 1] = base[1]; c[i * 3 + 2] = base[2]; }
  }
  return c;
}
function makeObj(entry, base, isLower) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(entry.work.pos, 3));
  g.setIndex(new THREE.BufferAttribute(entry.mesh.idx, 1));
  g.setAttribute('color', new THREE.BufferAttribute(colorArray(entry, base, $('chkOrig').checked), 3));
  g.computeVertexNormals();
  const m = new THREE.MeshMatcapMaterial({ matcap, vertexColors: true, side: THREE.DoubleSide, clippingPlanes: clipPlanes });
  if (isLower) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; }
  const mesh = new THREE.Mesh(g, m);
  if (isLower) mesh.renderOrder = 2;
  return mesh;
}
function disposeObj(o) { if (!o) return; o.parent && o.parent.remove(o); o.geometry.dispose(); o.material.dispose(); }

function bboxCenter(mesh) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], p = mesh.pos;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < mn[k]) mn[k] = p[i + k]; if (p[i + k] > mx[k]) mx[k] = p[i + k]; }
  return { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

/* reconstrói tudo que depende das malhas (centro de trabalho, geometria, pose) */
function rebuild(resetPose = true) {
  if (!renderer) return;
  const ref = S.upper || S.lower;
  if (!ref) return;
  S.center = bboxCenter(ref.mesh).c;
  for (const e of [S.upper, S.lower]) if (e) { e.work = GEO.prepare(e.mesh, S.center); e.bvh = false; e.area = null; }
  disposeObj(upObj); disposeObj(loObj); upObj = loObj = null;
  if (S.upper) { upObj = makeObj(S.upper, baseUp); scene.add(upObj); }
  if (S.lower) {
    loObj = makeObj(S.lower, baseLo, true);
    const p = S.lower.work.pos, n = S.lower.work.nv, c = [0, 0, 0];
    for (let i = 0; i < n; i++) { c[0] += p[i * 3]; c[1] += p[i * 3 + 1]; c[2] += p[i * 3 + 2]; }
    S.cl = [c[0] / n, c[1] / n, c[2] / n];
    loObj.position.set(-S.cl[0], -S.cl[1], -S.cl[2]);
    pivot.add(loObj);
    applyGhost();
  }
  if (resetPose) { S.M = GEO.mat4Identity(); S.undo = []; }
  S.heat = null; S.heatRun++;
  syncPivot();
  attachGizmo();
  fitView(S.hasView ? 'fit' : 'iso'); S.hasView = true;
  $('empty').style.display = (S.upper || S.lower) ? 'none' : '';
  window.__afterRebuild && window.__afterRebuild();
}
function applyGhost() {
  if (!loObj) return;
  const g = $('chkGhost').checked;
  loObj.material.transparent = g; loObj.material.opacity = g ? 0.55 : 1; loObj.material.depthWrite = !g; loObj.material.needsUpdate = true;
  requestRender();
}

/* ---------- pose ---------- */
function syncPivot() {
  if (!pivot) return;
  const Mp = GEO.mat4Mul(S.M, T3(S.cl));
  const m4 = new THREE.Matrix4().fromArray(Array.from(Mp));
  m4.decompose(pivot.position, pivot.quaternion, pivot.scale);
  pivot.updateMatrix(); pivot.updateMatrixWorld(true);
  requestRender();
}
function readPivot() {
  pivot.updateMatrix();
  S.M = GEO.mat4Mul(Float64Array.from(pivot.matrix.elements), T3([-S.cl[0], -S.cl[1], -S.cl[2]]));
}
function setPose(M, opts = {}) {
  if (opts.push !== false) pushUndo();
  S.M = Float64Array.from(M); syncPivot(); afterPoseChange();
}
function isIdentity(M) {
  const I = GEO.mat4Identity();
  for (let i = 0; i < 16; i++) if (Math.abs(M[i] - I[i]) > 1e-9) return false;
  return true;
}
function pushUndo() { S.undo.push(Float64Array.from(S.M)); if (S.undo.length > 40) S.undo.shift(); updateButtons(); }
function undo() { const m = S.undo.pop(); if (m) { S.M = m; syncPivot(); afterPoseChange(); } updateButtons(); }
let heatTimer = 0;
function afterPoseChange() {
  S.heat = null; S.heatRun++;
  updateButtons();
  clearTimeout(heatTimer);
  heatTimer = setTimeout(() => { refreshBounds(); window.__refreshStats && window.__refreshStats(); }, 350);
}
function attachGizmo() {
  if (!tc) return;
  if (S.mode === 'man' && S.lower) { tc.attach(pivot); tc.visible = true; tc.enabled = true; } else { tc.detach(); }
  requestRender();
}

/* ---------- câmera ---------- */
function refreshBounds() {
  const bb = new THREE.Box3();
  if (upObj) bb.expandByObject(upObj);
  if (loObj) { pivot.updateMatrixWorld(true); bb.expandByObject(loObj); }
  S.bounds = bb;
  if (!bb.isEmpty()) S.radius = bb.getSize(new THREE.Vector3()).length() / 2;
  updateSection();
  return bb;
}
const VIEW_DIRS = { top: [0, -0.02, 1], bottom: [0, -0.02, -1], front: [0, -1, 0], side: [1, 0, 0], iso: [0.55, -0.8, 0.6] };
function fitView(kind) {
  if (!camera) return;
  const bb = refreshBounds();
  if (bb.isEmpty()) return;
  const ctr = bb.getCenter(new THREE.Vector3()), r = Math.max(5, S.radius);
  const vf = camera.fov * Math.PI / 360, hf = Math.atan(Math.tan(vf) * camera.aspect), ef = Math.min(vf, hf);
  const dist = r / Math.sin(ef) * 0.9;
  const dir = kind === 'fit' ? camera.position.clone().sub(orbit.target) : new THREE.Vector3(...(VIEW_DIRS[kind] || VIEW_DIRS.iso));
  if (dir.lengthSq() < 1e-6) dir.set(...VIEW_DIRS.iso);
  dir.normalize();
  orbit.target.copy(ctr);
  camera.position.copy(ctr).addScaledVector(dir, dist);
  orbit.minDistance = r * 0.12; orbit.maxDistance = dist * 6;
  camera.lookAt(ctr); orbit.update(); requestRender();
}

/* ---------- plano de corte ---------- */
function updateSection() {
  clipPlanes.length = 0;
  const sc = S.sect;
  if (sc.on && S.bounds && !S.bounds.isEmpty()) {
    const mn = S.bounds.min.getComponent(sc.axis), mx = S.bounds.max.getComponent(sc.axis), pos = mn + (mx - mn) * sc.t;
    const n = new THREE.Vector3(); n.setComponent(sc.axis, sc.flip ? 1 : -1);
    clipPlanes.push(new THREE.Plane(n, sc.flip ? -pos : pos));
  }
  requestRender();
}
function setSection(patch) { Object.assign(S.sect, patch); updateSection(); }

function updateButtons() { window.__updateButtons && window.__updateButtons(); }

window.__A = { $, tick, T3, S, initScene, rebuild, setPose, undo, isIdentity, syncPivot, attachGizmo, fitView, applyGhost, requestRender, setSection, refreshBounds,
  bboxCenter, colorArray, getObj: () => ({ upObj, loObj }), getTC: () => tc, pushUndo, afterPoseChange, baseUp, baseLo };
})();

/* ===== App: arquivos, exemplo, zonas de soltar ===== */
(function () {
'use strict';
const A = window.__A, { $, tick, S } = A;
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function status(msg) { $('status').innerHTML = msg ? '<span class="chip">' + esc(msg) + '</span>' : ''; }
function err(msg) { $('err').textContent = msg || ''; }
window.__status = status;

function refreshZones() {
  for (const [slot, zid, fid, nid] of [['upper', 'zUp', 'fUp', 'nUp'], ['lower', 'zLo', 'fLo', 'nLo']]) {
    const e = S[slot], z = $(zid);
    z.classList.toggle('loaded', !!e);
    if (!e) { $(fid).textContent = 'nenhum arquivo'; $(nid).textContent = 'STL / PLY'; continue; }
    const b = A.bboxCenter(e.mesh).size;
    $(fid).textContent = e.name + ' · ' + (e.mesh.idx.length / 3).toLocaleString('pt-BR') + ' triângulos · ' +
      nf.format(b[0]) + '×' + nf.format(b[1]) + '×' + nf.format(b[2]) + ' mm';
    $(nid).textContent = e.mesh.col ? 'com cor' : e.ext.toUpperCase();
  }
}
window.__refreshZones = refreshZones;

function makeEntry(name, mesh) {
  const flipped = GEO.orientOutward(mesh);
  return { name, ext: (name.split('.').pop() || 'stl').toLowerCase(), mesh, flipNet: flipped };
}

async function loadFile(slot, file) {
  err('');
  status('Lendo ' + file.name + '…');
  await tick();
  try {
    const buf = await file.arrayBuffer();
    await tick();
    const mesh = IO.parse(file.name, buf);
    S[slot] = makeEntry(file.name, mesh);
  } catch (e) { err(file.name + ': ' + (e && e.message ? e.message : 'não foi possível ler o arquivo.')); status(''); return false; }
  return true;
}

function guessSlot(name) {
  if (/upper|sup|max|top|cima/i.test(name)) return 'upper';
  if (/lower|inf|mand|bot|baix/i.test(name)) return 'lower';
  return null;
}
async function handleFiles(files, forcedSlot) {
  files = Array.from(files).filter(f => /\.(stl|ply)$/i.test(f.name));
  if (!files.length) { err('Use arquivos .stl ou .ply.'); return; }
  const plan = [];
  if (forcedSlot) plan.push([forcedSlot, files[0]]);
  else if (files.length >= 2) {
    let [a, b] = files, ga = guessSlot(a.name), gb = guessSlot(b.name);
    if (ga && ga === gb) gb = ga === 'upper' ? 'lower' : 'upper';
    if (!ga && gb) ga = gb === 'upper' ? 'lower' : 'upper';
    if (ga && !gb) gb = ga === 'upper' ? 'lower' : 'upper';
    if (!ga) { ga = 'upper'; gb = 'lower'; }
    plan.push([ga, a], [gb, b]);
  } else {
    const f = files[0], g = guessSlot(f.name);
    plan.push([g || (!S.upper ? 'upper' : 'lower'), f]);
  }
  let ok = false;
  for (const [slot, f] of plan) ok = (await loadFile(slot, f)) || ok;
  if (!ok) return;
  afterLoad();
}
function afterLoad() {
  status('Preparando malhas…');
  setTimeout(() => { A.rebuild(true); refreshZones(); status(''); window.__refreshStats && window.__refreshStats(); }, 30);
}

/* ---------- exemplo sintético: dois arcos em forma de capa, com cúspides que se encaixam ---------- */
function capMesh(nu, nv, xyf, zf, wallH) {
  const pos = [], idx = [], id = (i, j) => j * (nu + 1) + i;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const [x, y] = xyf(i / nu, j / nv); pos.push(x, y, zf(i / nu, j / nv)); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1); idx.push(a, b, c, a, c, d); }
  const ring = [];
  for (let i = 0; i < nu; i++) ring.push(id(i, 0));
  for (let j = 0; j < nv; j++) ring.push(id(nu, j));
  for (let i = nu; i > 0; i--) ring.push(id(i, nv));
  for (let j = nv; j > 0; j--) ring.push(id(0, j));
  const base = pos.length / 3;
  for (const r of ring) pos.push(pos[r * 3], pos[r * 3 + 1], pos[r * 3 + 2] - wallH);
  for (let k = 0; k < ring.length; k++) {
    const k2 = (k + 1) % ring.length, b0 = ring[k], b1 = ring[k2];
    idx.push(b0, base + k2, b1, b0, base + k, base + k2);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx), col: null };
}
function sampleMeshes(dens = 1) {
  const R = 28, W = 11, nu = Math.round(190 * dens), nv = Math.round(26 * dens);
  const xy = (u, v) => { const th = (u - 0.5) * 2.3, vv = (v - 0.5) * W; return [R * Math.sin(th) + vv * -Math.sin(th), -R * Math.cos(th) + R + vv * Math.cos(th)]; };
  const h = (u, v) => {
    const s = (u - 0.5) * 2.3 * R, vv = (v - 0.5) * W;
    return 1.7 * (0.5 + 0.5 * Math.cos(2 * Math.PI * s / 5.4)) * (0.55 + 0.45 * Math.cos(Math.PI * vv / W)) +
      0.7 * Math.cos(2 * Math.PI * vv / 6.3 + 0.5) * (0.5 + 0.5 * Math.cos(2 * Math.PI * s / 10.7 + 1));
  };
  const upper = capMesh(nu, nv, xy, h, 4);
  for (let i = 2; i < upper.pos.length; i += 3) upper.pos[i] = -upper.pos[i];
  GEO.flipWinding(upper);
  const lower = capMesh(nu, nv, xy, (u, v) => -(0.93 * h(u, v) + 0.1 * (0.5 + 0.5 * Math.cos(2 * Math.PI * ((u - 0.5) * 2.3 * R) / 7.7))), 4);
  const c = Math.cos(0.11), s = Math.sin(0.11), tmp = [0, 0, 0];
  for (const m of [upper, lower]) {
    for (let i = 0; i < m.pos.length; i += 3) {
      let x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
      if (m === lower) { const y2 = y * c - z * s, z2 = y * s + z * c; y = y2; z = z2; x += 2.2; y += -3.0; z += -5.2; }
      m.pos[i] = x + 35; m.pos[i + 1] = y - 12; m.pos[i + 2] = z + 8;
    }
  }
  return { upper, lower };
}
function loadSample() {
  err('');
  const { upper, lower } = sampleMeshes();
  S.upper = makeEntry('exemplo_upper.stl', upper);
  S.lower = makeEntry('exemplo_lower.stl', lower);
  afterLoad();
}

function flip(slot) {
  const e = S[slot]; if (!e) return;
  GEO.flipWinding(e.mesh); e.flipNet = !e.flipNet;
  A.rebuild(false); refreshZones();
  window.__refreshStats && window.__refreshStats();
}

/* ---------- eventos ---------- */
function wire() {
  const pick = $('pick');
  let pickSlot = null;
  for (const z of [$('zUp'), $('zLo')]) {
    z.addEventListener('click', () => { pickSlot = z.dataset.slot; pick.value = ''; pick.click(); });
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drag'); });
    z.addEventListener('dragleave', () => z.classList.remove('drag'));
    z.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); z.classList.remove('drag'); handleFiles(e.dataTransfer.files, z.dataset.slot); });
  }
  pick.addEventListener('change', () => { if (pick.files.length) handleFiles(pick.files, pick.files.length === 1 ? pickSlot : null); });
  const st = $('stage');
  st.addEventListener('dragover', e => { e.preventDefault(); st.classList.add('drag'); });
  st.addEventListener('dragleave', () => st.classList.remove('drag'));
  st.addEventListener('drop', e => { e.preventDefault(); st.classList.remove('drag'); handleFiles(e.dataTransfer.files, null); });
  $('btnSample').addEventListener('click', loadSample);
  $('btnFlipUp').addEventListener('click', () => flip('upper'));
  $('btnFlipLo').addEventListener('click', () => flip('lower'));
  $('chkGhost').addEventListener('change', A.applyGhost);
  $('chkOrig').addEventListener('change', () => { window.__recolor && window.__recolor(); });
  for (const b of $('views').querySelectorAll('button')) b.addEventListener('click', () => A.fitView(b.dataset.v));
}
window.__B = { wire, status, err, esc, nf, nf2, handleFiles, loadSample, sampleMeshes };
})();

/* ===== App: posicionamento manual e automático ===== */
(function () {
'use strict';
const A = window.__A, B = window.__B, { $, tick, S } = A;

window.__updateButtons = function () {
  const both = !!(S.upper && S.lower);
  $('btnAuto').disabled = !both || S.busy;
  $('btnUndo').disabled = !S.undo.length || S.busy;
  $('btnReset').disabled = !both || A.isIdentity(S.M) || S.busy;
  $('btnZip').disabled = !both || S.busy;
  $('btnFlipUp').disabled = !S.upper || S.busy;
  $('btnFlipLo').disabled = !S.lower || S.busy;
};
window.__afterRebuild = function () { window.__updateButtons(); };

async function ensureBVH(e) {
  if (e.bvh) return;
  GEO.buildGrid(e.work); e.bvh = true;
  await tick();
}
window.__ensureBVH = ensureBVH;

function setMode(m) {
  S.mode = m;
  $('mAuto').setAttribute('aria-pressed', String(m === 'auto'));
  $('mMan').setAttribute('aria-pressed', String(m === 'man'));
  $('pAuto').hidden = m !== 'auto'; $('pMan').hidden = m !== 'man';
  A.attachGizmo();
}

/* ---------- manual ---------- */
const ROT = { '0.05': 0.1, '0.2': 0.5, '1': 2 };
function nudge(kind, ax, sign) {
  const st = parseFloat($('step').value);
  let M = S.M;
  if (kind === 't') { const t = [0, 0, 0]; t[ax] = sign * st; M = GEO.mat4Mul(A.T3(t), M); }
  else {
    const w = [0, 0, 0]; w[ax] = sign * (ROT[$('step').value] || 0.5) * Math.PI / 180;
    const p = [0, 0, 0]; GEO.applyPt(M, S.cl[0], S.cl[1], S.cl[2], p);
    const R = GEO.mat4FromRT(GEO.rodrigues(w[0], w[1], w[2]), [0, 0, 0]);
    M = GEO.mat4Mul(A.T3(p), GEO.mat4Mul(R, GEO.mat4Mul(A.T3([-p[0], -p[1], -p[2]]), M)));
  }
  A.setPose(M);
}
function buildNudge() {
  const host = $('nudge'); host.textContent = '';
  const rows = [['Mover X', 't', 0], ['Mover Y', 't', 1], ['Mover Z', 't', 2], ['Girar X', 'r', 0], ['Girar Y', 'r', 1], ['Girar Z', 'r', 2]];
  for (const [label, kind, ax] of rows) {
    const l = document.createElement('div'); l.className = 'ax'; l.textContent = label; host.appendChild(l);
    for (const sign of [-1, 1]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small';
      b.textContent = sign < 0 ? '−' : '+'; b.setAttribute('aria-label', label + (sign < 0 ? ' negativo' : ' positivo'));
      b.addEventListener('click', () => nudge(kind, ax, sign)); host.appendChild(b);
    }
  }
}

/* ---------- automático ---------- */
function progress(msg, f) {
  $('barWrap').classList.add('on'); $('bar').style.width = Math.round(f * 100) + '%'; $('pmsg').textContent = msg;
}
async function runAuto() {
  if (S.busy || !S.upper || !S.lower) return;
  S.busy = true; S.cancel = false; B.err('');
  $('btnAuto').disabled = true; $('btnCancel').hidden = false; window.__updateButtons();
  progress('Preparando malhas…', 0.02);
  try {
    await tick();
    await ensureBVH(S.upper); await ensureBVH(S.lower);
    const starts = [Float64Array.from(S.M), ...OPT.candidates(S.upper.work, S.lower.work)];
    const t0 = performance.now();
    const r = await OPT.autoOcclusion(S.upper.work, S.lower.work, { starts, cancel: () => S.cancel, onProgress: progress });
    A.setPose(r.M);
    $('pmsg').textContent = 'Concluído em ' + ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',') + ' s. Confira o mapa de contatos e ajuste no modo manual se precisar.';
    $('bar').style.width = '100%';
    if (!S.heatOn) window.__setHeat && window.__setHeat(true);
  } catch (e) {
    $('pmsg').textContent = '';
    if (!/cancelado/.test(e.message)) B.err('Falha na busca de oclusão: ' + e.message);
    else $('pmsg').textContent = 'Busca cancelada.';
  } finally {
    S.busy = false; $('btnCancel').hidden = true; setTimeout(() => $('barWrap').classList.remove('on'), 800);
    window.__updateButtons();
  }
}

function wire() {
  $('mAuto').addEventListener('click', () => setMode('auto'));
  $('mMan').addEventListener('click', () => setMode('man'));
  $('gMove').addEventListener('click', () => { A.getTC() && A.getTC().setMode('translate'); $('gMove').setAttribute('aria-pressed', 'true'); $('gRot').setAttribute('aria-pressed', 'false'); A.requestRender(); });
  $('gRot').addEventListener('click', () => { A.getTC() && A.getTC().setMode('rotate'); $('gRot').setAttribute('aria-pressed', 'true'); $('gMove').setAttribute('aria-pressed', 'false'); A.requestRender(); });
  $('btnAuto').addEventListener('click', runAuto);
  $('btnCancel').addEventListener('click', () => { S.cancel = true; });
  $('btnUndo').addEventListener('click', A.undo);
  $('btnReset').addEventListener('click', () => A.setPose(GEO.mat4Identity()));
  buildNudge();
}
window.__C = { wire, setMode, runAuto };
})();

/* ===== App: mapa de contatos, estatísticas, exportação, inicialização ===== */
(function () {
'use strict';
const A = window.__A, B = window.__B, { $, tick, S } = A;

/* ---------- cores do mapa ---------- */
const C_PEN0 = [0.91, 0.22, 0.18], C_PEN1 = [0.52, 0.05, 0.10], C_CON = [0.96, 0.38, 0.16];
const C_Y = [0.95, 0.77, 0.19], C_G = [0.36, 0.75, 0.42], C_B = [0.17, 0.44, 0.86];
function mix(a, b, t, o, k) { o[k] = a[0] + (b[0] - a[0]) * t; o[k + 1] = a[1] + (b[1] - a[1]) * t; o[k + 2] = a[2] + (b[2] - a[2]) * t; }
function heatRGB(d, base, o, k) {
  if (d !== d || d > 1.2) { o[k] = base[0] * 0.8; o[k + 1] = base[1] * 0.8; o[k + 2] = base[2] * 0.8; }
  else if (d < -0.05) mix(C_PEN0, C_PEN1, Math.min(1, (-d - 0.05) / 0.5), o, k);
  else if (d <= 0.1) { o[k] = C_CON[0]; o[k + 1] = C_CON[1]; o[k + 2] = C_CON[2]; }
  else { const t = (d - 0.1) / 1.1; if (t < 0.5) mix(C_Y, C_G, t * 2, o, k); else mix(C_G, C_B, (t - 0.5) * 2, o, k); }
}

function paint() {
  const { upObj, loObj } = A.getObj();
  const use = S.heatOn && S.heat && S.heat.full;
  for (const [slot, obj, base, key] of [['upper', upObj, A.baseUp, 'dU'], ['lower', loObj, A.baseLo, 'dL']]) {
    const e = S[slot]; if (!e || !obj) continue;
    const attr = obj.geometry.getAttribute('color'), arr = attr.array;
    if (use) { const d = S.heat[key]; for (let i = 0; i < e.work.nv; i++) heatRGB(d[i], base, arr, i * 3); }
    else arr.set(A.colorArray(e, base, $('chkOrig').checked));
    attr.needsUpdate = true;
  }
  $('legend').classList.toggle('on', !!use);
  A.requestRender();
}
window.__recolor = paint;

/* ---------- distâncias ---------- */
function vertexAreas(e) {
  if (e.area) return e.area;
  const { pos, idx, nv, nt } = e.work, a = new Float32Array(nv);
  for (let t = 0; t < nt; t++) {
    const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
    const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
    const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
    a[idx[t * 3]] += ar; a[idx[t * 3 + 1]] += ar; a[idx[t * 3 + 2]] += ar;
  }
  return (e.area = a);
}
async function distances(src, M, dst, out, stride, run, onFrac) {
  const res = { d: 0 }, t = [0, 0, 0], n = src.nv, chunk = Math.max(2000, Math.floor(9000 / (stride > 1 ? 1 : 1)));
  let i = 0, done = 0;
  while (i < n) {
    const end = Math.min(n, i + chunk * stride);
    for (; i < end; i += stride) {
      GEO.applyPt(M, src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2], t);
      out[i] = GEO.closest(dst, t[0], t[1], t[2], 1.5, res) ? res.d : NaN;
    }
    done = Math.min(1, i / n); onFrac && onFrac(done);
    await tick();
    if (run !== S.heatRun) return false;
  }
  return true;
}

async function refreshStats() {
  if (!S.upper || !S.lower) { setStats(null); $('hmsg').textContent = ''; return; }
  const run = ++S.heatRun, up = S.upper, lo = S.lower;
  $('hmsg').textContent = 'Calculando contatos…';
  await tick();
  await window.__ensureBVH(up); await window.__ensureBVH(lo);
  if (run !== S.heatRun) return;
  const full = S.heatOn, nL = lo.work.nv, nU = up.work.nv;
  const stride = full ? 1 : Math.max(1, Math.ceil(Math.max(nL, nU) / 12000));
  const dL = new Float32Array(nL).fill(NaN), dU = new Float32Array(nU).fill(NaN);
  const Minv = GEO.invRigid(S.M);
  const prog = (f0, f1) => f => { if (full) $('hmsg').textContent = 'Calculando mapa… ' + Math.round((f0 + (f1 - f0) * f) * 100) + '%'; };
  if (!(await distances(lo.work, S.M, up.work, dL, stride, run, prog(0, 0.5)))) return;
  if (!(await distances(up.work, Minv, lo.work, dU, stride, run, prog(0.5, 1)))) return;
  S.heat = { dL, dU, full: stride === 1, stride };
  summarize(dL, dU, stride);
  $('hmsg').textContent = '';
  paint();
}
window.__refreshStats = refreshStats;

function summarize(dL, dU, stride) {
  const aL = vertexAreas(S.lower), aU = vertexAreas(S.upper);
  let maxPen = 0, area = 0, sg = 0, ng = 0;
  const one = (d, a, n) => {
    let cArea = 0;
    for (let i = 0; i < n; i += stride) {
      const v = d[i]; if (v !== v) continue;
      if (v < 0 && -v > maxPen) maxPen = -v;
      if (v >= -0.05 && v <= 0.1) cArea += a[i] * stride;
      else if (v > 0.1 && v <= 1.2) { sg += v; ng++; }
    }
    return cArea;
  };
  area = (one(dL, aL, dL.length) + one(dU, aU, dU.length)) / 2;
  setStats({ maxPen, area, gap: ng ? sg / ng : NaN });
}
function setStats(s) {
  if (!s) { $('sPen').textContent = '–'; $('sCon').textContent = '–'; $('sGap').textContent = '–'; return; }
  $('sPen').textContent = B.nf2.format(s.maxPen < 0.005 ? 0 : s.maxPen) + ' mm';
  $('sCon').textContent = (s.area >= 100 ? Math.round(s.area).toLocaleString('pt-BR') : B.nf.format(s.area)) + ' mm²';
  $('sGap').textContent = isNaN(s.gap) ? '–' : B.nf2.format(s.gap) + ' mm';
}

function setHeat(on) {
  S.heatOn = on;
  $('vNorm').setAttribute('aria-pressed', String(!on)); $('vHeat').setAttribute('aria-pressed', String(on));
  if (on && !(S.heat && S.heat.full)) refreshStats(); else paint();
}
window.__setHeat = setHeat;

/* ---------- exportação ---------- */
function neg(v) { return [-v[0], -v[1], -v[2]]; }
async function exportZip() {
  const errEl = $('errExp'); errEl.textContent = '';
  if (!S.upper || !S.lower || S.busy) return;
  const dl = (window.claude && window.claude.use) ? await window.claude.use('downloads') : null;
  const save = dl ? o => dl.save(o) : async ({ filename, data }) => {
    const url = URL.createObjectURL(data), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };
  S.busy = true; window.__updateButtons(); B.status('Gerando arquivos…');
  try {
    await tick();
    const fmt = $('fmt').value;
    const Mo = GEO.mat4Mul(A.T3(S.center), GEO.mat4Mul(S.M, A.T3(neg(S.center))));
    const orig = e => { if (!e.flipNet) return e.mesh; const idx = Uint32Array.from(e.mesh.idx); GEO.flipWinding({ idx }); return { pos: e.mesh.pos, idx, col: e.mesh.col }; };
    const ser = (e, M, suffix) => {
      const ext = fmt === 'orig' ? (e.ext === 'ply' ? 'ply' : 'stl') : fmt, m = orig(e);
      const buf = ext === 'ply' ? IO.writePLY(m, M) : IO.writeSTL(m, M);
      return { name: e.name.replace(/\.[^.]+$/, '') + suffix + '.' + ext, data: buf };
    };
    await tick();
    const fUp = ser(S.upper, null, '_referencia');
    await tick();
    const fLo = ser(S.lower, Mo, '_ocluido');
    const rows = [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => Number(Mo[c * 4 + r].toFixed(9))));
    const json = JSON.stringify({ descricao: 'Transformação aplicada ao lower, em coordenadas originais do upper (mm). Ponto novo = M · ponto original.', matriz_4x4: rows }, null, 2);
    const fJs = { name: 'posicao_lower.json', data: new TextEncoder().encode(json).buffer };
    const blob = IO.zip([fUp, fLo, fJs]);
    const base = S.lower.name.replace(/\.[^.]+$/, '');
    B.status('');
    await save({ filename: 'oclusao_' + base + '.zip', data: blob });
  } catch (e) {
    B.status('');
    if (!e || e.code !== 'declined') errEl.textContent = 'Não foi possível salvar: ' + ((e && e.message) || 'erro desconhecido');
  } finally { S.busy = false; window.__updateButtons(); }
}

/* ---------- início ---------- */
function init() {
  B.wire(); window.__C.wire();
  const root = document.documentElement;
  $('btnTheme').addEventListener('click', () => {
    const cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('av-theme', next); } catch (e) { }
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = next === 'dark' ? '#11171c' : '#f5f8f9';
  });
  const bar = document.querySelector('.bar');
  const setBarH = () => root.style.setProperty('--bar-h', bar.offsetHeight + 'px');
  new ResizeObserver(setBarH).observe(bar); setBarH();
  $('chkSect').addEventListener('change', e => { $('sectBody').hidden = !e.target.checked; A.setSection({ on: e.target.checked }); });
  $('selSectAxis').addEventListener('change', e => { $('rngSect').value = 500; A.setSection({ axis: +e.target.value, t: 0.5 }); });
  $('rngSect').addEventListener('input', e => A.setSection({ t: e.target.value / 1000 }));
  $('btnSectFlip').addEventListener('click', () => A.setSection({ flip: !S.sect.flip }));
  $('vNorm').addEventListener('click', () => setHeat(false));
  $('vHeat').addEventListener('click', () => setHeat(true));
  $('btnZip').addEventListener('click', exportZip);
  if (A.initScene()) {
    window.__C.setMode('auto');
    B.loadSample();
    B.status('Exemplo carregado');
    setTimeout(() => B.status(''), 4000);
  }
}
init();
})();
