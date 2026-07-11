import type { ScreenRects } from "./JarvisBackground";

interface Props {
  rects: ScreenRects;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function ScreenPanels({ rects, leftContent, rightContent }: Props) {
  const panelStyle = (rect: DOMRect): React.CSSProperties => ({
    position: "absolute",
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    overflow: "hidden",
    zIndex: 10,
    boxSizing: "border-box",
  });

  return (
    <>
      {rects.left && (
        <div style={panelStyle(rects.left)} className="screen-panel screen-panel--left">
          {leftContent ?? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(74,158,255,0.4)", fontSize: 12, fontFamily: "monospace", letterSpacing: 2 }}>LEFT SCREEN</div>}
        </div>
      )}
      {rects.right && (
        <div style={panelStyle(rects.right)} className="screen-panel screen-panel--right">
          {rightContent ?? <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(74,158,255,0.4)", fontSize: 12, fontFamily: "monospace", letterSpacing: 2 }}>RIGHT SCREEN</div>}
        </div>
      )}
    </>
  );
}
