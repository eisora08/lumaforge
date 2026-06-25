export type ThemeId =
  | "crimson-dark"
  | "midnight-blue"
  | "steam-gray"
  | "oled-black";

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