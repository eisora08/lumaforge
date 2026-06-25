import { ThemeId, ThemeOption } from "../types/theme";

export const themes: ThemeOption[] = [
  {
    id: "crimson-dark",
    name: "Crimson Dark",
    description: "Tema oscuro premium con tonos vino y acento azul claro.",
    preview: {
      background: "#181114",
      surface: "#302b2f",
      accent: "#b8d7dc",
    },
  },
  {
    id: "midnight-blue",
    name: "Midnight Blue",
    description: "Estilo launcher nocturno con tonos azules profundos.",
    preview: {
      background: "#0f172a",
      surface: "#1e293b",
      accent: "#38bdf8",
    },
  },
  {
    id: "steam-gray",
    name: "Steam Gray",
    description: "Inspirado en launchers clásicos con grises elegantes.",
    preview: {
      background: "#171a21",
      surface: "#2a475e",
      accent: "#66c0f4",
    },
  },
  {
    id: "oled-black",
    name: "OLED Black",
    description: "Negro profundo para pantallas OLED y máximo contraste.",
    preview: {
      background: "#000000",
      surface: "#111111",
      accent: "#ffffff",
    },
  },
];

export const themeVariables: Record<ThemeId, Record<string, string>> = {
  "crimson-dark": {
    "--color-bg": "#181114",
    "--color-sidebar": "#140d10",
    "--color-surface": "#302b2f",
    "--color-surface-soft": "#241b1d",
    "--color-border": "rgba(255,255,255,0.10)",
    "--color-text": "#ffffff",
    "--color-muted": "#9ca3af",
    "--color-accent": "#b8d7dc",
  },

  "midnight-blue": {
    "--color-bg": "#0f172a",
    "--color-sidebar": "#020617",
    "--color-surface": "#1e293b",
    "--color-surface-soft": "#111827",
    "--color-border": "rgba(148,163,184,0.18)",
    "--color-text": "#f8fafc",
    "--color-muted": "#94a3b8",
    "--color-accent": "#38bdf8",
  },

  "steam-gray": {
    "--color-bg": "#171a21",
    "--color-sidebar": "#10141b",
    "--color-surface": "#2a475e",
    "--color-surface-soft": "#1b2838",
    "--color-border": "rgba(102,192,244,0.20)",
    "--color-text": "#ffffff",
    "--color-muted": "#c7d5e0",
    "--color-accent": "#66c0f4",
  },

  "oled-black": {
    "--color-bg": "#000000",
    "--color-sidebar": "#050505",
    "--color-surface": "#111111",
    "--color-surface-soft": "#070707",
    "--color-border": "rgba(255,255,255,0.12)",
    "--color-text": "#ffffff",
    "--color-muted": "#a3a3a3",
    "--color-accent": "#ffffff",
  },
};
``