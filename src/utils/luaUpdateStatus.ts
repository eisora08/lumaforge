import type { InstalledLuaScript } from "../types/installedLua";
import type { LuaUpdateInfo } from "../types/luaUpdate";

type LuaUpdateOptions = {
  providerLastUpdatedAt?: string;
};

export function getLuaUpdateInfo(
  script: InstalledLuaScript,
  options: LuaUpdateOptions = {}
): LuaUpdateInfo {
  if (script.is_disabled) {
    return {
      status: "disabled",
      label: "Disabled",
      description: "Este Lua está deshabilitado.",
    };
  }

  if (!options.providerLastUpdatedAt) {
    return {
      status: "unknown",
      label: "No verificado",
      description: "Todavía no se ha comparado con el provider.",
    };
  }

  const localModifiedAt = script.modified_at * 1000;
  const providerUpdatedAt = new Date(options.providerLastUpdatedAt).getTime();

  if (Number.isNaN(providerUpdatedAt)) {
    return {
      status: "unknown",
      label: "No verificado",
      description: "No se pudo leer la fecha del provider.",
    };
  }

  if (providerUpdatedAt > localModifiedAt) {
    return {
      status: "update-available",
      label: "Update available",
      description: "Hay una versión más reciente disponible.",
    };
  }

  return {
    status: "updated",
    label: "Updated",
    description: "Este Lua parece estar actualizado.",
  };
}