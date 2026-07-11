import React from "react";
import ReactDOM from "react-dom/client";
import { BostonHolographicMap } from "./BostonHolographicMap";
import "./boston-map.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BostonHolographicMap />
  </React.StrictMode>
);
