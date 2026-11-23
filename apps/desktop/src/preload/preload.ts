import { contextBridge, ipcRenderer, webUtils } from "electron";
// Glisser-déposer : seuls les dépôts réels de l'utilisateur (isTrusted) enregistrent un chemin ; le code de la page ne peut pas en fabriquer.
window.addEventListener("drop", (e) => { if (!e.isTrusted) return; for (const f of Array.from(e.dataTransfer?.files ?? [])) { try { const p = webUtils.getPathForFile(f); if (p) ipcRenderer.send("acc:approve", p); } catch { /* fichier sans chemin */ } } }, true);
contextBridge.exposeInMainWorld("acc", {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke("acc:call", method, args),
  pathForFile: (f: File) => { try { return webUtils.getPathForFile(f); } catch { return ""; } },
  onTerminal: (cb: (e: unknown) => void) => { const h = (_: unknown, e: unknown) => cb(e); ipcRenderer.on("acc:term", h); return () => ipcRenderer.removeListener("acc:term", h); },
  onEvent: (cb: (e: unknown) => void) => { const h = (_: unknown, e: unknown) => cb(e); ipcRenderer.on("acc:event", h); return () => ipcRenderer.removeListener("acc:event", h); },
});
