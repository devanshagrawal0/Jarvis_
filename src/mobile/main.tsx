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

// TEMP DIAGNOSTIC — a magenta bar pinned to the true page bottom + the phone's real numbers.
// If there is BLACK below the magenta bar, the web view is shorter than the screen (the bug).
// Remove after we read the values.
(() => {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;bottom:0;left:0;height:env(safe-area-inset-bottom,0px);width:1px;";
  document.body.appendChild(probe);
  const sab = probe.getBoundingClientRect().height;
  const topProbe = document.createElement("div");
  topProbe.style.cssText = "position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);width:1px;";
  document.body.appendChild(topProbe);
  const sat = topProbe.getBoundingClientRect().height;
  const bar = document.createElement("div");
  const standalone = (navigator as any).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  bar.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#ff00aa;color:#000;" +
    "font:600 11px/1.35 ui-monospace,monospace;padding:5px 8px calc(5px + env(safe-area-inset-bottom,0px));text-align:center;";
  const upd = () => {
    const vv = window.visualViewport;
    bar.textContent =
      `standalone=${standalone} · screen=${screen.width}x${screen.height} · inner=${window.innerWidth}x${window.innerHeight}` +
      ` · vv=${Math.round(vv?.width || 0)}x${Math.round(vv?.height || 0)} · dpr=${window.devicePixelRatio} · safeTop=${Math.round(sat)} safeBot=${Math.round(sab)}`;
  };
  upd(); window.addEventListener("resize", upd); window.visualViewport?.addEventListener("resize", upd);
  document.body.appendChild(bar);
})();
