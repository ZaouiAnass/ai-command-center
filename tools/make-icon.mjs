// Génère l'icône 512x512 (carré arrondi violet + invite de commande >_) en PNG, sans dépendance.
import { deflateSync } from "node:zlib"; import { writeFileSync } from "node:fs";
const N = 512, px = Buffer.alloc(N * N * 4);
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let r = 0xffffffff; for (const x of b) r = crcT[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const distSeg = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)); };
const rr = (x, y, r) => { const cx = Math.abs(x - N / 2) - (N / 2 - 24 - r), cy = Math.abs(y - N / 2) - (N / 2 - 24 - r); return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - r; };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const o = (y * N + x) * 4; const d = rr(x + .5, y + .5, 104); const a = Math.max(0, Math.min(1, .5 - d)); if (a <= 0) continue;
  const g = y / N; let r = 167 - 30 * g, gr = 139 - 30 * g, b = 250 - 20 * g; // dégradé discret
  const w = 26; const s1 = distSeg(x, y, 150, 170, 260, 256) - w, s2 = distSeg(x, y, 260, 256, 150, 342) - w, s3 = distSeg(x, y, 290, 342, 372, 342) - w; const m = Math.min(s1, s2, s3); const k = Math.max(0, Math.min(1, .5 - m));
  r = r * (1 - k) + 20 * k; gr = gr * (1 - k) + 16 * k; b = b * (1 - k) + 31 * k; px[o] = r; px[o + 1] = gr; px[o + 2] = b; px[o + 3] = Math.round(a * 255);
}
const raw = Buffer.alloc((N * 4 + 1) * N); for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 6;
writeFileSync("apps/desktop/build/icon.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])); console.log("icône générée");
