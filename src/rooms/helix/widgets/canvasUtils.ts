// src/rooms/helix/widgets/canvasUtils.ts
// Shared HiDPI canvas setup utility — prevents blurry canvas on Retina/HiDPI screens.

export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number
): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}
