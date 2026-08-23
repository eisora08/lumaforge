import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./App.css";
import "./i18n";

import { ThemeProvider } from "./context/ThemeContext";
import { SettingsProvider } from "./context/SettingsContext";
import { DownloadQueueProvider } from "./context/DownloadQueueContext";
import { FavoritesProvider } from "./context/FavoritesContext";

if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5" || (e.ctrlKey && e.key === "r")) {
      e.preventDefault();
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <DownloadQueueProvider>
          <FavoritesProvider>
            <App />
          </FavoritesProvider>
        </DownloadQueueProvider>
      </SettingsProvider>
    </ThemeProvider>
  </React.StrictMode>
);