import { SettingsBackup } from "../types/settingsBackup";

export function downloadJsonFile(fileName: string, data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const result = reader.result;

        if (typeof result !== "string") {
          reject(new Error("Archivo inválido"));
          return;
        }

        resolve(JSON.parse(result) as T);
      } catch {
        reject(new Error("No se pudo leer el JSON"));
      }
    };

    reader.onerror = () => {
      reject(new Error("Error leyendo el archivo"));
    };

    reader.readAsText(file);
  });
}

export function isValidSettingsBackup(
  data: unknown
): data is SettingsBackup {
  if (!data || typeof data !== "object") {
    return false;
  }

  const backup = data as Partial<SettingsBackup>;

  return (
    backup.app === "LumaForge" &&
    backup.version === 1 &&
    typeof backup.exportedAt === "string" &&
    typeof backup.theme === "string" &&
    typeof backup.surfaceMode === "string" &&
    typeof backup.settings === "object" &&
    backup.settings !== null
  );
}
