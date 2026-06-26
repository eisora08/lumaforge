import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Search,
  XCircle,
} from "lucide-react";

import {
  ProviderSearchProviderReport,
  ProviderSearchStatus,
} from "../../types/providerSearch";

type ProviderSearchReportProps = {
  reports: ProviderSearchProviderReport[];
};

const statusConfig: Record<
  ProviderSearchStatus,
  {
    label: string;
    className: string;
    icon: typeof CheckCircle2;
  }
> = {
  searched: {
    label: "Consultado",
    className: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    icon: Search,
  },
  found: {
    label: "Encontrado",
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    icon: CheckCircle2,
  },
  "not-found": {
    label: "No encontrado",
    className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
    icon: CircleSlash,
  },
  disabled: {
    label: "Deshabilitado",
    className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    icon: AlertTriangle,
  },
  error: {
    label: "Error",
    className: "border-red-500/20 bg-red-500/10 text-red-300",
    icon: XCircle,
  },
};

export default function ProviderSearchReport({
  reports,
}: ProviderSearchReportProps) {
  return (
    <section className="lf-surface rounded-2xl border p-4">
      <div className="mb-3">
        <h2 className="font-semibold text-(--color-text)">
          Estado de providers
        </h2>

        <p className="mt-1 text-xs text-(--color-muted)">
          LumaForge consulta los providers habilitados y continúa aunque una
          fuente no tenga resultados.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {reports.map((report) => {
          const config = statusConfig[report.status];
          const Icon = config.icon;

          return (
            <div
              key={`${report.providerId}-${report.status}`}
              className={`rounded-xl border px-3 py-2 ${config.className}`}
              title={report.message}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5" />

                <span className="text-xs font-medium">
                  {report.providerName}
                </span>
              </div>

              <p className="mt-1 text-[11px] opacity-80">
                {config.label} · {report.resultCount} resultado
                {report.resultCount === 1 ? "" : "s"}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}