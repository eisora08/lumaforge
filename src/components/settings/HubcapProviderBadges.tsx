import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import {
  getCachedProviderStatus,
  subscribeProviderStatus,
  refreshHubcapStatus,
} from "../../services/hubcapApiService";
import type { HubcapProviderStatus } from "../../services/hubcapApiService";

type PillVariant = "green" | "amber" | "red" | "muted";

function pillClass(variant: PillVariant): string {
  const map: Record<string, string> = {
    green: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    red: "border-red-500/20 bg-red-500/10 text-red-300",
    muted: "border-(--surface-active-border) bg-white/5 text-(--color-muted)",
  };
  return map[variant] ?? map.muted;
}

type SurfaceLabel = "settings" | "store-details";

type Props = {
  surface?: SurfaceLabel;
};

export default function HubcapProviderBadges({ surface = "settings" }: Props) {
  const { settings } = useSettings();
  const hubcapSettings = settings.providers?.hubcapdb;
  const apiKey = hubcapSettings?.apiKey ?? "";
  const baseUrl = hubcapSettings?.baseUrl ?? "https://hubcapmanifest.com";

  const [status, setStatus] = useState<HubcapProviderStatus>(() => getCachedProviderStatus());
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const didInitRef = useRef(false);
  const didLogBadges = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Subscribe to cross-instance status updates
  useEffect(() => {
    return subscribeProviderStatus((s) => {
      if (mountedRef.current) setStatus(s);
    });
  }, []);

  // Initialize: render cached instantly, refresh in background if stale
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    const cached = getCachedProviderStatus();
    const isStale = Date.now() - cached.lastCheckedAt > 5 * 60 * 1000;

    if (isStale || cached.healthStatus === "unknown") {
      refreshHubcapStatus(baseUrl, apiKey).then((s) => {
        if (mountedRef.current) setStatus(s);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-validate when API key changes (user types/pastes a key)
  useEffect(() => {
    if (!didInitRef.current) return;
    if (!apiKey) return;
    refreshHubcapStatus(baseUrl, apiKey).then((s) => {
      if (mountedRef.current) setStatus(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Log badges render once per mount
  useEffect(() => {
    if (didLogBadges.current) return;
    didLogBadges.current = true;
    console.log(
      `[HUBCAP][BADGES] surface=${surface} today=${status.todayUsage} limit=${status.dailyLimit} plan=${status.plan} expiry=${status.apiKeyExpiresAt} canMake=${status.canMakeRequests}`,
    );
  }, [surface, status.todayUsage, status.dailyLimit, status.plan, status.apiKeyExpiresAt, status.canMakeRequests]);

  // --- Computed values ---

  const healthVariant: PillVariant = status.healthStatus === "online"
    ? "green"
    : status.healthStatus === "degraded"
      ? "amber"
      : status.healthStatus === "error" || status.healthStatus === "offline"
        ? "red"
        : "muted";

  const healthLabel = status.healthStatus === "online"
    ? "Online"
    : status.healthStatus === "degraded"
      ? "Slow"
      : status.healthStatus === "error"
        ? "Error"
        : status.healthStatus === "offline"
          ? "Off"
          : "···";

  const authVariant: PillVariant = status.apiKeyStatus === "ok"
    ? "green"
    : status.apiKeyStatus === "forbidden" || status.apiKeyStatus === "unauthorized"
      ? "red"
      : status.apiKeyStatus === "rate_limited"
        ? "amber"
        : "muted";

  const authLabel = status.apiKeyStatus === "ok"
    ? "API OK"
    : status.apiKeyStatus === "unauthorized"
      ? "Unauthorized"
      : status.apiKeyStatus === "forbidden"
        ? "Forbidden"
        : status.apiKeyStatus === "rate_limited"
          ? "Limited"
          : status.apiKeyStatus === "missing"
            ? "No Key"
            : "···";

  /** Effective daily limit: customApiLimit when usingCustomApiLimit, else roleDailyLimit or dailyLimit */
  const effectiveLimit = status.usingCustomApiLimit && status.customApiLimit != null
    ? status.customApiLimit
    : (status.roleDailyLimit ?? status.dailyLimit);

  const hasUsage = status.todayUsage != null && effectiveLimit != null && effectiveLimit > 0;
  const usagePct = hasUsage ? (status.todayUsage! / effectiveLimit!) * 100 : 0;
  const usageVariant: PillVariant = usagePct >= 100 ? "red" : usagePct >= 70 ? "amber" : "muted";

  const hasReset = status.resetLabel != null && status.resetLabel.length > 0;

  /** Compute expiry label from apiKeyExpiresAt */
  const expiryLabel = status.apiKeyExpiresAt
    ? (() => {
        const ms = new Date(status.apiKeyExpiresAt).getTime() - Date.now();
        if (ms <= 0) return "Expired";
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        return days >= 1 ? `${days}d` : `${hours}h`;
      })()
    : null;
  const isExpired = status.apiKeyExpiresAt != null && new Date(status.apiKeyExpiresAt).getTime() <= Date.now();
  const expiryVariant: PillVariant = isExpired || (expiryLabel === "Expired") ? "red" : "amber";

  /** canMakeRequests badge */
  const canMake = status.canMakeRequests;
  const requestsVariant: PillVariant = canMake === true ? "green" : canMake === false ? "red" : "muted";

  /** Plan badge */
  const hasPlan = status.plan != null && status.plan.length > 0;

  const tooltipLines: string[] = [];
  if (status.plan) tooltipLines.push(`Plan: ${status.plan}`);
  if (status.totalKeyUsage != null) tooltipLines.push(`Total usage: ${status.totalKeyUsage}`);
  if (canMake != null) tooltipLines.push(`Can make requests: ${canMake ? "Yes" : "No"}`);
  if (status.apiKeyExpiresAt) {
    const d = new Date(status.apiKeyExpiresAt);
    tooltipLines.push(`Key expires: ${d.toLocaleDateString()}`);
  }
  if (status.roleDailyLimit != null) tooltipLines.push(`Role limit: ${status.roleDailyLimit}`);
  if (status.usingCustomApiLimit && status.customApiLimit != null) {
    tooltipLines.push(`Custom limit: ${status.customApiLimit}`);
  }
  if (status.lastCheckedAt > 0) {
    tooltipLines.push(`Checked: ${new Date(status.lastCheckedAt).toLocaleString()}`);
  }
  const tooltip = tooltipLines.length > 0 ? tooltipLines.join(" · ") : undefined;

  const needsRefresh = status.healthStatus === "unknown" || status.lastCheckedAt === 0;

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${pillClass(healthVariant)}`}>
        {healthLabel}
      </span>

      {apiKey && (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${pillClass(authVariant)}`}>
          {authLabel}
        </span>
      )}

      {hasUsage && (
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${pillClass(usageVariant)}`}
          title={tooltip}
        >
          Today {status.todayUsage}/{effectiveLimit}
        </span>
      )}

      {/* {hasUsage && !hasReset && (
        <span className="rounded-full border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[10px] font-medium leading-none text-(--color-muted)" title={tooltip}>
          24h cycle
        </span>
      )} */}

      {hasPlan && (
        <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium leading-none text-sky-300" title={tooltip}>
          {status.plan}
        </span>
      )}

      {expiryLabel && (
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${pillClass(expiryVariant)}`}
          title={tooltip}
        >
          {isExpired ? "Expired" : `${expiryLabel}`}
        </span>
      )}

      {canMake != null && (
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${pillClass(requestsVariant)}`}
          title={tooltip}
        >
          {canMake ? "Active" : "Blocked"}
        </span>
      )}

      {hasReset && (
        <span className="rounded-full border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[10px] font-medium leading-none text-(--color-muted)" title={tooltip}>
          Reset {status.resetLabel}
        </span>
      )}

      {needsRefresh && (
        <button
          type="button"
          onClick={async () => {
            if (loading) return;
            setLoading(true);
            try {
              const s = await refreshHubcapStatus(baseUrl, apiKey);
              if (mountedRef.current) setStatus(s);
            } finally {
              if (mountedRef.current) setLoading(false);
            }
          }}
          disabled={loading}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text) disabled:opacity-40 transition"
          title="Check Hubcap connection"
        >
          {loading ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}
