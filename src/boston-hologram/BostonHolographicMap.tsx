import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bostonDataUrl } from "./tokens";

export function BostonHolographicMap() {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      attributionControl: false,
      interactive: true,
      canvasContextAttributes: { antialias: true },
      center: [-71.0875, 42.3376],
      zoom: 14.82,
      pitch: 61,
      bearing: -20,
      maxPitch: 74,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "void",
            type: "background",
            paint: { "background-color": "#00070f" },
          },
        ],
      },
    });

    mapRef.current = map;

    map.on("load", () => {
      map.addSource("boston-buildings", {
        type: "geojson",
        data: bostonDataUrl,
      });

      map.addLayer({
        id: "holo-building-fill",
        type: "fill-extrusion",
        source: "boston-buildings",
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["to-number", ["get", "height"]], 10],
            0,
            "#031425",
            18,
            "#06365f",
            52,
            "#0878c9",
            120,
            "#17c8ff",
          ],
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["coalesce", ["to-number", ["get", "height"]], 10],
            0,
            4,
            24,
            42,
            80,
            126,
            180,
            250,
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.18,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      map.addLayer({
        id: "holo-building-edges",
        type: "line",
        source: "boston-buildings",
        paint: {
          "line-color": "#27d8ff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.18, 16, 0.72],
          "line-opacity": 0.18,
          "line-blur": 0.05,
        },
      });

      document.documentElement.dataset.bostonBuildingsReady = "true";
    });

    map.on("error", (event) => {
      console.warn("Boston hologram map error", event.error);
      document.documentElement.dataset.bostonBuildingsReady = "error";
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <main className="boston-holo-stage">
      <div ref={containerRef} className="boston-maplibre-canvas" />
      <div className="boston-holo-map-vfx" aria-hidden="true">
        <div className="boston-holo-roadnet">
          {Array.from({ length: 18 }, (_, index) => <span key={index} />)}
        </div>
        <div className="boston-holo-beacon" />
        <div className="boston-holo-ring boston-holo-ring-one" />
        <div className="boston-holo-ring boston-holo-ring-two" />
        <div className="boston-holo-stadium" />
        <span className="boston-map-pin boston-map-pin-bu">BOSTON UNIVERSITY</span>
        <span className="boston-map-pin boston-map-pin-fenway">FENWAY PARK</span>
        <span className="boston-map-pin boston-map-pin-nu">NORTHEASTERN</span>
        <span className="boston-map-pin boston-map-pin-downtown">DOWNTOWN</span>
        <span className="boston-map-pin boston-map-pin-backbay">BACK BAY</span>
        <span className="boston-map-pin boston-map-pin-southend">SOUTH END</span>
        <span className="boston-holo-address">744 Columbus Ave<br />Boston, MA 02120</span>
      </div>
    </main>
  );
}
