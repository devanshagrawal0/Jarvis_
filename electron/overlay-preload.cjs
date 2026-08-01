const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisOverlay", {
  onState(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop-takeover-state", listener);
    return () => ipcRenderer.removeListener("desktop-takeover-state", listener);
  },
});
