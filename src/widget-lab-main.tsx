import React from "react";
import ReactDOM from "react-dom/client";
import WidgetLab from "./globe-room/WidgetLab";
import "./widget-lab.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WidgetLab />
  </React.StrictMode>
);
