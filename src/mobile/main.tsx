import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./App";
import { Batch1 } from "./Batch1";
import "./mobile.css";

// v1 registered a service worker that cached the old shell. Remove it and its caches so a phone
// that opened the old page never sees it again.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
}
// Cold-start PWAs report a wrong viewport height until the first resize; keep the real one in --app-h.
const measure = () => document.documentElement.style.setProperty("--app-h", `${Math.round(window.visualViewport?.height || window.innerHeight)}px`);
measure(); window.addEventListener("resize", measure); window.visualViewport?.addEventListener("resize", measure); document.addEventListener("visibilitychange", measure);

// `?lab=1` keeps the batch-1 measurement page (fps, particle count, bloom, form buttons).
const lab = new URLSearchParams(location.search).get("lab") === "1";
createRoot(document.getElementById("app-root")!).render(<StrictMode>{lab ? <Batch1 /> : <MobileApp />}</StrictMode>);
