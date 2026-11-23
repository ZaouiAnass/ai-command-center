import { api } from "../api"; import { toast } from "../overlay";
import type { Img } from "./Composer";

const MAX_EDGE = 1920; const MAX_BYTES = 4_500_000; // limite du cœur : 5 Mo par image
const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** Réduit une image (côté le plus long ≤ 1920 px) : une capture 4K brute coûterait beaucoup de tokens pour aucun gain de lisibilité. PNG si léger, sinon JPEG. */
export async function fileToImg(file: Blob, name: string): Promise<Img> {
  const bmp = await createImageBitmap(file); const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height)); const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d")!; ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
  const toB64 = async (type: string, q?: number) => { const b: Blob = await new Promise((res, rej) => cv.toBlob((x) => (x ? res(x) : rej(new Error("Encodage impossible"))), type, q)); const buf = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return { data: btoa(s), size: buf.length }; };
  let png = await toB64("image/png"); if (png.size <= MAX_BYTES) return { name: `${name}.png`, mime: "image/png", data: png.data };
  for (const q of [0.88, 0.75, 0.6]) { const j = await toB64("image/jpeg", q); if (j.size <= MAX_BYTES) return { name: `${name}.jpg`, mime: "image/jpeg", data: j.data }; }
  throw new Error("Image trop volumineuse même après réduction.");
}

/** Images collées (Ctrl+V) et capture d'écran : ajoutées aux images du message (4 maximum). */
export function useImageInput(setImgs: (f: (a: Img[]) => Img[]) => void) {
  const add = (imgs: Img[]) => setImgs((a) => [...a, ...imgs].slice(0, 4));
  const paste = async (files: File[]) => { try { add(await Promise.all(files.map((f, i) => fileToImg(f, `collage-${stamp()}${files.length > 1 ? "-" + (i + 1) : ""}`)))); toast("Image collée.", "success"); } catch (e: any) { toast(String(e.message), "error"); } };
  const capture = async () => { try { const r = await api("screen.capture"); if (r) { const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)); add([await fileToImg(new Blob([bin], { type: r.mime }), `capture-${stamp()}`)]); toast("Capture d'écran ajoutée.", "success"); } } catch (e: any) { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"); } };
  return { paste, capture };
}
