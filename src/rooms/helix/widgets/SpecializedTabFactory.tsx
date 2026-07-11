// src/rooms/helix/widgets/SpecializedTabFactory.tsx
// Wave 2-A-1: Factory + ErrorBoundary for all specialized tab renderers.
// R7: GenericTabRenderer is the only catch-all — specific renderers never add one.
// R9: Max 2 specialized tabs per entry; enforced by caller in FocusOverlay.

import React from "react";
import type { AnyTabData } from "./types";
import { MarketTabRenderer } from "./MarketTabRenderer";
import { CodeTabRenderer } from "./CodeTabRenderer";
import { DataTabRenderer } from "./DataTabRenderer";
import { DecisionTabRenderer } from "./DecisionTabRenderer";
import { ComparisonTabRenderer } from "./ComparisonTabRenderer";
import { DesignTabRenderer } from "./DesignTabRenderer";
import { PeopleTabRenderer } from "./PeopleTabRenderer";
import { MediaTabRenderer } from "./MediaTabRenderer";
import { GenericTabRenderer } from "./GenericTabRenderer";

interface TabEBState { err: string | null }

class TabErrorBoundary extends React.Component<{ children: React.ReactNode }, TabEBState> {
  state: TabEBState = { err: null };
  static getDerivedStateFromError(e: Error): TabEBState { return { err: e.message }; }
  componentDidCatch() { /* swallow */ }
  render() {
    if (this.state.err) {
      return <div className="hxw-error">Tab unavailable</div>;
    }
    return this.props.children;
  }
}

function renderTab(tabType: string, tabData: AnyTabData | null): React.ReactElement {
  if (!tabData) return <GenericTabRenderer data={null} />;
  switch (tabType) {
    case "market":     return <MarketTabRenderer data={tabData as never} />;
    case "code":       return <CodeTabRenderer data={tabData as never} />;
    case "data":       return <DataTabRenderer data={tabData as never} />;
    case "decision":   return <DecisionTabRenderer data={tabData as never} />;
    case "comparison": return <ComparisonTabRenderer data={tabData as never} />;
    case "design":     return <DesignTabRenderer data={tabData as never} />;
    case "people":     return <PeopleTabRenderer data={tabData as never} />;
    case "media":      return <MediaTabRenderer data={tabData as never} />;
    default:           return <GenericTabRenderer data={tabData as never} />;
  }
}

interface Props {
  tabType: string;
  tabData: AnyTabData | null;
}

export function SpecializedTabFactory({ tabType, tabData }: Props) {
  return (
    <TabErrorBoundary>
      <div className="hxw-renderer">
        {renderTab(tabType, tabData)}
      </div>
    </TabErrorBoundary>
  );
}
