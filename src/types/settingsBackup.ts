import { AppSettings } from "./settings";
import { SurfaceMode, ThemeId } from "./theme";

export type SettingsBackup = {
  app: "LumaForge";
  version: 1;
  exportedAt: string;
  theme: ThemeId;
  surfaceMode: SurfaceMode;
  settings: AppSettings;
};