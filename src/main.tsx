import React from "react";
import ReactDOM from "react-dom/client";
import { JarvisUI } from "./JarvisUI";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <JarvisUI />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
  caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
}
