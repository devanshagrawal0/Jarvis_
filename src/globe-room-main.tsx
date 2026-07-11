import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/200.css";
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import { GlobeRoomApp } from "./globe-room/GlobeRoomApp";

// Some embedded browsers never deliver ResizeObserver callbacks, which stalls
// @react-three/fiber's canvas sizing forever. Wrap the native observer so
// observe() also reports an initial rect on the next frame (native behaviour
// already does this in real browsers — the duplicate initial entry is benign).
const NativeResizeObserver = window.ResizeObserver;
if (NativeResizeObserver) {
  type ROCallback = ConstructorParameters<typeof ResizeObserver>[0];
  class PatchedResizeObserver extends NativeResizeObserver {
    private cb: ROCallback;
    constructor(cb: ROCallback) {
      super(cb);
      this.cb = cb;
    }
    observe(target: Element, options?: ResizeObserverOptions) {
      super.observe(target, options);
      requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        this.cb(
          [{
            target,
            contentRect: rect,
            borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
            contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
            devicePixelContentBoxSize: [{
              inlineSize: rect.width * devicePixelRatio,
              blockSize: rect.height * devicePixelRatio
            }]
          } as unknown as ResizeObserverEntry],
          this
        );
      });
    }
  }
  window.ResizeObserver = PatchedResizeObserver;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <GlobeRoomApp />
  </React.StrictMode>
);
