import type { AppSettings } from "../types/settings";
import type { InstalledLuaScript } from "../types/installedLua";
import type { LuaProviderUpdateCheck } from "../types/luaUpdateCheck";

import {
  getEnabledProviderIds,
  searchPackagesByProviders,
} from "./providerSearch";

export async function checkInstalledLuaUpdates(
  scripts: InstalledLuaScript[],
  settings: AppSettings
): Promise<Record<number, LuaProviderUpdateCheck>> {
  const enabledProviderIds = getEnabledProviderIds(settings);
  const output: Record<number, LuaProviderUpdateCheck> = {};

  for (const script of scripts) {
    const checkedAt = new Date().toISOString();

    try {
      const response = await searchPackagesByProviders(
        {
          query: String(script.app_id),
          provider: "all",
          enabledProviderIds,
        },
        settings
      );

      const game = response.results.find(
        (item) => item.appId === String(script.app_id)
      );

      const availableSource = game?.sources.find((source) => source.available);

      if (!availableSource) {
        output[script.app_id] = {
          appId: script.app_id,
          providerAvailable: false,
          lastCheckedAt: checkedAt,
          message: "No se encontró una fuente disponible.",
        };

        continue;
      }

      output[script.app_id] = {
        appId: script.app_id,
        providerAvailable: true,
        providerName: availableSource.providerName,
        providerLastUpdatedAt: availableSource.lastUpdated,
        lastCheckedAt: checkedAt,
        message:
          availableSource.lastUpdated
            ? "Fuente disponible con fecha de actualización."
            : "Fuente disponible sin fecha/version comparable.",
      };
    } catch (error) {
      output[script.app_id] = {
        appId: script.app_id,
        providerAvailable: false,
        lastCheckedAt: checkedAt,
        message:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "No se pudo revisar actualización.",
      };
    }
  }

  return output;
}