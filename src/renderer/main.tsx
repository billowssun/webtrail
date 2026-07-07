import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installDemoDashboardApi } from "./demoApi";
import "./styles.css";

if (import.meta.env.DEV && !window.dashboardApi) {
  installDemoDashboardApi();
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
