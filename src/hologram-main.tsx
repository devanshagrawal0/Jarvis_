import React from "react";
import ReactDOM from "react-dom/client";
import { HologramGlobeDemo } from "./pages/HologramGlobeDemo";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <HologramGlobeDemo />
  </React.StrictMode>
);
