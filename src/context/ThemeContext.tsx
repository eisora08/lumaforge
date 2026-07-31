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
  accentOverride: string | null;
  setTheme: (theme: ThemeId) => void;
  setSurfaceMode: (mode: SurfaceMode) => void;
  setAccentOverride: (hex: string | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = "lumaforge-theme";
const SURFACE_STORAGE_KEY = "lumaforge-surface-mode";
const ACCENT_STORAGE_KEY = "lumaforge-accent";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Derives a readable text color for buttons/labels rendered on top of the accent.
// Light accents get near-black text, dark accents get white text.
function accentTextColor(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#111111" : "#ffffff";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    return savedTheme || "midnight-blue";
  });

  const [surfaceMode, setSurfaceModeState] = useState<SurfaceMode>(() => {
    const savedMode = localStorage.getItem(SURFACE_STORAGE_KEY) as SurfaceMode | null;
    return savedMode || "solid";
  });

  const [accentOverride, setAccentOverrideState] = useState<string | null>(() => {
    const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
    return saved && HEX_RE.test(saved) ? saved : null;
  });

  function setTheme(nextTheme: ThemeId) {
    setThemeState(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  function setSurfaceMode(nextMode: SurfaceMode) {
    setSurfaceModeState(nextMode);
    localStorage.setItem(SURFACE_STORAGE_KEY, nextMode);
  }

  function setAccentOverride(hex: string | null) {
    const next = hex && HEX_RE.test(hex) ? hex : null;
    setAccentOverrideState(next);
    if (next) {
      localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } else {
      localStorage.removeItem(ACCENT_STORAGE_KEY);
    }
  }

  useEffect(() => {
    const variables = themeVariables[theme];
    const root = document.documentElement;

    Object.entries(variables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // Apply the user's accent override on top of the theme palette.
    if (accentOverride) {
      root.style.setProperty("--color-accent", accentOverride);
      root.style.setProperty("--color-accent-text", accentTextColor(accentOverride));
    }

    root.dataset.theme = theme;
  }, [theme, accentOverride]);

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
      if (detail?.key === ACCENT_STORAGE_KEY) {
        const fresh = localStorage.getItem(ACCENT_STORAGE_KEY);
        const next = fresh && HEX_RE.test(fresh) ? fresh : null;
        if (next !== accentOverride) setAccentOverrideState(next);
      }
    };
    window.addEventListener("lumaforge-data-changed", handler);
    return () => window.removeEventListener("lumaforge-data-changed", handler);
  }, [theme, surfaceMode, accentOverride]);

  const value = useMemo(
    () => ({
      theme,
      surfaceMode,
      accentOverride,
      setTheme,
      setSurfaceMode,
      setAccentOverride,
    }),
    [theme, surfaceMode, accentOverride]
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