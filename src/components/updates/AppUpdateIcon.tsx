import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, ArrowUpCircle, Check, ExternalLink, Loader2 } from "lucide-react";
import { useAppUpdate } from "../../hooks/useAppUpdate";
import { checkForUpdate, downloadAndInstallUpdate, dismissUpdate } from "../../services/appUpdateStore";

export default function AppUpdateIcon() {
  const snap = useAppUpdate();
  const [panelOpen, setPanelOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);

  // Position from anchor
  useEffect(() => {
    if (panelOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
  }, [panelOpen]);

  // Click outside to close
  useEffect(() => {
    if (!panelOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setPanelOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [panelOpen]);

  const handleToggle = useCallback(() => setPanelOpen((p) => !p), []);

  const handleUpdate = useCallback(() => {
    downloadAndInstallUpdate();
  }, []);

  const handleDismiss = useCallback(() => {
    dismissUpdate();
    setPanelOpen(false);
  }, []);

  const handleCheckNow = useCallback(() => {
    checkForUpdate(false);
  }, []);

  const handleViewChangelog = useCallback(() => {
    window.open("https://github.com/anomalyco/LumaForge/releases", "_blank");
  }, []);

  // Don't render when no update available and not checking
  if (!snap.updateAvailable && !snap.error) return null;

  const versionLabel = snap.updateVersion ? `v${snap.updateVersion}` : "";
  const currentLabel = snap.currentVersion ? `v${snap.currentVersion}` : "";

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-accent)/10 transition hover:bg-(--color-accent)/20"
        title={snap.updateAvailable ? `Update available: ${versionLabel}` : "Checking for updates…"}
      >
        {snap.downloading ? (
          <Loader2 className="h-4 w-4 animate-spin text-(--color-accent)" />
        ) : snap.downloaded ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : snap.checking ? (
          <Loader2 className="h-4 w-4 animate-spin text-(--color-muted)" />
        ) : (
          <ArrowUpCircle className="h-4 w-4 text-(--color-accent)" />
        )}
        {/* Pulse dot */}
        {snap.updateAvailable && !snap.downloading && !snap.downloaded && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-(--color-accent) animate-pulse" />
        )}
      </button>

      {panelOpen && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[99998] w-80 overflow-hidden rounded-2xl border border-(--surface-active-border)/40 shadow-2xl shadow-black/30"
          style={{
            ...(panelPos
              ? { top: panelPos.top, right: panelPos.right }
              : { top: 0, right: 0, visibility: "hidden" as const }),
            background: "var(--surface-active)",
            backdropFilter: "var(--surface-active-blur)",
            WebkitBackdropFilter: "var(--surface-active-blur)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-(--surface-active-border)/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="h-4 w-4 text-(--color-accent)" />
              <span className="text-sm font-semibold text-(--color-text)">App Update</span>
            </div>
            {snap.updateVersion && (
              <span className="rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-xs font-medium text-(--color-accent)">
                {versionLabel}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="px-4 py-3 space-y-3">
            {snap.downloaded ? (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                <span>Updated to {versionLabel}. Restarting…</span>
              </div>
            ) : snap.downloading ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-(--color-text)">
                  <Loader2 className="h-4 w-4 animate-spin text-(--color-accent)" />
                  <span>Downloading update…</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-(--color-accent) transition-[width] duration-300"
                    style={{ width: `${snap.downloadProgress}%` }}
                  />
                </div>
              </div>
            ) : snap.error ? (
              <div className="space-y-2">
                <p className="text-sm text-rose-400">{snap.error}</p>
                <button
                  onClick={handleCheckNow}
                  className="text-xs text-(--color-muted) hover:text-(--color-text) transition"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-(--color-text)">
                  A new version of LumaForge is available.
                </p>
                {currentLabel && (
                  <p className="text-xs text-(--color-muted)">
                    {currentLabel} → {versionLabel}
                  </p>
                )}
                {snap.updateBody && (
                  <div className="max-h-32 overflow-y-auto rounded-lg bg-black/20 p-2.5">
                    <p className="text-xs leading-relaxed text-(--color-muted) whitespace-pre-wrap">
                      {snap.updateBody}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!snap.downloading && !snap.downloaded && (
            <div className="flex items-center justify-between border-t border-(--surface-active-border)/20 px-4 py-3">
              <button
                onClick={handleDismiss}
                className="text-xs text-(--color-muted) hover:text-(--color-text) transition"
              >
                Later
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleViewChangelog}
                  className="flex items-center gap-1 text-xs text-(--color-muted) hover:text-(--color-text) transition"
                >
                  <ExternalLink className="h-3 w-3" />
                  Changelog
                </button>
                <button
                  onClick={handleUpdate}
                  className="flex items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  Update & Restart
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
