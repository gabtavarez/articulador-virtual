/* ===== IO: parsers STL/PLY, weld, writers, ZIP ===== */
const IO = (() => {
  function weld(rawPos, rawCol) {
    const n = rawPos.length / 3;
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const v = rawPos[i * 3 + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
    const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1e-6);
    const q = Math.max(0.002, ext / 100000);
    const map = new Map();
    const remap = new Uint32Array(n);
    const pos = [], col = rawCol ? [] : null;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const ix = Math.round((rawPos[i * 3] - mn[0]) / q);
      const iy = Math.round((rawPos[i * 3 + 1] - mn[1]) / q);
      const iz = Math.round((rawPos[i * 3 + 2] - mn[2]) / q);
      const key = ix + iy * 131072 + iz * 17179869184;
      let id = map.get(key);
      if (id === undefined) {
        id = count++;
        map.set(key, id);
        pos.push(rawPos[i * 3], rawPos[i * 3 + 1], rawPos[i * 3 + 2]);
        if (col) col.push(rawCol[i * 3], rawCol[i * 3 + 1], rawCol[i * 3 + 2]);
      }
      remap[i] = id;
    }
    return { pos: Float32Array.from(pos), col: col ? Uint8Array.from(col) : null, remap };
  }

  function finish(pos, col, tri) {
    const w = weld(pos, col);
    const out = [];
    for (let i = 0; i < tri.length; i += 3) {
      const a = w.remap[tri[i]], b = w.remap[tri[i + 1]], c = w.remap[tri[i + 2]];
      if (a !== b && b !== c && a !== c) out.push(a, b, c);
    }
    if (!out.length) throw new Error("Malha sem triângulos válidos.");
    return { pos: w.pos, col: w.col, idx: Uint32Array.from(out) };
  }

  function parseSTL(buf) {
    const dv = new DataView(buf);
    let binary = false;
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === buf.byteLength) binary = true;
    }
    if (!binary) {
      const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(256, buf.byteLength)));
      if (!/^\s*solid/i.test(head)) binary = true;
    }
    if (binary) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 > buf.byteLength) throw new Error("STL binário truncado.");
      const pos = new Float32Array(n * 9), tri = new Uint32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        tri[i * 3] = i * 3; tri[i * 3 + 1] = i * 3 + 1; tri[i * 3 + 2] = i * 3 + 2;
      }
      return finish(pos, null, tri);
    }
    const text = new TextDecoder().decode(buf);
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    const arr = [];
    let m;
    while ((m = re.exec(text))) arr.push(+m[1], +m[2], +m[3]);
    const n = Math.floor(arr.length / 9) * 3;
    if (!n) throw new Error("STL ASCII sem vértices.");
    const pos = Float32Array.from(arr.slice(0, n * 3));
    const tri = new Uint32Array(n);
    for (let i = 0; i < n; i++) tri[i] = i;
    return finish(pos, null, tri);
  }

  const T = {
    char: [1, "getInt8"], int8: [1, "getInt8"], uchar: [1, "getUint8"], uint8: [1, "getUint8"],
    short: [2, "getInt16"], int16: [2, "getInt16"], ushort: [2, "getUint16"], uint16: [2, "getUint16"],
    int: [4, "getInt32"], int32: [4, "getInt32"], uint: [4, "getUint32"], uint32: [4, "getUint32"],
    float: [4, "getFloat32"], float32: [4, "getFloat32"], double: [8, "getFloat64"], float64: [8, "getFloat64"]
  };

  function parsePLY(buf) {
    const u8 = new Uint8Array(buf);
    let hEnd = -1;
    const key = "end_header";
    const lim = Math.min(u8.length, 65536);
    for (let i = 0; i < lim - key.length; i++) {
      let ok = true;
      for (let k = 0; k < key.length; k++) if (u8[i + k] !== key.charCodeAt(k)) { ok = false; break; }
      if (ok) { hEnd = i + key.length; break; }
    }
    if (hEnd < 0) throw new Error("Cabeçalho PLY inválido.");
    let p = hEnd;
    if (u8[p] === 13) p++;
    if (u8[p] === 10) p++;
    const header = new TextDecoder().decode(u8.subarray(0, hEnd)).split(/\r?\n/);
    let format = "ascii";
    const els = [];
    for (const line of header) {
      const t = line.trim().split(/\s+/);
      if (t[0] === "format") format = t[1];
      else if (t[0] === "element") els.push({ name: t[1], count: +t[2], props: [] });
      else if (t[0] === "property" && els.length) {
        if (t[1] === "list") els[els.length - 1].props.push({ list: true, ct: t[2], it: t[3], name: t[4] });
        else els[els.length - 1].props.push({ list: false, type: t[1], name: t[2] });
      }
    }
    const little = format !== "binary_big_endian";
    const isAscii = format === "ascii";
    const dv = new DataView(buf);
    let tokens = null, tp = 0;
    if (isAscii) tokens = new TextDecoder().decode(u8.subarray(p)).split(/\s+/).filter(Boolean);
    const rd = (type) => {
      if (isAscii) return +tokens[tp++];
      const d = T[type];
      if (!d) throw new Error("Tipo PLY não suportado: " + type);
      const v = dv[d[1]](p, little);
      p += d[0];
      return v;
    };
    let pos = null, col = null;
    const tri = [];
    for (const el of els) {
      if (el.name === "vertex") {
        const names = el.props.map(q => q.name);
        const ix = names.indexOf("x"), iy = names.indexOf("y"), iz = names.indexOf("z");
        const ir = Math.max(names.indexOf("red"), names.indexOf("r"));
        const ig = Math.max(names.indexOf("green"), names.indexOf("g"));
        const ib = Math.max(names.indexOf("blue"), names.indexOf("b"));
        const hasCol = names.includes("red") || names.includes("r");
        pos = new Float32Array(el.count * 3);
        if (hasCol) col = new Uint8Array(el.count * 3);
        for (let i = 0; i < el.count; i++) {
          for (let j = 0; j < el.props.length; j++) {
            const pr = el.props[j];
            if (pr.list) { const c = rd(pr.ct); for (let k = 0; k < c; k++) rd(pr.it); continue; }
            const v = rd(pr.type);
            if (j === ix) pos[i * 3] = v; else if (j === iy) pos[i * 3 + 1] = v; else if (j === iz) pos[i * 3 + 2] = v;
            else if (hasCol) {
              if (j === ir) col[i * 3] = v; else if (j === ig) col[i * 3 + 1] = v; else if (j === ib) col[i * 3 + 2] = v;
            }
          }
        }
      } else if (el.name === "face") {
        for (let i = 0; i < el.count; i++) {
          for (const pr of el.props) {
            if (!pr.list) { rd(pr.type); continue; }
            const c = rd(pr.ct);
            const f = [];
            for (let k = 0; k < c; k++) f.push(rd(pr.it));
            if (pr.name === "vertex_indices" || pr.name === "vertex_index")
              for (let k = 1; k + 1 < f.length; k++) tri.push(f[0], f[k], f[k + 1]);
          }
        }
      } else {
        for (let i = 0; i < el.count; i++)
          for (const pr of el.props) {
            if (pr.list) { const c = rd(pr.ct); for (let k = 0; k < c; k++) rd(pr.it); } else rd(pr.type);
          }
      }
    }
    if (!pos || !tri.length) throw new Error("PLY sem vértices ou faces.");
    return finish(pos, col, tri);
  }

  function parse(name, buf) {
    const ext = name.toLowerCase().split(".").pop();
    if (ext === "stl") return parseSTL(buf);
    if (ext === "ply") return parsePLY(buf);
    throw new Error("Formato não suportado: ." + ext + " (use STL ou PLY).");
  }

  /* m = Float64Array(16) column-major (como o three.js) ou null */
  function xform(pos, m) {
    if (!m) return pos;
    const o = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      o[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      o[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      o[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return o;
  }

  function writeSTL(mesh, m) {
    const pos = xform(mesh.pos, m), idx = mesh.idx, n = idx.length / 3;
    const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const hdr = "Articulador Virtual";
    for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
    dv.setUint32(80, n, true);
    for (let t = 0; t < n; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const o = 84 + t * 50;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      let q = o + 12;
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { dv.setFloat32(q, pos[v + k], true); q += 4; }
    }
    return buf;
  }

  function writePLY(mesh, m) {
    const pos = xform(mesh.pos, m), idx = mesh.idx, nv = pos.length / 3, nf = idx.length / 3;
    const hasC = !!mesh.col;
    const head = "ply\nformat binary_little_endian 1.0\ncomment Articulador Virtual\nelement vertex " + nv +
      "\nproperty float x\nproperty float y\nproperty float z\n" +
      (hasC ? "property uchar red\nproperty uchar green\nproperty uchar blue\n" : "") +
      "element face " + nf + "\nproperty list uchar int vertex_indices\nend_header\n";
    const hb = new TextEncoder().encode(head);
    const vs = hasC ? 15 : 12;
    const buf = new ArrayBuffer(hb.length + nv * vs + nf * 13), dv = new DataView(buf);
    new Uint8Array(buf).set(hb, 0);
    let o = hb.length;
    for (let i = 0; i < nv; i++) {
      dv.setFloat32(o, pos[i * 3], true); dv.setFloat32(o + 4, pos[i * 3 + 1], true); dv.setFloat32(o + 8, pos[i * 3 + 2], true);
      o += 12;
      if (hasC) { dv.setUint8(o, mesh.col[i * 3]); dv.setUint8(o + 1, mesh.col[i * 3 + 1]); dv.setUint8(o + 2, mesh.col[i * 3 + 2]); o += 3; }
    }
    for (let t = 0; t < nf; t++) {
      dv.setUint8(o, 3);
      dv.setInt32(o + 1, idx[t * 3], true); dv.setInt32(o + 5, idx[t * 3 + 1], true); dv.setInt32(o + 9, idx[t * 3 + 2], true);
      o += 13;
    }
    return buf;
  }

  let crcTable = null;
  function crc32(u8) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ZIP sem compressão. files: [{name, data: ArrayBuffer}] */
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const nameB = enc.encode(f.name), data = new Uint8Array(f.data), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameB, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    }
    let csize = 0;
    for (const c of central) csize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  return { parse, parseSTL, parsePLY, writeSTL, writePLY, zip, crc32, weld };
})();
if (typeof module !== "undefined") module.exports = IO;

/* ===== GEO: matrizes, PCA, preparo de malha, grade espacial, ponto mais próximo ===== */
const GEO = (() => {
  const mat4Identity = () => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  function mat4Mul(a, b) {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function mat4FromRT(R, t) { // R row-major [9]
    const m = mat4Identity();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = R[r * 3 + c];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
    return m;
  }
  function invRigid(m) {
    const o = mat4Identity();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
    for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14]);
    return o;
  }
  function rodrigues(wx, wy, wz) { // row-major
    const th = Math.hypot(wx, wy, wz);
    if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const x = wx / th, y = wy / th, z = wz / th, c = Math.cos(th), s = Math.sin(th), v = 1 - c;
    return [c + x * x * v, x * y * v - z * s, x * z * v + y * s,
      y * x * v + z * s, c + y * y * v, y * z * v - x * s,
      z * x * v - y * s, z * y * v + x * s, c + z * z * v];
  }
  function applyPt(m, x, y, z, o) {
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  function applyDir(m, x, y, z, o) {
    o[0] = m[0] * x + m[4] * y + m[8] * z;
    o[1] = m[1] * x + m[5] * y + m[9] * z;
    o[2] = m[2] * x + m[6] * y + m[10] * z;
  }

  /* autovetores de matriz simétrica 3x3 (Jacobi). Retorna {vals, vecs: colunas} ordenados desc. */
  function eigSym3(A) {
    const a = A.slice(), V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
      if (off < 1e-14) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        const apq = a[p * 3 + q];
        if (Math.abs(apq) < 1e-18) continue;
        const th = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k * 3 + p], akq = a[k * 3 + q];
          a[k * 3 + p] = c * akp - s * akq; a[k * 3 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p * 3 + k], aqk = a[q * 3 + k];
          a[p * 3 + k] = c * apk - s * aqk; a[q * 3 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
          V[k * 3 + p] = c * vkp - s * vkq; V[k * 3 + q] = s * vkp + c * vkq;
        }
      }
    }
    const order = [0, 1, 2].sort((i, j) => a[j * 3 + j] - a[i * 3 + i]);
    const vals = order.map(i => a[i * 3 + i]);
    const vecs = order.map(i => [V[i], V[3 + i], V[6 + i]]); // cada vetor
    return { vals, vecs };
  }

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /* PCA de pontos (Float32Array xyz): centro + eixos (e1 maior, e3 menor), destro */
  function pca(pos, stride = 1) {
    const n = Math.floor(pos.length / 3 / stride);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { const j = i * stride * 3; cx += pos[j]; cy += pos[j + 1]; cz += pos[j + 2]; }
    cx /= n; cy /= n; cz /= n;
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const j = i * stride * 3, x = pos[j] - cx, y = pos[j + 1] - cy, z = pos[j + 2] - cz;
      C[0] += x * x; C[1] += x * y; C[2] += x * z; C[4] += y * y; C[5] += y * z; C[8] += z * z;
    }
    C[3] = C[1]; C[6] = C[2]; C[7] = C[5];
    for (let i = 0; i < 9; i++) C[i] /= n;
    const { vals, vecs } = eigSym3(C);
    const e3 = cross(vecs[0], vecs[1]);
    vecs[2] = e3;
    return { c: [cx, cy, cz], axes: vecs, vals };
  }

  /* Orienta triângulos para fora (volume assinado); retorna true se inverteu */
  function orientOutward(mesh) {
    const { pos, idx } = mesh;
    let cx = 0, cy = 0, cz = 0;
    const nv = pos.length / 3;
    for (let i = 0; i < nv; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
    cx /= nv; cy /= nv; cz /= nv;
    let vol = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = pos[a] - cx, ay = pos[a + 1] - cy, az = pos[a + 2] - cz;
      const bx = pos[b] - cx, by = pos[b + 1] - cy, bz = pos[b + 2] - cz;
      const qx = pos[c] - cx, qy = pos[c + 1] - cy, qz = pos[c + 2] - cz;
      vol += ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx);
    }
    if (vol < 0) { flipWinding(mesh); return true; }
    return false;
  }
  function flipWinding(mesh) {
    const idx = mesh.idx;
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  }

  /* Malha de trabalho: posições centradas em `center`, normais de face, grade espacial */
  function prepare(mesh, center, cellSize) {
    const nv = mesh.pos.length / 3, nt = mesh.idx.length / 3;
    const pos = new Float32Array(mesh.pos.length);
    for (let i = 0; i < nv; i++) {
      pos[i * 3] = mesh.pos[i * 3] - center[0];
      pos[i * 3 + 1] = mesh.pos[i * 3 + 1] - center[1];
      pos[i * 3 + 2] = mesh.pos[i * 3 + 2] - center[2];
    }
    const idx = mesh.idx, fn = new Float32Array(nt * 3);
    let edge = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) {
      const v = pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
    }
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
      edge += Math.hypot(ux, uy, uz);
    }
    edge /= nt;
    // adjacência de arestas (aresta e do triângulo t liga idx[e] e idx[e+1])
    const nbr = new Int32Array(nt * 3).fill(-1), amap = new Map();
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const va = idx[t * 3 + e], vb = idx[t * 3 + (e + 1) % 3];
      const key = va < vb ? va * nv + vb : vb * nv + va;
      const o = amap.get(key);
      if (o === undefined) amap.set(key, t * 3 + e); else { nbr[t * 3 + e] = o; nbr[o] = t * 3 + e; }
    }
    // pseudo-normal de vértice (ponderada pelo ângulo) e vértices de fronteira
    const vn = new Float32Array(nv * 3), bv = new Uint8Array(nv);
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const i0 = idx[t * 3 + e] * 3, i1 = idx[t * 3 + (e + 1) % 3] * 3, i2 = idx[t * 3 + (e + 2) % 3] * 3;
      const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
      const wx = pos[i2] - pos[i0], wy = pos[i2 + 1] - pos[i0 + 1], wz = pos[i2 + 2] - pos[i0 + 2];
      const c = (ux * wx + uy * wy + uz * wz) / ((Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz)) || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, c)));
      vn[i0] += fn[t * 3] * ang; vn[i0 + 1] += fn[t * 3 + 1] * ang; vn[i0 + 2] += fn[t * 3 + 2] * ang;
      if (nbr[t * 3 + e] < 0) { bv[idx[t * 3 + e]] = 1; bv[idx[t * 3 + (e + 1) % 3]] = 1; }
    }
    for (let i = 0; i < nv; i++) {
      const l = Math.hypot(vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]) || 1;
      vn[i * 3] /= l; vn[i * 3 + 1] /= l; vn[i * 3 + 2] /= l;
    }
    const cs = cellSize || Math.min(2, Math.max(1.0, edge * 4));
    return { pos, idx, fn, vn, nbr, bv, nv, nt, mn, mx, edge, cs, grid: null };
  }

  /* BVH (AABB, partição pela mediana dos centróides). `pad` é ignorado (compatibilidade). */
  function buildGrid(m, pad) {
    const { pos, idx, nt } = m;
    const cen = new Float32Array(nt * 3), bmn = new Float32Array(nt * 3), bmx = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      for (let k = 0; k < 3; k++) {
        const p = pos[a + k], q = pos[b + k], r = pos[c + k];
        bmn[t * 3 + k] = Math.min(p, q, r); bmx[t * 3 + k] = Math.max(p, q, r);
        cen[t * 3 + k] = (p + q + r) / 3;
      }
    }
    const order = new Int32Array(nt);
    for (let i = 0; i < nt; i++) order[i] = i;
    const maxNodes = 2 * Math.ceil(nt / 2) + 16;
    const nb = new Float32Array(maxNodes * 6), ni = new Int32Array(maxNodes * 3);
    let count = 0;
    const select = (lo, hi, kth, ax) => { // quickselect em order[lo..hi] por cen[.,ax]
      while (lo < hi) {
        const pv = cen[order[(lo + hi) >> 1] * 3 + ax];
        let i = lo, j = hi;
        while (i <= j) {
          while (cen[order[i] * 3 + ax] < pv) i++;
          while (cen[order[j] * 3 + ax] > pv) j--;
          if (i <= j) { const t = order[i]; order[i] = order[j]; order[j] = t; i++; j--; }
        }
        if (kth <= j) hi = j; else if (kth >= i) lo = i; else return;
      }
    };
    const stack = [[0, nt, -1, 0]]; // start, end, parent, isRight
    while (stack.length) {
      const [s, e, parent, isRight] = stack.pop();
      const id = count++;
      if (parent >= 0 && isRight) ni[parent * 3 + 1] = id;
      const o = id * 6;
      nb[o] = nb[o + 1] = nb[o + 2] = Infinity; nb[o + 3] = nb[o + 4] = nb[o + 5] = -Infinity;
      let cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
      for (let i = s; i < e; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) {
          if (bmn[t * 3 + k] < nb[o + k]) nb[o + k] = bmn[t * 3 + k];
          if (bmx[t * 3 + k] > nb[o + 3 + k]) nb[o + 3 + k] = bmx[t * 3 + k];
          const cv = cen[t * 3 + k]; if (cv < cmn[k]) cmn[k] = cv; if (cv > cmx[k]) cmx[k] = cv;
        }
      }
      if (e - s <= 4) { ni[id * 3] = s; ni[id * 3 + 1] = e - s; ni[id * 3 + 2] = 1; continue; }
      let ax = 0;
      if (cmx[1] - cmn[1] > cmx[ax] - cmn[ax]) ax = 1;
      if (cmx[2] - cmn[2] > cmx[ax] - cmn[ax]) ax = 2;
      const mid = (s + e) >> 1;
      select(s, e - 1, mid, ax);
      ni[id * 3 + 2] = 0; ni[id * 3] = id + 1; // filho esquerdo = próximo nó
      stack.push([mid, e, id, 1]);
      stack.push([s, mid, id, 0]);
    }
    m.grid = { order, nb, ni, nodes: count, stk: new Int32Array(128), sd: new Float64Array(128) };
    return m;
  }

  /* ponto mais próximo no triângulo (Ericson) -> out[0..2] */
  function closestOnTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return 1; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return 2; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return 4;
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return 3; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return 6;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return 5;
    }
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
    return 0;
  }

  /* Consulta: preenche res {d (assinada), tri, qx,qy,qz}; retorna false se nada dentro de maxR */
  const _q = [0, 0, 0];
  function closest(m, px, py, pz, maxR, res) {
    const g = m.grid, { pos, idx, fn } = m, nb = g.nb, ni = g.ni, order = g.order, stk = g.stk, sd = g.sd;
    let best = maxR * maxR, bt = -1, bx = 0, by = 0, bz = 0, sp = 0, bf = 0;
    stk[0] = 0; sd[0] = 0; sp = 1;
    while (sp > 0) {
      sp--;
      if (sd[sp] >= best) continue;
      const id = stk[sp];
      if (ni[id * 3 + 2] === 1) {
        for (let s = ni[id * 3], e = s + ni[id * 3 + 1]; s < e; s++) {
          const t = order[s];
          const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, cc = idx[t * 3 + 2] * 3;
          const ft = closestOnTri(px, py, pz, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[cc], pos[cc + 1], pos[cc + 2], _q);
          const dx = px - _q[0], dy = py - _q[1], dz = pz - _q[2], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) { best = d2; bt = t; bf = ft; bx = _q[0]; by = _q[1]; bz = _q[2]; }
        }
        continue;
      }
      const l = ni[id * 3], r = ni[id * 3 + 1];
      let dl = 0, dr = 0;
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? px : k === 1 ? py : pz;
        let lo = nb[l * 6 + k], hi = nb[l * 6 + 3 + k];
        if (v < lo) dl += (lo - v) * (lo - v); else if (v > hi) dl += (v - hi) * (v - hi);
        lo = nb[r * 6 + k]; hi = nb[r * 6 + 3 + k];
        if (v < lo) dr += (lo - v) * (lo - v); else if (v > hi) dr += (v - hi) * (v - hi);
      }
      if (dl < dr) {
        if (dr < best) { stk[sp] = r; sd[sp++] = dr; }
        if (dl < best) { stk[sp] = l; sd[sp++] = dl; }
      } else {
        if (dl < best) { stk[sp] = l; sd[sp++] = dl; }
        if (dr < best) { stk[sp] = r; sd[sp++] = dr; }
      }
    }
    if (bt < 0) return false;
    const dist = Math.sqrt(best);
    // normal da feição mais próxima: face, aresta (média das duas faces) ou vértice (pseudo-normal)
    let nx, ny, nz, amb = false;
    if (bf === 0) { nx = fn[bt * 3]; ny = fn[bt * 3 + 1]; nz = fn[bt * 3 + 2]; }
    else if (bf <= 3) {
      const v = idx[bt * 3 + bf - 1];
      if (m.bv[v]) amb = true;
      nx = m.vn[v * 3]; ny = m.vn[v * 3 + 1]; nz = m.vn[v * 3 + 2];
    } else {
      const e = bf - 4, o = m.nbr[bt * 3 + e];
      if (o < 0) { amb = true; nx = fn[bt * 3]; ny = fn[bt * 3 + 1]; nz = fn[bt * 3 + 2]; }
      else {
        const t2 = (o / 3) | 0;
        nx = fn[bt * 3] + fn[t2 * 3]; ny = fn[bt * 3 + 1] + fn[t2 * 3 + 1]; nz = fn[bt * 3 + 2] + fn[t2 * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      }
    }
    const sgn = (px - bx) * nx + (py - by) * ny + (pz - bz) * nz;
    // fronteira aberta da varredura: sem lado "dentro" definido, conta como fora
    res.d = (!amb && sgn < 0) ? -dist : dist;
    res.tri = bt; res.qx = bx; res.qy = by; res.qz = bz;
    return true;
  }

  return { mat4Identity, mat4Mul, mat4FromRT, invRigid, rodrigues, applyPt, applyDir, eigSym3, pca, cross, dot,
    orientOutward, flipWinding, prepare, buildGrid, closest };
})();
if (typeof module !== "undefined") module.exports = GEO;

/* ===== OPT v2: oclusão estática com custo robusto (Geman-McClure) + penetração, recozimento em σ ===== */
const OPT = (() => {
  const G = typeof GEO !== "undefined" ? GEO : require("./core_geom.js");
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* amostra de vértices: posições e pseudo-normais (a normal serve para ignorar superfícies que não se encaram) */
  function sampleVerts(m, n) {
    const step = Math.max(1, Math.floor(m.nv / n)), cnt = Math.floor(m.nv / step);
    const o = new Float32Array(cnt * 3), nr = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      const j = i * step * 3;
      o[i * 3] = m.pos[j]; o[i * 3 + 1] = m.pos[j + 1]; o[i * 3 + 2] = m.pos[j + 2];
      nr[i * 3] = m.vn[j]; nr[i * 3 + 1] = m.vn[j + 1]; nr[i * 3 + 2] = m.vn[j + 2];
    }
    o.nr = nr;
    return o;
  }

  /* Custo e (opcionalmente) sistema normal 6x6 para a pose M do lower (upper fixo).
     d >= 0: Geman-McClure  s2*d^2/(d^2+s2)  (satura, mas tem bacia larga quando sigma é grande)
     d <  0: wp*d^2        (penetração nunca satura dentro de maxR) */
  function evaluate(M, ctx, P, wantJ) {
    const { up, lo, Ls, Us } = ctx;
    const res = { d: 0, tri: 0, qx: 0, qy: 0, qz: 0 };
    const A = wantJ ? new Float64Array(36) : null, b = wantJ ? new Float64Array(6) : null;
    const J = new Float64Array(6), tmp = [0, 0, 0], tmp2 = [0, 0, 0], nn = [0, 0, 0];
    const s2 = P.sigma * P.sigma, s4 = s2 * s2;
    let cost = 0, nPen = 0, nCon = 0, nNear = 0, maxPen = 0;
    const add = (w, r) => {
      for (let i = 0; i < 6; i++) {
        b[i] += w * J[i] * r;
        for (let j = i; j < 6; j++) A[i * 6 + j] += w * J[i] * J[j];
      }
    };
    /* d<0: penetração (sempre vale). d>=0: só conta quanto as superfícies se encaram (normais opostas) */
    const handle = (d, dotN) => {
      if (d < 0) { cost += P.wp * d * d; nPen++; if (-d > maxPen) maxPen = -d; return P.wp; }
      const f = Math.max(0, Math.min(1, -dotN / 0.6));
      const q = d * d + s2;
      cost += f * s2 * d * d / q + (1 - f) * s2;
      if (f > 0.5) { if (d < 0.15) nCon++; if (d < 1) nNear++; }
      return f * s4 / (q * q);
    };
    const nL = Ls.length / 3, nU = Us.length / 3, nrL = Ls.nr, nrU = Us.nr;
    for (let i = 0; i < nL; i++) {
      G.applyPt(M, Ls[i * 3], Ls[i * 3 + 1], Ls[i * 3 + 2], tmp);
      if (!G.closest(up, tmp[0], tmp[1], tmp[2], P.maxR, res)) { cost += s2; continue; }
      G.applyDir(M, nrL[i * 3], nrL[i * 3 + 1], nrL[i * 3 + 2], nn);
      const t3 = res.tri * 3, dotN = nn[0] * up.fn[t3] + nn[1] * up.fn[t3 + 1] + nn[2] * up.fn[t3 + 2];
      const d = res.d, w = handle(d, dotN);
      if (wantJ && w > 0) {
        const nx = up.fn[t3], ny = up.fn[t3 + 1], nz = up.fn[t3 + 2];
        J[0] = tmp[1] * nz - tmp[2] * ny; J[1] = tmp[2] * nx - tmp[0] * nz; J[2] = tmp[0] * ny - tmp[1] * nx;
        J[3] = nx; J[4] = ny; J[5] = nz;
        add(w, d);
      }
    }
    const Minv = G.invRigid(M);
    for (let i = 0; i < nU; i++) {
      G.applyPt(Minv, Us[i * 3], Us[i * 3 + 1], Us[i * 3 + 2], tmp);
      if (!G.closest(lo, tmp[0], tmp[1], tmp[2], P.maxR, res)) { cost += s2; continue; }
      G.applyDir(Minv, nrU[i * 3], nrU[i * 3 + 1], nrU[i * 3 + 2], nn);
      const t3 = res.tri * 3, dotN = nn[0] * lo.fn[t3] + nn[1] * lo.fn[t3 + 1] + nn[2] * lo.fn[t3 + 2];
      const d = res.d, w = handle(d, dotN);
      if (wantJ && w > 0) {
        G.applyPt(M, res.qx, res.qy, res.qz, tmp2);
        G.applyDir(M, lo.fn[t3], lo.fn[t3 + 1], lo.fn[t3 + 2], tmp);
        J[0] = -(tmp2[1] * tmp[2] - tmp2[2] * tmp[1]); J[1] = -(tmp2[2] * tmp[0] - tmp2[0] * tmp[2]); J[2] = -(tmp2[0] * tmp[1] - tmp2[1] * tmp[0]);
        J[3] = -tmp[0]; J[4] = -tmp[1]; J[5] = -tmp[2];
        add(w, d);
      }
    }
    if (wantJ) for (let i = 0; i < 6; i++) for (let j = 0; j < i; j++) A[i * 6 + j] = A[j * 6 + i];
    return { cost: cost / (nL + nU), A, b, nPen, nCon, nNear, maxPen, n: nL + nU };
  }

  function solve6(A, b, lambda) {
    const n = 6, M = new Float64Array(n * (n + 1));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i * 7 + j] = A[i * 6 + j];
      M[i * 7 + i] += lambda * (A[i * 6 + i] + 1e-6);
      M[i * 7 + 6] = -b[i];
    }
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r * 7 + c]) > Math.abs(M[p * 7 + c])) p = r;
      if (Math.abs(M[p * 7 + c]) < 1e-14) return null;
      if (p !== c) for (let k = 0; k < 7; k++) { const t = M[c * 7 + k]; M[c * 7 + k] = M[p * 7 + k]; M[p * 7 + k] = t; }
      for (let r = c + 1; r < n; r++) {
        const f = M[r * 7 + c] / M[c * 7 + c];
        for (let k = c; k < 7; k++) M[r * 7 + k] -= f * M[c * 7 + k];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i * 7 + 6];
      for (let j = i + 1; j < n; j++) s -= M[i * 7 + j] * x[j];
      x[i] = s / M[i * 7 + i];
    }
    return x;
  }

  function applyDelta(M, x, maxRot, maxTr) {
    let wx = x[0], wy = x[1], wz = x[2], tx = x[3], ty = x[4], tz = x[5];
    const r = Math.hypot(wx, wy, wz), t = Math.hypot(tx, ty, tz);
    if (r > maxRot) { const f = maxRot / r; wx *= f; wy *= f; wz *= f; }
    if (t > maxTr) { const f = maxTr / t; tx *= f; ty *= f; tz *= f; }
    return G.mat4Mul(G.mat4FromRT(G.rodrigues(wx, wy, wz), [tx, ty, tz]), M);
  }

  async function refine(M, ctx, P, iters, opt = {}) {
    let cur = evaluate(M, ctx, P, true), lambda = 0.05, stall = 0;
    for (let it = 0; it < iters; it++) {
      if (opt.cancel && opt.cancel()) break;
      let ok = false;
      for (let tr = 0; tr < 6; tr++) {
        const x = solve6(cur.A, cur.b, lambda);
        if (!x) { lambda *= 10; continue; }
        const M2 = applyDelta(M, x, opt.maxRot || 0.06, opt.maxTr || 0.6);
        const c2 = evaluate(M2, ctx, P, false);
        if (c2.cost < cur.cost) {
          const gain = (cur.cost - c2.cost) / (cur.cost + 1e-9);
          M = M2; cur = evaluate(M, ctx, P, true); lambda = Math.max(1e-4, lambda * 0.4); ok = true;
          stall = gain < 1e-4 ? stall + 1 : 0;
          break;
        }
        lambda *= 4;
      }
      if (!ok || stall >= 3) break;
      if (opt.yield !== false && it % 3 === 2) await tick();
    }
    return { M, cost: cur.cost, stats: cur };
  }

  /* recozimento: sigma e raio de busca diminuem, penetração pesa cada vez mais */
  const COARSE = [
    { sigma: 2, maxR: 8, wp: 10, iters: 12, maxTr: 1.0, maxRot: 0.06 },
    { sigma: 1, maxR: 5, wp: 15, iters: 12, maxTr: 0.6, maxRot: 0.04 },
    { sigma: 0.5, maxR: 3, wp: 20, iters: 12, maxTr: 0.3, maxRot: 0.02 },
  ];
  const FINE = [
    { sigma: 0.5, maxR: 3, wp: 20, iters: 20, maxTr: 0.25, maxRot: 0.02 },
    { sigma: 0.25, maxR: 2, wp: 30, iters: 25, maxTr: 0.12, maxRot: 0.01 },
  ];
  const SCORE = { sigma: 0.5, maxR: 3, wp: 20 };

  async function anneal(M, ctx, stages, opt = {}) {
    for (const st of stages) {
      const r = await refine(M, ctx, st, st.iters, { maxTr: st.maxTr, maxRot: st.maxRot, cancel: opt.cancel, yield: opt.yield });
      M = r.M;
    }
    return M;
  }

  const SIGNS = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];

  /* Poses iniciais por PCA: 4 giros próprios x 2 sentidos de fechamento (o PCA erra por ~20° em arcos assimétricos; o recozimento corrige) */
  function pcaCandidates(up, lo, raw) {
    const pu = G.pca(up.pos, Math.max(1, Math.floor(up.nv / 20000))), pl = G.pca(lo.pos, Math.max(1, Math.floor(lo.nv / 20000)));
    const out = [];
    for (const S of SIGNS) {
      const R = new Array(9).fill(0);
      for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
        R[r * 3 + c] += S[i] * pu.axes[i][r] * pl.axes[i][c];
      const rotC = [0, 0, 0];
      for (let r = 0; r < 3; r++) rotC[r] = R[r * 3] * pl.c[0] + R[r * 3 + 1] * pl.c[1] + R[r * 3 + 2] * pl.c[2];
      for (const sd of [1, -1]) {
        const s = pu.axes[2].map(v => v * sd);
        const M0 = G.mat4FromRT(R, [pu.c[0] - rotC[0], pu.c[1] - rotC[1], pu.c[2] - rotC[2]]);
        let Eu = -Infinity, minL = Infinity;
        for (let i = 0; i < up.nv; i += 3) {
          const v = up.pos[i * 3] * s[0] + up.pos[i * 3 + 1] * s[1] + up.pos[i * 3 + 2] * s[2];
          if (v > Eu) Eu = v;
        }
        const t = [0, 0, 0];
        for (let i = 0; i < lo.nv; i += 3) {
          G.applyPt(M0, lo.pos[i * 3], lo.pos[i * 3 + 1], lo.pos[i * 3 + 2], t);
          const v = t[0] * s[0] + t[1] * s[1] + t[2] * s[2];
          if (v < minL) minL = v;
        }
        const sh = Eu - 0.5 - minL;
        if (raw) out.push({ M0, s, c: pu.c, Eu });
        else out.push(G.mat4Mul(G.mat4FromRT([1, 0, 0, 0, 1, 0, 0, 0, 1], [s[0] * sh, s[1] * sh, s[2] * sh]), M0));
      }
    }
    return out;
  }

  /* Busca global sem gradiente: para cada pose PCA varia o giro em torno do eixo de fechamento (±30°),
     afasta o lower, fecha até tocar o upper (bisseção) e ranqueia por distância de Chamfer. */
  function globalCandidates(up, lo, keep = 6) {
    const raw = pcaCandidates(up, lo, true), res = { d: 0, tri: 0, qx: 0, qy: 0, qz: 0 };
    const Ls = sampleVerts(lo, 260), Us = sampleVerts(up, 260), nL = Ls.length / 3, nU = Us.length / 3, t = [0, 0, 0];
    const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const Tr = v => G.mat4FromRT(I3, v);
    const minSigned = M => {
      let m = Infinity;
      for (let i = 0; i < nL; i++) {
        G.applyPt(M, Ls[i * 3], Ls[i * 3 + 1], Ls[i * 3 + 2], t);
        if (G.closest(up, t[0], t[1], t[2], 80, res) && res.d < m) m = res.d;
      }
      return m;
    };
    const chamfer = M => {
      let c = 0; const Minv = G.invRigid(M);
      for (let i = 0; i < nL; i++) {
        G.applyPt(M, Ls[i * 3], Ls[i * 3 + 1], Ls[i * 3 + 2], t);
        c += G.closest(up, t[0], t[1], t[2], 6, res) ? Math.min(Math.abs(res.d), 6) ** 2 : 36;
      }
      for (let i = 0; i < nU; i++) {
        G.applyPt(Minv, Us[i * 3], Us[i * 3 + 1], Us[i * 3 + 2], t);
        c += G.closest(lo, t[0], t[1], t[2], 6, res) ? Math.min(Math.abs(res.d), 6) ** 2 : 36;
      }
      return c / (nL + nU);
    };
    const out = [];
    for (const r of raw) {
      for (const yaw of [-30, -15, 0, 15, 30]) {
        const Rz = G.rodrigues(r.s[0] * yaw * Math.PI / 180, r.s[1] * yaw * Math.PI / 180, r.s[2] * yaw * Math.PI / 180);
        const Mr = G.mat4Mul(Tr(r.c), G.mat4Mul(G.mat4FromRT(Rz, [0, 0, 0]), G.mat4Mul(Tr([-r.c[0], -r.c[1], -r.c[2]]), r.M0)));
        let minL = Infinity;
        for (let i = 0; i < lo.nv; i += 3) {
          G.applyPt(Mr, lo.pos[i * 3], lo.pos[i * 3 + 1], lo.pos[i * 3 + 2], t);
          const v = t[0] * r.s[0] + t[1] * r.s[1] + t[2] * r.s[2];
          if (v < minL) minL = v;
        }
        const at = h => G.mat4Mul(Tr([r.s[0] * (r.Eu + 2 - minL - h), r.s[1] * (r.Eu + 2 - minL - h), r.s[2] * (r.Eu + 2 - minL - h)]), Mr);
        let a = 0, b = 60;
        for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (minSigned(at(m)) < -0.2) b = m; else a = m; }
        const M = at(a + 0.2);
        out.push({ M, cost: chamfer(M) });
      }
    }
    out.sort((x, y) => x.cost - y.cost);
    return distinct(out, keep, 2, 6).map(o => o.M);
  }

  /* Vizinhança da pose atual: os arquivos costumam sair do scanner já perto da mordida; perturbações pequenas cobrem erros de poucos mm/graus */
  function localCandidates(M, center) {
    const out = [], Rm = (ax, deg) => { const w = [0, 0, 0]; w[ax] = deg * Math.PI / 180; return G.mat4FromRT(G.rodrigues(w[0], w[1], w[2]), [0, 0, 0]); };
    const T = (ax, mm) => { const t = [0, 0, 0]; t[ax] = mm; return G.mat4FromRT([1, 0, 0, 0, 1, 0, 0, 0, 1], t); };
    const c = center || [0, 0, 0], toC = G.mat4FromRT([1, 0, 0, 0, 1, 0, 0, 0, 1], c), fromC = G.mat4FromRT([1, 0, 0, 0, 1, 0, 0, 0, 1], [-c[0], -c[1], -c[2]]);
    for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
      out.push(G.mat4Mul(T(ax, s * 3), M));
      out.push(G.mat4Mul(toC, G.mat4Mul(Rm(ax, s * 6), G.mat4Mul(fromC, M))));
    }
    return out;
  }

  function poseDiff(A, B) { // distância entre poses: translação (mm) e ângulo (graus) de A^-1 B
    const E = G.mat4Mul(G.invRigid(A), B);
    const t = Math.hypot(E[12], E[13], E[14]), a = Math.acos(Math.max(-1, Math.min(1, (E[0] + E[5] + E[10] - 1) / 2))) * 180 / Math.PI;
    return { t, a };
  }

  function distinct(list, max, tT = 1.5, tA = 3) {
    const picks = [];
    for (const c of list) {
      if (picks.every(p => { const d = poseDiff(p.M, c.M); return d.t > tT || d.a > tA; })) picks.push(c);
      if (picks.length >= max) break;
    }
    return picks;
  }

  /* busca em 4 etapas: (1) triagem rápida de ~21 poses iniciais, (2) recozimento das melhores,
     (3) "saltos" em torno da melhor (cobre erros de PCA de ~15°), (4) refinamento fino dos 3 melhores */
  async function autoOcclusion(up, lo, opt = {}) {
    const rep = opt.onProgress || (() => { }), cancel = opt.cancel;
    const check = () => { if (cancel && cancel()) throw new Error("cancelado"); };
    const start = opt.start || G.mat4Identity();
    const ctxS = { up, lo, Ls: sampleVerts(lo, 450), Us: sampleVerts(up, 450) };
    const ctxF = { up, lo, Ls: sampleVerts(lo, 3500), Us: sampleVerts(up, 3500) };
    const ctxK = { up, lo, Ls: sampleVerts(lo, 6000), Us: sampleVerts(up, 6000) };
    const score = M => evaluate(M, ctxS, SCORE, false).cost;

    const pool = [start, ...localCandidates(start, opt.center), ...globalCandidates(up, lo, 6)];
    let cur = [];
    for (let i = 0; i < pool.length; i++) {
      check(); rep(`Triagem ${i + 1} de ${pool.length}`, 0.02 + 0.2 * i / pool.length);
      const M = await anneal(pool[i], ctxS, COARSE.slice(0, 1), { cancel, yield: true });
      cur.push({ M, cost: score(M) });
      await tick();
    }
    cur.sort((a, b) => a.cost - b.cost);
    cur = distinct(cur, 8, 1.0, 2);
    for (let i = 0; i < cur.length; i++) {
      check(); rep(`Recozimento ${i + 1} de ${cur.length}`, 0.22 + 0.2 * i / cur.length);
      cur[i].M = await anneal(cur[i].M, ctxS, COARSE.slice(1), { cancel, yield: true });
      cur[i].cost = score(cur[i].M);
    }
    cur.sort((a, b) => a.cost - b.cost);

    for (let round = 0; round < 2; round++) {
      const hops = localCandidates(cur[0].M, opt.center);
      for (let i = 0; i < hops.length; i++) {
        check(); rep(`Salto ${round + 1}: ${i + 1} de ${hops.length}`, 0.42 + 0.3 * (round * hops.length + i) / (2 * hops.length));
        const M = await anneal(hops[i], ctxS, COARSE, { cancel, yield: true });
        cur.push({ M, cost: score(M) });
        await tick();
      }
      cur.sort((a, b) => a.cost - b.cost);
      cur = distinct(cur, 6, 1.0, 2);
    }

    const picks = distinct(cur, 3, 1.5, 3), finals = [];
    for (let i = 0; i < picks.length; i++) {
      check(); rep(`Refinando encaixe ${i + 1} de ${picks.length}`, 0.74 + 0.25 * i / picks.length);
      const M = await anneal(picks[i].M, ctxF, FINE, { cancel, yield: true });
      const st = evaluate(M, ctxK, SCORE, false);
      finals.push({ M, cost: st.cost, stats: st });
    }
    finals.sort((a, b) => a.cost - b.cost);
    rep("Concluído", 1);
    const best = finals[0];
    return { M: best.M, cost: best.cost, stats: best.stats, alternatives: finals };
  }

  function vertexDistances(src, M, dst, maxR, from, to, out) {
    const res = { d: 0 }, t = [0, 0, 0];
    for (let i = from; i < to; i++) {
      G.applyPt(M, src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2], t);
      out[i] = G.closest(dst, t[0], t[1], t[2], maxR, res) ? res.d : NaN;
    }
  }

  return { vertexDistances, globalCandidates, evaluate, refine, anneal, pcaCandidates, localCandidates, autoOcclusion, poseDiff, sampleVerts, SCORE };
})();
if (typeof module !== "undefined") module.exports = OPT;
