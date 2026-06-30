const REGISTRY_KEY = "lumaforge-installed-games-v1";

export type InstalledGameEntry = {
  gameId: string;
  installDir: string;
  exePath: string;
  exeName: string;
  provider: "steam" | "local" | "lua" | "unknown";
  lastValidated: number;
};

type RegistryStore = Record<string, InstalledGameEntry>;

function loadRegistry(): RegistryStore {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (raw) return JSON.parse(raw) as RegistryStore;
  } catch {}
  return {};
}

function saveRegistry(store: RegistryStore): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(store));
  } catch {}
}

export function getInstalledGameEntry(gameId: string): InstalledGameEntry | undefined {
  return loadRegistry()[gameId];
}

export function setInstalledGameEntry(entry: InstalledGameEntry): void {
  const store = loadRegistry();
  store[entry.gameId] = entry;
  saveRegistry(store);
}

export function removeInstalledGameEntry(gameId: string): void {
  const store = loadRegistry();
  delete store[gameId];
  saveRegistry(store);
}

export function getAllInstalledGameEntries(): InstalledGameEntry[] {
  return Object.values(loadRegistry());
}

export function getExeNameFromEntry(gameId: string): string | undefined {
  const entry = loadRegistry()[gameId];
  return entry?.exeName;
}

export function getExePathFromEntry(gameId: string): string | undefined {
  const entry = loadRegistry()[gameId];
  return entry?.exePath;
}
