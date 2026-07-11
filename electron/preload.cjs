const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  platform: process.platform,
  version: process.versions.electron,
  mode: "desktop",
});
