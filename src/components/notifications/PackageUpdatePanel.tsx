import { useEffect, useRef, useState } from "react";
import { ExternalLink, Package } from "lucide-react";
import type { UpdateEntry } from "../../services/installedLuaScanner";
import { getUpdateEntries, subscribeUpdateStatus, markUpdatesNotified } from "../../services/installedLuaScanner";
import { setPendingStoreDetailAppId } from "../../services/storeNavigationService";
import type { AppPage } from "../../types/navigation";

type Props = {
  onClose: () => void;
  onNavigate: (page: AppPage) => void;
};

export default function PackageUpdatePanel({ onClose, onNavigate }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<UpdateEntry[]>(() => getUpdateEntries());

  // Subscribe to live updates so the panel refreshes without close/reopen
  useEffect(() => {
    const unsub = subscribeUpdateStatus(() => {
      const updated = getUpdateEntries();
      console.log(`[NOTIFICATIONS][PANEL_UPDATE] updates=${updated.length}`);
      setEntries(updated);
    });
    return unsub;
  }, []);

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Mark notifications as seen when panel opens with updates
  useEffect(() => {
    if (entries.length > 0) {
      markUpdatesNotified();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleOpenApp(entry: UpdateEntry) {
    console.log(`[NOTIFICATIONS][OPEN_UPDATE_ITEM] appid=${entry.appId} provider=${entry.providerId} title=${entry.title ?? "unknown"}`);
    setPendingStoreDetailAppId(entry.appId, entry.title ?? undefined);
    onNavigate("store");
    onClose();
  }

  const displayTitle = (entry: UpdateEntry): string => {
    return entry.title || `App ${entry.appId}`;
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-(--surface-active-border)/40 bg-(--color-bg) shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-(--surface-active-border)/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-(--color-muted)" />
          <span className="text-sm font-semibold text-(--color-text)">Package updates</span>
        </div>
        {entries.length > 0 && (
          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-400">
            {entries.length} available
          </span>
        )}
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Package className="h-8 w-8 text-(--color-muted)/30" />
            <p className="text-sm text-(--color-muted)">No package updates available</p>
          </div>
        ) : (
          <div className="divide-y divide-(--surface-active-border)/10">
            {entries.map((entry) => (
              <button
                key={entry.appId}
                onClick={() => handleOpenApp(entry)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-(--color-text)">
                    {displayTitle(entry)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-(--color-muted)">
                    {entry.providerName || entry.providerId}
                    {entry.remoteUpdatedAt ? (
                      <> · Updated {formatDate(entry.remoteUpdatedAt)}</>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-amber-400">
                    Update available
                    {entry.reason ? <> · {entry.reason}</> : null}
                  </p>
                </div>
                <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-(--color-muted)/40" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
