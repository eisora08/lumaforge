import {
  Download,
  ListChecks,
  PackageCheck,
  Trash2,
} from "lucide-react";

import DownloadJobCard from "../components/downloads/DownloadJobCard";
import { useDownloadQueue } from "../hooks/useDownloadQueue";

export default function Downloads() {
  const {
    jobs,
    cancelJob,
    removeJob,
    clearCompleted,
  } = useDownloadQueue();

  const activeJobs = jobs.filter((job) =>
    [
      "queued",
      "checking",
      "downloading",
      "extracting",
      "installing",
    ].includes(job.status)
  );

  const completedJobs = jobs.filter((job) =>
    ["done", "failed", "cancelled"].includes(job.status)
  );

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <Download className="h-3.5 w-3.5" />
            Download Manager
          </div>

          <h1 className="text-3xl font-bold text-(--color-text)">
            Descargas
          </h1>

          <p className="mt-2 max-w-2xl text-(--color-muted)">
            Administra la cola de descargas, progreso, instalación y estados de
            paquetes Lua, ZIP y manifests.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MiniStat
            icon={ListChecks}
            label="Activas"
            value={activeJobs.length}
          />

          <MiniStat
            icon={PackageCheck}
            label="Finalizadas"
            value={completedJobs.length}
          />

          <MiniStat
            icon={Download}
            label="Total"
            value={jobs.length}
          />
        </div>
      </header>

      <section className="lf-surface rounded-2xl border p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-(--color-text)">
              Cola de descargas
            </h2>

            <p className="mt-1 text-sm text-(--color-muted)">
              Los paquetes agregados desde el catálogo aparecerán aquí.
            </p>
          </div>

          <button
            type="button"
            onClick={clearCompleted}
            disabled={completedJobs.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            Limpiar completadas
          </button>
        </div>
      </section>

      {jobs.length === 0 ? (
        <section className="lf-surface rounded-2xl border p-10 text-center">
          <Download className="mx-auto h-10 w-10 text-(--color-muted)" />

          <h2 className="mt-4 font-semibold text-(--color-text)">
            No hay descargas todavía
          </h2>

          <p className="mt-2 text-sm text-(--color-muted)">
            Ve a Paquetes, selecciona una fuente y agrega un paquete a la cola.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          {jobs.map((job) => (
            <DownloadJobCard
              key={job.id}
              job={job}
              onCancel={cancelJob}
              onRemove={removeJob}
            />
          ))}
        </section>
      )}
    </div>
  );
}

type MiniStatProps = {
  icon: React.ElementType;
  label: string;
  value: string | number;
};

function MiniStat({ icon: Icon, label, value }: MiniStatProps) {
  return (
    <div className="lf-surface rounded-2xl border px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-(--color-accent)" />

        <span className="text-xs text-(--color-muted)">
          {label}
        </span>
      </div>

      <p className="mt-1 text-lg font-semibold text-(--color-text)">
        {value}
      </p>
    </div>
  );
}