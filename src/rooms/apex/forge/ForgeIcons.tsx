/* THE FORGE — icon set. Thin-stroke, monochrome (currentColor), geometric line
   icons that match the ice/platinum HUD — no emoji. 16×16 grid, 1.4 stroke. */

import type { ReactElement } from "react";

const P: Record<string, ReactElement> = {
  // diagnose / scan reticle
  scan: <><circle cx="8" cy="8" r="4.5" /><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /></>,
  // regimes — segmented timeline bands
  regime: <><path d="M2 5h4M6 5h5M11 5h3" strokeWidth="2" /><path d="M2 8.5h6M8 8.5h3M11 8.5h3" strokeWidth="2" opacity="0.6" /><path d="M2 12h3M5 12h7M12 12h2" strokeWidth="2" opacity="0.85" /></>,
  // sentinel — shield
  shield: <path d="M8 1.6l5.2 2v3.9c0 3-2.1 5.2-5.2 6.3-3.1-1.1-5.2-3.3-5.2-6.3V3.6L8 1.6z" />,
  // darwin — double helix
  darwin: <><path d="M5 2c4.5 2.7 4.5 9.3 0 12M11 2c-4.5 2.7-4.5 9.3 0 12" /><path d="M5.4 5h5.2M4.8 8h6.4M5.4 11h5.2" opacity="0.7" /></>,
  // terraform — perspective grid
  terra: <><path d="M8 2l6 4.5-6 4.5-6-4.5z" /><path d="M2 6.5v3.5l6 4 6-4V6.5" opacity="0.55" /><path d="M8 2v9M4 4.9L11.5 9.4M12 4.9L4.5 9.4" opacity="0.4" /></>,
  // meta — funnel / filter
  funnel: <path d="M2 3h12l-4.4 5.2v4.4l-3.2-1.8V8.2L2 3z" />,
  // prospector — radar
  radar: <><circle cx="8" cy="8" r="5.2" /><circle cx="8" cy="8" r="2.6" opacity="0.6" /><path d="M8 8l4-3" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /></>,
  // genesis — compass star
  spark: <path d="M8 1.5l1.4 5.1 5.1 1.4-5.1 1.4L8 14.5l-1.4-5.1L1.5 8l5.1-1.4z" />,
  // oracle / predict — eye
  eye: <><path d="M1.2 8S4 3.4 8 3.4 14.8 8 14.8 8 12 12.6 8 12.6 1.2 8 1.2 8z" /><circle cx="8" cy="8" r="2.1" /></>,
  // analyze — waveform pulse
  pulse: <path d="M1 8h2.6l1.8-4.2 3 8.4 1.8-5 1 1.3H15" />,
  // improve — up trend
  trend: <><path d="M2 11.5l3.8-3.8 2.6 1.8L14 3.5" /><path d="M10.5 3.5H14v3.5" /></>,
  // portfolio — stacked layers
  layers: <><path d="M8 2l6 3-6 3-6-3z" /><path d="M2 8l6 3 6-3" opacity="0.6" /><path d="M2 11l6 3 6-3" opacity="0.4" /></>,
  // new — plus
  plus: <path d="M8 3v10M3 8h10" />,
  // variable — fx
  fx: <><path d="M4 13c0-6 1-9 3-9M2.5 7.5h4" /><path d="M9 6l4 6M13 6l-4 6" opacity="0.8" /></>,
  // signal — broadcast node
  signal: <><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /><path d="M4.5 4.5a5 5 0 000 7M11.5 4.5a5 5 0 010 7M2.2 2.2a8 8 0 000 11.6M13.8 2.2a8 8 0 010 11.6" opacity="0.55" /></>,
  // adversary — alert triangle
  alert: <><path d="M8 2l6.2 11H1.8z" /><path d="M8 6.5v3.5" /><circle cx="8" cy="11.6" r="0.5" fill="currentColor" stroke="none" /></>,
  // run — play
  run: <path d="M4.5 2.8l8.5 5.2-8.5 5.2z" fill="currentColor" stroke="none" />,
  // save — floppy disk
  save: <><path d="M2.5 2.5h8.5l2.5 2.5v8.5h-11z" /><path d="M5 2.5v3.5h5V2.5M5 13.5v-4h6v4" /></>,
  // saved — check
  check: <path d="M3 8.5l3.2 3.2L13 5" />,
  // portfolio compose — grid
  compose: <><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" opacity="0.7" /><rect x="2" y="9" width="5" height="5" rx="1" opacity="0.7" /><rect x="9" y="9" width="5" height="5" rx="1" opacity="0.5" /></>,
};

export function Icon({ n, size = 13 }: { n: string; size?: number }) {
  return (
    <svg className="fg-ic" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[n] || P.scan}
    </svg>
  );
}
