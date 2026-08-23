import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Download,
  FileArchive,
  Loader2,
} from "lucide-react";
import type { RepackEntry } from "../../types/package";
import { DEBRID_STORE_ENABLED } from "../../features/debrid/debridFeatureFlag";
import type { RepackInstallOptions } from "../../services/debridInstallChoice";
import {
  getConfiguredProviders,
  type ProviderId,
} from "../../services/debridProviderService";
import { useSettings } from "../../context/SettingsContext";
import StoreRepackInstallModal from "./StoreRepackInstallModal";

function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "?";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function repackLabel(repacker: string): string {
  return repacker ? repacker.charAt(0).toUpperCase() + repacker.slice(1) : repacker;
}

type StoreRepackCardProps = {
  repackEntries: RepackEntry[];
  repacksLoading: boolean;
  onInstall: (entry: RepackEntry, options: RepackInstallOptions) => void | Promise<void>;
};

type PopupPos = { left: number; width: number; top?: number; bottom?: number };

export default function StoreRepackCard({
  repackEntries,
  repacksLoading,
  onInstall,
}: StoreRepackCardProps) {
  const { settings } = useSettings();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [menuPos, setMenuPos] = useState<PopupPos | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuPortalRef = useRef<HTMLDivElement | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, RepackEntry[]>();
    for (const entry of repackEntries) {
      const key = entry.repacker || "repack";
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return [...map.entries()];
  }, [repackEntries]);

  // Default to the first group / first entry whenever the entries change.
  useEffect(() => {
    if (groups.length === 0) return;
    const firstKey = groups[0][0];
    setSelectedGroup((prev) => (prev && groups.some(([k]) => k === prev) ? prev : firstKey));
    setSelectedEntryId((prev) => {
      const list = groups.find(([k]) => k === (selectedGroup && groups.some(([g]) => g[0] === selectedGroup) ? selectedGroup : firstKey))?.[1] ?? groups[0][1];
      return list.some((e) => e.id === prev) ? prev : (list[0]?.id ?? null);
    });
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute a fixed-position box for the source menu, flipping above when
  // there isn't enough room below the trigger. Runs while the menu is open to
  // track scroll/resize of any ancestor (the card's internal scroll container).
  const computeMenuPos = useCallback((): PopupPos | null => {
    const el = menuRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const menuHeight = Math.min(240, groups.length * 44 + 12);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const base = { left: rect.left, width: rect.width };
    if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
      return { ...base, top: rect.bottom + 6 };
    }
    return { ...base, bottom: window.innerHeight - rect.top + 6 };
  }, [groups.length]);

  function openSourceMenu() {
    const pos = computeMenuPos();
    setMenuPos(pos);
    setSourceMenuOpen(true);
  }

  // Close the source menu on outside click (trigger + portal both count as inside).
  useEffect(() => {
    if (!sourceMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      const inTrigger = menuRef.current?.contains(t);
      const inMenu = menuPortalRef.current?.contains(t);
      if (!inTrigger && !inMenu) {
        setSourceMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [sourceMenuOpen]);

  // Reposition on any scroll (capture-phase catches inner containers) and resize.
  useEffect(() => {
    if (!sourceMenuOpen) return;
    function reposition() {
      setMenuPos(computeMenuPos());
    }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [sourceMenuOpen, computeMenuPos]);

  const visible = DEBRID_STORE_ENABLED && (repacksLoading || repackEntries.length > 0);
  if (!visible) return null;

  const debridConfig = settings.debridProviders;
  const configuredProviders: ProviderId[] = getConfiguredProviders(debridConfig);

  const activeGroupKey =
    selectedGroup && groups.some(([k]) => k === selectedGroup)
      ? selectedGroup
      : (groups[0]?.[0] ?? null);
  const activeGroup = groups.find(([k]) => k === activeGroupKey);
  const groupEntries = activeGroup?.[1] ?? [];
  const activeEntry =
    groupEntries.find((e) => e.id === selectedEntryId) ?? groupEntries[0] ?? null;

  async function handleConfirm(options: RepackInstallOptions) {
    if (!activeEntry) return;
    setInstalling(true);
    try {
      await onInstall(activeEntry, options);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="flex max-h-[520px] flex-col rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
          <FileArchive className="h-4 w-4 text-(--color-muted)" />
          Repacks
        </h3>
        {repacksLoading && <Loader2 className="h-4 w-4 animate-spin text-(--color-muted)" />}
      </div>

      {repacksLoading && repackEntries.length === 0 ? (
        <p className="mt-3 shrink-0 text-xs text-(--color-muted)">Buscando repacks…</p>
      ) : (
        <>
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 lf-scroll-area">
          {activeEntry && (
            <>
              {/* Selected source (repacker group) */}
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={openSourceMenu}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-left transition duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97]"
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] uppercase tracking-[0.14em] text-(--color-muted)">
                      Source
                    </span>
                    <span className="block truncate text-sm font-semibold text-(--color-accent)">
                      {repackLabel(activeGroupKey ?? "repack")}
                      <span className="ml-1.5 text-[10px] font-normal text-(--color-muted)">
                        {groupEntries.length} {groupEntries.length === 1 ? "entry" : "entries"}
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-(--color-muted) transition-transform ${
                      sourceMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {sourceMenuOpen &&
                  menuPos &&
                  createPortal(
                    <div
                      ref={menuPortalRef}
                      className="lf-popover-enter fixed z-[60] max-h-60 overflow-y-auto rounded-xl border border-(--surface-active-border) bg-(--color-surface)/95 p-1.5 shadow-xl backdrop-blur-xl"
                      style={{
                        left: menuPos.left,
                        width: menuPos.width,
                        ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }),
                      }}
                    >
                      {groups.map(([repacker, entries]) => {
                        const active = repacker === activeGroupKey;
                        return (
                          <button
                            key={repacker}
                            type="button"
                            onClick={() => {
                              setSelectedGroup(repacker);
                              setSelectedEntryId(entries[0]?.id ?? null);
                              setSourceMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) ${
                              active ? "bg-(--color-accent)/10" : ""
                            }`}
                          >
                            <span className="text-sm font-medium text-(--color-text)">
                              {repackLabel(repacker)}
                            </span>
                            <span className="text-[10px] text-(--color-muted)">
                              {entries.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>,
                    document.body,
                  )}
              </div>

              {/* Entry sub-selector when the group has more than one entry */}
              {groupEntries.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-(--color-muted)">
                    Versión
                  </p>
                  <ul className="max-h-52 space-y-1 overflow-y-auto pr-1">
                    {groupEntries.map((entry) => {
                      const active = entry.id === activeEntry.id;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedEntryId(entry.id)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${
                              active
                                ? "border-(--color-accent)/60 bg-(--color-accent)/10"
                                : "border-transparent hover:bg-white/5"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-(--color-text)">
                                {entry.title}
                              </span>
                              <span className="text-[10px] text-(--color-muted)">
                                {formatBytes(entry.fileSize)}
                                {entry.updatedAt ? ` · ${entry.updatedAt.slice(0, 10)}` : ""}
                              </span>
                            </span>
                            {active && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-(--color-accent)" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}

          {!activeEntry && (
            <p className="text-xs text-(--color-muted)">Sin repacks disponibles.</p>
          )}
        </div>

        {activeEntry && (
          <div className="shrink-0 space-y-2 border-t border-(--surface-active-border) pt-3">
            <p className="text-xs text-(--color-muted)">
              {formatBytes(activeEntry.fileSize)}
              {activeEntry.repacker ? ` · ${repackLabel(activeEntry.repacker)}` : ""}
            </p>
            <button
              type="button"
              disabled={installing}
              onClick={() => setModalOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-3 text-sm font-bold text-(--color-accent-text) shadow-lg shadow-(--color-accent)/25 transition duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Descargar
            </button>
          </div>
        )}
        </>
      )}

      {activeEntry && (
        <StoreRepackInstallModal
          open={modalOpen}
          entry={activeEntry}
          configuredProviders={configuredProviders}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
