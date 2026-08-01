// Skeleton / empty / error triad (docs/ux/02 §4). One component every surface uses so a
// failed load can never look identical to "empty", and empties stay honest. Wrap the data
// body: <SurfaceState loading error empty ...>{realContent}</SurfaceState>.
import React from "react";
import { Ico } from "./hxIcons";

export function SurfaceSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="hxv-skel-wrap" aria-busy="true" aria-label="Loading">
      <div className="hxv-skel hxv-skel-title" />
      <div className="hxv-skel-grid">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="hxv-skel hxv-skel-row" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function SurfaceState({
  loading, error, empty, emptyTitle, emptyMsg, emptyCta, onEmptyCta, onRetry, skeleton, children,
}: {
  loading?: boolean; error?: string | null; empty?: boolean;
  emptyTitle?: string; emptyMsg?: string; emptyCta?: string; onEmptyCta?: () => void;
  onRetry?: () => void; skeleton?: React.ReactNode; children: React.ReactNode;
}) {
  if (loading) return <>{skeleton ?? <SurfaceSkeleton />}</>;
  if (error) {
    return (
      <div className="hxv-sstate">
        <span className="hxv-sstate-ic bad"><Ico.x /></span>
        <div className="hxv-sstate-t">Couldn't load this</div>
        <div className="hxv-sstate-s">{error}</div>
        {onRetry && <button className="hxv-btn" onClick={onRetry} style={{ marginTop: 10 }}>Retry</button>}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="hxv-sstate">
        <span className="hxv-sstate-ic"><Ico.layers /></span>
        <div className="hxv-sstate-t">{emptyTitle || "Nothing here yet"}</div>
        <div className="hxv-sstate-s">{emptyMsg || "This is empty for now."}</div>
        {emptyCta && onEmptyCta && <button className="hxv-btn solid" onClick={onEmptyCta} style={{ marginTop: 10 }}>{emptyCta}</button>}
      </div>
    );
  }
  return <>{children}</>;
}
