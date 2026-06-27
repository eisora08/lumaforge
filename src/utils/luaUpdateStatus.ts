import type { InstalledLuaScript } from "../types/installedLua";
import type { LuaUpdateInfo } from "../types/luaUpdate";

type LuaUpdateOptions = {
  checking?: boolean;
  providerAvailable?: boolean;
  providerName?: string;
  providerLastUpdatedAt?: string;
  lastCheckedAt?: string;
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
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  if (options.checking) {
    return {
      status: "checking",
      label: "Revisando",
      description: "LumaForge está consultando providers disponibles.",
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  if (
    typeof options.providerAvailable === "boolean" &&
    !options.providerAvailable
  ) {
    return {
      status: "provider-unavailable",
      label: "No disponible",
      description: "No se encontró una fuente disponible para comparar.",
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  /**
   * Punto importante:
   * Si el provider dice que existe una fuente, pero no entrega fecha,
   * versión o hash comparable, NO podemos decir que está actualizado
   * ni que hay update pendiente.
   */
  if (options.providerAvailable && !options.providerLastUpdatedAt) {
    return {
      status: "unknown",
      label: "No verificado",
      description:
        "Hay una fuente disponible, pero el provider no entregó fecha, versión o hash para comparar.",
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  if (!options.providerLastUpdatedAt) {
    return {
      status: "unknown",
      label: "No verificado",
      description: "Todavía no se ha comparado con metadata real del provider.",
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  const localModifiedAt = script.modified_at * 1000;
  const providerUpdatedAt = new Date(options.providerLastUpdatedAt).getTime();

  if (Number.isNaN(providerUpdatedAt)) {
    return {
      status: "unknown",
      label: "No verificado",
      description:
        "El provider entregó una fecha, pero LumaForge no pudo interpretarla correctamente.",
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  if (providerUpdatedAt > localModifiedAt) {
    return {
      status: "update-available",
      label: "Update available",
      description: "Hay una versión más reciente disponible.",
      providerName: options.providerName,
      lastCheckedAt: options.lastCheckedAt,
    };
  }

  return {
    status: "updated",
    label: "Updated",
    description: "Este Lua parece estar actualizado.",
    providerName: options.providerName,
    lastCheckedAt: options.lastCheckedAt,
  };
}
