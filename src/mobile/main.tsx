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
// The on-screen keyboard: iOS keeps the layout viewport at full height and shrinks + scrolls the
// VISUAL viewport instead. Everything that must stay on screen (top bar, composer, the globe's
// canvas) is sized to the visual viewport height and shifted by its offset, so the composer rides
// above the keyboard and nothing is drawn under it.
const measure = () => {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty("--app-h", `${Math.round(vv?.height || window.innerHeight)}px`);
  document.documentElement.style.setProperty("--vv-top", `${Math.round(vv?.offsetTop || 0)}px`);
  document.documentElement.classList.toggle("kbd", !!vv && vv.height < window.innerHeight * 0.75);
};
measure(); window.addEventListener("resize", measure); window.visualViewport?.addEventListener("resize", measure); window.visualViewport?.addEventListener("scroll", measure); document.addEventListener("visibilitychange", measure);

// `?lab=1` keeps the batch-1 measurement page (fps, particle count, bloom, form buttons).
const lab = new URLSearchParams(location.search).get("lab") === "1";
createRoot(document.getElementById("app-root")!).render(<StrictMode>{lab ? <Batch1 /> : <MobileApp />}</StrictMode>);
