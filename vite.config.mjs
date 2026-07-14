import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // three/R3F must resolve to a single instance across all entries,
    // otherwise R3F hooks lose the Canvas context ("Hooks can only be
    // used within the Canvas component").
    dedupe: ["three", "@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "postprocessing"]
  },
  server: {
    proxy: {
      // ws:true forwards WebSocket upgrades in dev — needed for /mesh/coop/ws (Synapse live
      // channel), /mesh/ws (device mesh) and /api/kalshi/ws. In production the backend serves
      // these directly, so this only matters for the Vite dev server.
      "/api": { target: "http://localhost:8799", ws: true },
      "/assets": "http://localhost:8799",
      "/mesh": { target: "http://localhost:8799", ws: true },
      "/phone": "http://localhost:8799",
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve("index.html"),
        phone: path.resolve("phone.html"),
        widgetLab: path.resolve("widget-lab.html"),
        globe: path.resolve("globe.html"),
        globeRoom: path.resolve("globe-room.html")
      }
    }
  }
});
