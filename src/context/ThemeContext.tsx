import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { SurfaceMode, ThemeId } from "../types/theme";
import { themeVariables } from "../theme/themes";

type ThemeContextValue = {
  theme: ThemeId;
  surfaceMode: SurfaceMode;
  setTheme: (theme: ThemeId) => void;
  setSurfaceMode: (mode: SurfaceMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = "lumaforge-theme";
const SURFACE_STORAGE_KEY = "lumaforge-surface-mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    return savedTheme || "midnight-blue";
  });

  const [surfaceMode, setSurfaceModeState] = useState<SurfaceMode>(() => {
    const savedMode = localStorage.getItem(SURFACE_STORAGE_KEY) as SurfaceMode | null;
    return savedMode || "solid";
  });

  function setTheme(nextTheme: ThemeId) {
    setThemeState(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  function setSurfaceMode(nextMode: SurfaceMode) {
    setSurfaceModeState(nextMode);
    localStorage.setItem(SURFACE_STORAGE_KEY, nextMode);
  }

  useEffect(() => {
    const variables = themeVariables[theme];
    const root = document.documentElement;

    Object.entries(variables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.surface = surfaceMode;
  }, [surfaceMode]);

  // Listen for external restore writes and reload theme/surface from localStorage
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === THEME_STORAGE_KEY) {
        const fresh = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
        if (fresh && fresh !== theme) setThemeState(fresh);
      }
      if (detail?.key === SURFACE_STORAGE_KEY) {
        const fresh = localStorage.getItem(SURFACE_STORAGE_KEY) as SurfaceMode | null;
        if (fresh && fresh !== surfaceMode) setSurfaceModeState(fresh);
      }
    };
    window.addEventListener("lumaforge-data-changed", handler);
    return () => window.removeEventListener("lumaforge-data-changed", handler);
  }, [theme, surfaceMode]);

  const value = useMemo(
    () => ({
      theme,
      surfaceMode,
      setTheme,
      setSurfaceMode,
    }),
    [theme, surfaceMode]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme debe usarse dentro de ThemeProvider");
  }

  return context;
}