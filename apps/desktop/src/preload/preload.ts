import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("acc", {
  call: (method: string, ...args: unknown[]) => ipcRenderer.invoke("acc:call", method, args),
  onTerminal: (cb: (e: unknown) => void) => { const h = (_: unknown, e: unknown) => cb(e); ipcRenderer.on("acc:term", h); return () => ipcRenderer.removeListener("acc:term", h); },
  onEvent: (cb: (e: unknown) => void) => { const h = (_: unknown, e: unknown) => cb(e); ipcRenderer.on("acc:event", h); return () => ipcRenderer.removeListener("acc:event", h); },
});
