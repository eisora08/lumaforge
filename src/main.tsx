import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./App.css";

import { ThemeProvider } from "./context/ThemeContext";
import { SettingsProvider } from "./context/SettingsContext";
import { DownloadQueueProvider } from "./context/DownloadQueueContext";

if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <DownloadQueueProvider>
          <App />
        </DownloadQueueProvider>
      </SettingsProvider>
    </ThemeProvider>
  </React.StrictMode>
);