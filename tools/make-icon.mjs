// Génère l'icône de l'application, sans dépendance : carré arrondi terracotta + étoile blanche (identité Claude Desktop).
// Sorties : apps/desktop/build/icon.png (512) et apps/desktop/build/icon.ico (16 à 256, entrées PNG).
import { deflateSync } from "node:zlib"; import { writeFileSync } from "node:fs";
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let r = 0xffffffff; for (const x of b) r = crcT[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const distSeg = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Rendu natif à la taille N (anti-crénelage par distance au pixel). */
function render(N) {
  const s = N / 512, px = Buffer.alloc(N * N * 4), c = N / 2;
  const margin = 24 * s, rad = 112 * s, half = N / 2 - margin;
  const R = 150 * s, w = 21 * s; // rayon des branches et demi-épaisseur
  const spokes = [90, 150, 210].map((deg) => { const a = (deg * Math.PI) / 180; return [c + R * Math.cos(a), c + R * Math.sin(a), c - R * Math.cos(a), c - R * Math.sin(a)]; });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4, X = x + 0.5, Y = y + 0.5;
    const qx = Math.abs(X - c) - (half - rad), qy = Math.abs(Y - c) - (half - rad);
    const dBg = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
    const aBg = clamp01(0.5 - dBg); if (aBg <= 0) continue;
    const g = Y / N; let r = 224 - 38 * g, gr = 134 - 47 * g, b = 95 - 37 * g; // dégradé #e0865f -> #b9573a
    let dS = 1e9; for (const [ax, ay, bx, by] of spokes) dS = Math.min(dS, distSeg(X, Y, ax, ay, bx, by) - w);
    const aS = clamp01(0.5 - dS); r += (255 - r) * aS; gr += (250 - gr) * aS; b += (245 - b) * aS;
    px[o] = r; px[o + 1] = gr; px[o + 2] = b; px[o + 3] = Math.round(aBg * 255);
  }
  return px;
}
function png(N) {
  const px = render(N), raw = Buffer.alloc((N * 4 + 1) * N); for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync("apps/desktop/build/icon.png", png(512));
const sizes = [16, 24, 32, 48, 64, 128, 256], imgs = sizes.map(png);
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = 6 + 16 * sizes.length; const dir = sizes.map((n, i) => { const e = Buffer.alloc(16); e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length; return e; });
writeFileSync("apps/desktop/build/icon.ico", Buffer.concat([head, ...dir, ...imgs])); console.log("icônes générées (png 512 + ico", sizes.join("/") + ")");
