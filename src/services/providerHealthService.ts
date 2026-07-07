const COOLDOWN_FAIL_THRESHOLD = 2;
const COOLDOWN_DURATION_MS = 10 * 60 * 1000;
const FOREGROUND_TIMEOUT_MS = 4000;
const BACKGROUND_TIMEOUT_MS = 10000;

export type ProviderHealthStatus = "online" | "slow" | "offline" | "cooldown";

export interface ProviderHealthEntry {
  providerId: string;
  status: ProviderHealthStatus;
  failCount: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  cooldownUntil: number | null;
  lastLatencyMs: number | null;
}

const _healthStore = new Map<string, ProviderHealthEntry>();

const PRIORITY_ORDER = ["hubcapdb", "ryuu"];

function getOrCreateEntry(providerId: string): ProviderHealthEntry {
  let entry = _healthStore.get(providerId);
  if (!entry) {
    entry = {
      providerId,
      status: "online",
      failCount: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      cooldownUntil: null,
      lastLatencyMs: null,
    };
    _healthStore.set(providerId, entry);
  }
  return entry;
}

export function getProviderHealth(providerId: string): ProviderHealthEntry | undefined {
  return _healthStore.get(providerId);
}

export function recordProviderSuccess(providerId: string, latencyMs: number): void {
  const entry = getOrCreateEntry(providerId);
  const hadFailures = entry.failCount > 0;
  entry.failCount = 0;
  entry.lastSuccessAt = Date.now();
  entry.lastLatencyMs = latencyMs;
  entry.cooldownUntil = null;
  entry.status = latencyMs < 3000 ? "online" : "slow";

  if (hadFailures) {
    console.log(`[PROVIDER_RECOVERED] provider=${providerId} latencyMs=${latencyMs}`);
  }

  console.log(`[PROVIDER_HEALTH] provider=${providerId} status=${entry.status} failCount=${entry.failCount} cooldownUntil=${entry.cooldownUntil}`);
}

export function recordProviderFailure(providerId: string, errorType: "timeout" | "error", latencyMs?: number): void {
  const entry = getOrCreateEntry(providerId);
  entry.failCount += 1;
  entry.lastFailureAt = Date.now();
  if (latencyMs != null) {
    entry.lastLatencyMs = latencyMs;
  }
  entry.status = entry.failCount >= COOLDOWN_FAIL_THRESHOLD ? "cooldown" : "offline";

  if (errorType === "timeout") {
    console.log(`[PROVIDER_TIMEOUT] provider=${providerId} latencyMs=${latencyMs ?? -1} failCount=${entry.failCount}`);
  }

  if (entry.failCount >= COOLDOWN_FAIL_THRESHOLD) {
    entry.cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
    console.log(`[PROVIDER_HEALTH] provider=${providerId} status=cooldown failCount=${entry.failCount} cooldownUntil=${entry.cooldownUntil}`);
  } else {
    console.log(`[PROVIDER_HEALTH] provider=${providerId} status=${entry.status} failCount=${entry.failCount} cooldownUntil=${entry.cooldownUntil}`);
  }
}

export function isProviderInCooldown(providerId: string): boolean {
  const entry = _healthStore.get(providerId);
  if (!entry || entry.cooldownUntil == null) return false;
  if (Date.now() >= entry.cooldownUntil) {
    entry.cooldownUntil = null;
    entry.status = "online";
    return false;
  }
  return true;
}

export function shouldSkipProvider(providerId: string): boolean {
  const skip = isProviderInCooldown(providerId);
  return skip;
}

export function getHealthyProviders<T extends { id: string }>(providers: T[]): T[] {
  const sorted = [...providers].sort((a, b) => {
    const aIdx = PRIORITY_ORDER.indexOf(a.id);
    const bIdx = PRIORITY_ORDER.indexOf(b.id);
    const aPriority = aIdx >= 0 ? aIdx : PRIORITY_ORDER.length;
    const bPriority = bIdx >= 0 ? bIdx : PRIORITY_ORDER.length;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aHealth = _healthStore.get(a.id);
    const bHealth = _healthStore.get(b.id);
    const aOnline = !aHealth || aHealth.status === "online";
    const bOnline = !bHealth || bHealth.status === "online";
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return 0;
  });
  return sorted;
}

export function getAllProviderHealths(): Record<string, ProviderHealthEntry> {
  const result: Record<string, ProviderHealthEntry> = {};
  for (const [id, entry] of _healthStore) {
    result[id] = { ...entry };
  }
  return result;
}

export function resetProviderHealth(providerId: string): void {
  _healthStore.delete(providerId);
}

export function getForegroundTimeoutMs(): number {
  return FOREGROUND_TIMEOUT_MS;
}

export function getBackgroundTimeoutMs(): number {
  return BACKGROUND_TIMEOUT_MS;
}
