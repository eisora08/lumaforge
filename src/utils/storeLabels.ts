import type {
  StoreProviderSource,
  StoreProviderStatus,
  StoreSelectedProvider,
} from "../types/store";

export function getStoreProviderStatus(source?: StoreProviderSource): {
  status: StoreProviderStatus;
  label: string;
  description: string;
} {
  if (!source) {
    return {
      status: "unknown",
      label: "No source",
      description: "No hay una fuente seleccionada.",
    };
  }

  if (source.available) {
    return {
      status: "ready",
      label: "Ready",
      description: "Lista para descargar.",
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      status: "needs-auth",
      label: "Needs setup",
      description: "Configura la API key para usar esta fuente.",
    };
  }

  return {
    status: "unavailable",
    label: "Unavailable",
    description: source.message || "Esta fuente no está disponible ahora.",
  };
}

export function getSelectedProviderLabel(
  source?: StoreProviderSource
): StoreSelectedProvider {
  const statusInfo = getStoreProviderStatus(source);

  if (!source) {
    return {
      status: statusInfo.status,
      label: statusInfo.label,
      description: statusInfo.description,
    };
  }

  return {
    sourceId: source.id,
    providerId: source.providerId,
    providerName: source.providerName,
    fileType: source.fileType,
    status: statusInfo.status,
    label: source.providerName,
    description: statusInfo.description,
  };
}

export function formatStoreCheckedAt(value?: string): string {
  if (!value) {
    return "Not checked";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function formatStoreLanguages(languages: string[]): string {
  if (languages.length === 0) {
    return "Metadata pending";
  }

  if (languages.length <= 3) {
    return languages.join(", ");
  }

  return `${languages.slice(0, 3).join(", ")} +${languages.length - 3} more`;
}

export function formatStoreDlcCount(dlcCount?: number): string {
  if (!dlcCount) {
    return "Base Game Only";
  }

  if (dlcCount === 1) {
    return "1 DLC Available";
  }

  return `${dlcCount} DLCs Available`;
}