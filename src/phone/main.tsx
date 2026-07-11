import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PhoneApp from "./PhoneApp";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw-phone.js", { scope: "/" })
      .catch(() => {});
  });
}

const root = document.getElementById("phone-root")!;
createRoot(root).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>
);
