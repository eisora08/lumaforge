import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  HardDrive,
  Trash2,
  Upload,
} from "lucide-react";

import ActiveDownloadCard from "../components/downloads/ActiveDownloadCard";
import DownloadJobCard from "../components/downloads/DownloadJobCard";
import { useDownloadQueue } from "../hooks/useDownloadQueue";
import { useActiveDownload } from "../hooks/useActiveDownload";
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

  const activeJobs = useMemo(() => jobs.filter((job) =>
    ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"].includes(job.status)
  ), [jobs]);

  // Failed Debrid downloads are shown in the active section so they can be
  // resumed from their on-disk checkpoint after a network interruption.
  const interruptedDebrid = useMemo(() => jobs.filter((job) =>
    job.type === "debrid-install" && job.status === "failed"
  ), [jobs]);

  const completedJobs = useMemo(() => jobs.filter((job) =>
    ["done", "failed", "cancelled"].includes(job.status) &&
    !(job.type === "debrid-install" && job.status === "failed")
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

      {/* ── Interrupted Debrid downloads (resumable) ── */}
      {interruptedDebrid.length > 0 && (
        <section className="space-y-4">
          <header>
            <h2 className="text-sm font-semibold text-(--color-text)">
              Descargas interrumpidas
            </h2>
            <p className="mt-1 text-xs text-(--color-muted)">
              La descarga se detuvo por un error de conexión. Reanuda para continuar desde donde quedó.
            </p>
          </header>
          {interruptedDebrid.map((job) => (
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

      {/* ── Completed/failed section (collapsible, below active) ── */}
      {completedJobs.length > 0 && (
        <>
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

          {!completedCollapsed && (
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
        </>
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

/**
 * Renders an active download job through the premium hero card.
 */
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