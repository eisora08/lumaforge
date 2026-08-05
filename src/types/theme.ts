export type ThemeId =
  | "crimson-dark"
  | "midnight-blue"
  | "steam-gray"
  | "oled-black"
  | "fluent";

export type SurfaceMode =
  | "solid"
  | "tinted"
  | "frosted"
  | "liquid-glass";

export type ThemeOption = {
  id: ThemeId;
  name: string;
  description: string;
  preview: {
    background: string;
    surface: string;
    accent: string;
  };
};

export type SurfaceModeOption = {
  id: SurfaceMode;
  name: string;
  description: string;
};