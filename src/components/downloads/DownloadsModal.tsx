import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  Download,
  History,
  Trash2,
  Upload,
} from "lucide-react";

import ActiveDownloadCard from "./ActiveDownloadCard";
import DownloadJobCard from "./DownloadJobCard";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { useActiveDownload } from "../../hooks/useActiveDownload";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { getBootSnapshot } from "../../services/appBootCoordinator";
import { cleanDebridTempFiles, resolveAppDataDir } from "../../services/tauri";
import type { DownloadJob } from "../../types/download";
import type { AppPage } from "../../types/navigation";

type Props = {
  open: boolean;
  onClose: () => void;
  onNavigate?: (page: AppPage) => void;
};

type ModalSection = "overview" | "history";

const NAV_ITEMS: { key: ModalSection; label: string; icon: typeof Download }[] = [
  { key: "overview", label: "Overview", icon: Download },
  { key: "history", label: "Historial", icon: Clock },
];

export default function DownloadsModal({ open, onClose, onNavigate }: Props) {
  const {
    jobs,
    cancelJob,
    pauseJob,
    resumeJob,
    removeJob,
    clearCompleted,
  } = useDownloadQueue();
  const { setSelectedGame, games } = useLibraryGames();

  const backdropRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<ModalSection>("overview");

  // ── Escape key ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // ── Reset to overview when opening ──
  useEffect(() => {
    if (open) setSection("overview");
  }, [open]);

  // ── Game navigation from download cards ──
  const handleOpenGame = useCallback(
    (appId: string) => {
      let game = games.find((g) => g.appId === appId || g.id.endsWith(`-${appId}`));
      if (game) {
        setSelectedGame(game);
        onNavigate?.("library-game-detail");
        onClose();
        return;
      }
      const snapshot = getBootSnapshot();
      const snapshotGame = snapshot?.library.games.find(
        (g) => g.appId === appId || g.appId.endsWith(`-${appId}`),
      );
      if (snapshotGame) {
        game = games.find(
          (g) => g.appId === snapshotGame.appId || g.id.endsWith(`-${snapshotGame.appId}`),
        );
        if (game) {
          setSelectedGame(game);
          onNavigate?.("library-game-detail");
          onClose();
        }
      }
    },
    [games, setSelectedGame, onNavigate, onClose],
  );

  // ── Job filtering (same logic as Downloads.tsx) ──
  const activeJobs = useMemo(
    () =>
      jobs.filter((job) =>
        ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"].includes(
          job.status,
        ),
      ),
    [jobs],
  );

  const interruptedDebrid = useMemo(
    () => jobs.filter((job) => job.type === "debrid-install" && job.status === "failed"),
    [jobs],
  );

  const completedJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          ["done", "failed", "cancelled"].includes(job.status) &&
          !(job.type === "debrid-install" && job.status === "failed"),
      ),
    [jobs],
  );

  // Clean temp files for a cancelled download
  const handleCleanTemp = useCallback(async (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    let destDir = job.destDir;
    if (!destDir && job.type === "debrid-install") {
      // Default dest: <appData>/games/debrid/<providerGameId>
      const providerGameId = jobId.replace("debrid-install-", "");
      const appDataDir = await resolveAppDataDir();
      destDir = `${appDataDir}/games/debrid/${providerGameId}`;
    }
    if (!destDir) return;
    try {
      const removed = await cleanDebridTempFiles(destDir);
      console.log(`[DOWNLOAD][CLEAN_TEMP] jobId=${jobId} removed=${removed}`);
    } catch (e) {
      console.warn("[DOWNLOAD][CLEAN_TEMP] Failed:", e);
    }
  }, [jobs]);

  if (!open) return null;

  const activeCount = activeJobs.length + interruptedDebrid.length;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-md lf-modal-overlay"
    >
      <div className="relative mx-4 flex h-[min(750px,80vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-2xl border shadow-2xl lf-modal-panel" style={{ background: "var(--surface-active)", borderColor: "var(--surface-active-border)" }}>
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-(--surface-active-border) px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-accent)/10">
              <Download className="h-4.5 w-4.5 text-(--color-accent)" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-(--color-text)">Descargas</h2>
              <p className="text-xs text-(--color-muted)">
                {activeCount > 0
                  ? `${activeCount} descarga${activeCount === 1 ? "" : "s"} activa${activeCount === 1 ? "" : "s"}`
                  : "Sin descargas activas"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>

        {/* ── Body: sidebar + content ── */}
        <div className="flex min-h-0 flex-1">
          {/* ── Sidebar nav ── */}
          <nav className="w-[220px] shrink-0 border-r border-(--surface-active-border) p-3">
            <div className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = section === item.key;
                const count = item.key === "overview" ? activeCount : completedJobs.length;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSection(item.key)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? "bg-(--color-accent)/10 text-(--color-accent)"
                        : "text-(--color-muted) hover:bg-white/[0.04] hover:text-(--color-text)"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {count > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          isActive
                            ? "bg-(--color-accent)/20 text-(--color-accent)"
                            : "bg-white/[0.06] text-(--color-muted)"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* ── Content ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {section === "overview" ? (
              <OverviewContent
                activeJobs={activeJobs}
                interruptedDebrid={interruptedDebrid}
                onPause={pauseJob}
                onResume={resumeJob}
                onCancel={cancelJob}
                onRemove={removeJob}
                onOpenDetails={handleOpenGame}
              />
            ) : (
              <HistoryContent
                completedJobs={completedJobs}
                onCancel={cancelJob}
                onPause={pauseJob}
                onResume={resumeJob}
                onRemove={removeJob}
                onOpenDetails={handleOpenGame}
                onClearCompleted={clearCompleted}
                onCleanTemp={handleCleanTemp}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Overview Content ────────────────────────────────────────────────────────

type OverviewContentProps = {
  activeJobs: DownloadJob[];
  interruptedDebrid: DownloadJob[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenDetails: (appId: string) => void;
};

function OverviewContent({
  activeJobs,
  interruptedDebrid,
  onPause,
  onResume,
  onCancel,
  onRemove,
  onOpenDetails,
}: OverviewContentProps) {
  if (activeJobs.length === 0 && interruptedDebrid.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
          <Upload className="h-7 w-7 text-(--color-muted)" />
        </div>
        <p className="text-base font-semibold text-(--color-text)">No hay descargas activas</p>
        <p className="mt-2 max-w-sm text-sm text-(--color-muted)">
          Instala un juego o paquete desde la Tienda para ver su progreso aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="space-y-5">
        {activeJobs.map((job) => (
          <ActiveDownloadRow
            key={job.id}
            job={job}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
          />
        ))}

        {interruptedDebrid.length > 0 && (
          <>
            <p className="pt-2 text-[11px] font-medium uppercase tracking-wider text-(--color-muted)/60">
              Interrumpidas
            </p>
            {interruptedDebrid.map((job) => (
              <DownloadJobCard
                key={job.id}
                job={job}
                onCancel={onCancel}
                onPause={onPause}
                onResume={onResume}
                onRemove={onRemove}
                onOpenDetails={onOpenDetails}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── History Content ─────────────────────────────────────────────────────────

type HistoryContentProps = {
  completedJobs: DownloadJob[];
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenDetails: (appId: string) => void;
  onClearCompleted: () => void;
  onCleanTemp?: (id: string) => void;
};

function HistoryContent({
  completedJobs,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onOpenDetails,
  onClearCompleted,
  onCleanTemp,
}: HistoryContentProps) {
  if (completedJobs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
          <History className="h-7 w-7 text-(--color-muted)" />
        </div>
        <p className="text-base font-semibold text-(--color-text)">Sin historial</p>
        <p className="mt-2 max-w-sm text-sm text-(--color-muted)">
          Las descargas completadas y fallidas apareceran aqui.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ── Fixed header with clear button ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-(--surface-active-border)/50 px-6 py-3">
        <p className="text-xs font-medium text-(--color-muted)">
          {completedJobs.length} {completedJobs.length === 1 ? "entrada" : "entradas"}
        </p>
        <button
          type="button"
          onClick={onClearCompleted}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
        >
          <Trash2 className="h-3 w-3" />
          Limpiar historial
        </button>
      </div>

      {/* ── Scrollable list ── */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {completedJobs.map((job) => (
            <DownloadJobCard
              key={job.id}
              job={job}
              onCancel={onCancel}
              onPause={onPause}
              onResume={onResume}
              onRemove={onRemove}
              onOpenDetails={onOpenDetails}
              onCleanTemp={onCleanTemp}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Active Download Row (moved from Downloads.tsx) ─────────────────────────

type ActiveDownloadRowProps = {
  job: DownloadJob;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
};

function ActiveDownloadRow({ job, onPause, onResume, onCancel }: ActiveDownloadRowProps) {
  const download = useActiveDownload(job);
  return (
    <ActiveDownloadCard
      download={download}
      onPause={onPause}
      onResume={onResume}
      onCancel={onCancel}
    />
  );
}
