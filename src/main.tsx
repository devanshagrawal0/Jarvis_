import React from "react";
import ReactDOM from "react-dom/client";
import { JarvisUI } from "./JarvisUI";
import { HelixV2 } from "./rooms/helix/v2/HelixV2";

// Dev-only standalone HELIX v2 route (?helixv2) — renders the room alone with no
// WebGL background, so the build can be screenshot-verified against the reference.
const isHelixV2 = typeof window !== "undefined" && window.location.search.includes("helixv2");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isHelixV2 ? <HelixV2 onExit={() => { window.location.search = ""; }} /> : <JarvisUI />}
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}
