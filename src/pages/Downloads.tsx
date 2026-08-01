import { useCallback, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  HardDrive,
  ListChecks,
  PackageCheck,
  PackageX,
  Trash2,
  Upload,
} from "lucide-react";

import ActiveDownloadCard from "../components/downloads/ActiveDownloadCard";
import DownloadJobCard from "../components/downloads/DownloadJobCard";
import { useDownloadQueue } from "../hooks/useDownloadQueue";
import {
  useActiveDownload,
  MOCK_ACTIVE_DOWNLOAD,
  type ActiveDownload,
} from "../hooks/useActiveDownload";
import { useLibraryGames } from "../context/LibraryGamesContext";
import type { AppPage } from "../types/navigation";
import { getBootSnapshot } from "../services/appBootCoordinator";
import type { DownloadJob } from "../types/download";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function Downloads({ onNavigate }: Props) {
  const {
    jobs,
    cancelJob,
    pauseJob,
    resumeJob,
    removeJob,
    clearCompleted,
  } = useDownloadQueue();
  const { setSelectedGame, games } = useLibraryGames();

  function handleOpenGame(appId: string) {
    let game = games.find(g => g.appId === appId || g.id.endsWith(`-${appId}`));
    if (game) {
      setSelectedGame(game);
      onNavigate?.("library-game-detail");
      return;
    }
    const snapshot = getBootSnapshot();
    const snapshotGame = snapshot?.library.games.find(
      g => g.appId === appId || g.appId.endsWith(`-${appId}`)
    );
    if (snapshotGame) {
      game = games.find(g => g.appId === snapshotGame.appId || g.id.endsWith(`-${snapshotGame.appId}`));
      if (game) {
        setSelectedGame(game);
        onNavigate?.("library-game-detail");
        return;
      }
    }
  }

  const [completedCollapsed, setCompletedCollapsed] = useState(true);

  const mockPreview = useMockDownloadPreview();

  const activeJobs = useMemo(() => jobs.filter((job) =>
    ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"].includes(job.status)
  ), [jobs]);

  const completedJobs = useMemo(() => jobs.filter((job) =>
    ["done", "failed", "cancelled"].includes(job.status)
  ), [jobs]);

  const failedJobs = useMemo(() => jobs.filter((job) =>
    job.status === "failed"
  ), [jobs]);

  const queuedJobs = useMemo(() => jobs.filter((job) =>
    job.status === "queued" || job.status === "waiting"
  ), [jobs]);

  return (
    <div className="space-y-6 p-5 lg:p-7 lf-page-in">
      {/* ── Header ── */}
      <header>
        <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
          <Download className="h-3.5 w-3.5" />
          Download Manager
        </span>

        <h1 className="mt-3 text-3xl font-bold text-(--color-text)">
          Descargas
        </h1>

        <p className="mt-2 text-(--color-muted)">
          Gestiona instalaciones de Steam, paquetes Lua, ZIP y manifests.
        </p>
      </header>

      {/* ── Dev-only premium preview (mock, with working controls) ── */}
      {import.meta.env.DEV && (
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-(--color-muted)">
            Vista previa (mock)
          </p>
          <ActiveDownloadCard
            download={mockPreview.mock}
            onPause={mockPreview.onPause}
            onResume={mockPreview.onResume}
            onCancel={mockPreview.onCancel}
          />
        </section>
      )}

      {/* ── Status summary — single segmented surface ── */}
      <div className="lf-surface rounded-2xl border p-2">
        <div className="grid grid-cols-2 gap-y-2 md:grid-cols-4 md:gap-y-0 md:divide-x md:divide-(--surface-active-border)">
          <StatusStat icon={Download} label="Activas" value={activeJobs.length} />
          <StatusStat icon={ListChecks} label="En cola" value={queuedJobs.length} />
          <StatusStat icon={PackageCheck} label="Completadas" value={completedJobs.length} />
          <StatusStat icon={PackageX} label="Fallidas" value={failedJobs.length} />
        </div>
      </div>

      {/* ── Clear history bar ── */}
      {jobs.length > 0 && completedJobs.length > 0 && (
        <section className="lf-surface rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCompletedCollapsed((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-(--color-text) transition hover:text-(--color-accent)"
            >
              {completedCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              Completadas y fallidas ({completedJobs.length})
            </button>

            <button
              type="button"
              onClick={clearCompleted}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
            >
              <Trash2 className="h-4 w-4" />
              Limpiar historial
            </button>
          </div>
        </section>
      )}

      {/* ── Active download queue ── */}
      {activeJobs.length > 0 && (
        <section className="space-y-4">
          {activeJobs.map((job) => (
            <ActiveDownloadRow
              key={job.id}
              job={job}
              onPause={pauseJob}
              onResume={resumeJob}
              onCancel={cancelJob}
            />
          ))}
        </section>
      )}

      {/* ── Completed section (collapsible) ── */}
      {completedJobs.length > 0 && !completedCollapsed && (
        <section className="space-y-4">
          {completedJobs.map((job) => (
            <DownloadJobCard
              key={job.id}
              job={job}
              onCancel={cancelJob}
              onPause={pauseJob}
              onResume={resumeJob}
              onRemove={removeJob}
              onOpenDetails={handleOpenGame}
            />
          ))}
        </section>
      )}

      {/* ── Empty state ── */}
      {jobs.length === 0 && (
        <section className="lf-surface rounded-2xl border p-14 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
            <Upload className="h-8 w-8 text-(--color-muted)" />
          </div>

          <h2 className="text-xl font-semibold text-(--color-text)">
            No hay descargas activas
          </h2>

          <p className="mx-auto mt-3 max-w-md text-sm text-(--color-muted)">
            Instala un juego de Steam o agrega un paquete Lua, ZIP o manifest
            desde Paquetes para ver su progreso aqu\u00ed.
          </p>

          <a
            href="#/library"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90"
          >
            <HardDrive className="h-4 w-4" />
            Explorar biblioteca
          </a>
        </section>
      )}
    </div>
  );
}

type StatusStatProps = {
  icon: React.ElementType;
  label: string;
  value: string | number;
};

function StatusStat({ icon: Icon, label, value }: StatusStatProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 md:justify-center">
      <Icon className="h-4 w-4 shrink-0 text-(--color-accent)" />

      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none text-(--color-text)">
          {value}
        </p>

        <p className="mt-1 text-[11px] text-(--color-muted)">
          {label}
        </p>
      </div>
    </div>
  );
}

/**
 * Dev-only: drives the mock preview's Pausar / Reanudar / Cancelar buttons so
 * the controls are visibly wired even before a real download is running.
 */
function useMockDownloadPreview(): {
  mock: ActiveDownload;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
} {
  const [paused, setPaused] = useState(false);

  const mock = useMemo<ActiveDownload>(
    () => ({
      ...MOCK_ACTIVE_DOWNLOAD,
      status: paused ? "paused" : "downloading",
      message: paused ? "Descarga pausada" : MOCK_ACTIVE_DOWNLOAD.message,
    }),
    [paused]
  );

  const onPause = useCallback(() => setPaused(true), []);
  const onResume = useCallback(() => setPaused(false), []);
  const onCancel = useCallback(() => setPaused(false), []);

  return { mock, onPause, onResume, onCancel };
}

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