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

  // Log badges render once per mount
  useEffect(() => {
    if (didLogBadges.current) return;
    didLogBadges.current = true;
    console.log(
      `[HUBCAP][BADGES] surface=${surface} today=${status.todayUsage} limit=${status.dailyLimit} reset=${status.resetLabel}`,
    );
  }, [surface, status.todayUsage, status.dailyLimit, status.resetLabel]);

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

  const hasUsage = status.todayUsage != null && status.dailyLimit != null && status.dailyLimit > 0;
  const usagePct = hasUsage ? (status.todayUsage! / status.dailyLimit!) * 100 : 0;
  const usageVariant: PillVariant = usagePct >= 100 ? "red" : usagePct >= 70 ? "amber" : "muted";

  const hasReset = status.resetLabel != null && status.resetLabel.length > 0;

  const tooltipLines: string[] = [];
  if (status.totalKeyUsage != null) tooltipLines.push(`Total: ${status.totalKeyUsage}`);
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
          Today {status.todayUsage}/{status.dailyLimit}
        </span>
      )}

      {hasReset && (
        <span className="rounded-full border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[10px] font-medium leading-none text-(--color-muted)">
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
