import { useEffect, useMemo, useState } from "react";
import { bostonDataUrl } from "../tokens";
import type { BuildingFeature } from "../types";
import { normalizeBuildings } from "../utils/geo";

export function useBostonBuildings() {
  const [features, setFeatures] = useState<BuildingFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(bostonDataUrl)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setFeatures(data.features || []);
          document.documentElement.dataset.bostonBuildingsReady = "true";
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFeatures([]);
          document.documentElement.dataset.bostonBuildingsReady = "error";
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => normalizeBuildings(features), [features]);
}
