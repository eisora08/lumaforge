import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Gamepad2,
  Info,
  Package,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
  Square,
} from "lucide-react";
import type { GameActivityItem } from "../../types/gameActivity";

type ActivityCardProps = {
  activity: GameActivityItem;
  compact?: boolean;
};

const KIND_ICONS: Record<string, typeof Info> = {
  "game-detected": Gamepad2,
  "game-installed": Download,
  "game-launched": Gamepad2,
  "game-closed": Square,
  "lua-installed": Package,
  "lua-synced": Upload,
  "lua-updated": RefreshCw,
  "lua-disabled": ShieldCheck,
  "lua-enabled": ShieldCheck,
  "source-selected": Info,
  "metadata-refreshed": RefreshCw,
  "artwork-refreshed": RefreshCw,
  "dlc-detected": Package,
  "local-file-change": Info,
};

const SOURCE_COLORS: Record<string, string> = {
  local: "border-slate-500/20 bg-slate-500/10 text-slate-300",
  steam: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  lua: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  provider: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  system: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "text-blue-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-red-400",
};

const SOURCE_LABELS: Record<string, string> = {
  local: "Local",
  steam: "Steam",
  lua: "Lua",
  provider: "Provider",
  system: "System",
};

function formatTimestamp(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ActivityCard({ activity, compact }: ActivityCardProps) {
  const Icon = KIND_ICONS[activity.kind] || Info;

  if (compact) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-white/[0.04]">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 ${
            activity.severity && SEVERITY_COLORS[activity.severity]
              ? SEVERITY_COLORS[activity.severity]
              : "text-(--color-muted)"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-(--color-text) truncate">{activity.title}</div>
        </div>
        <span className="shrink-0 text-[10px] text-(--color-muted)">{formatTimestamp(activity.createdAt)}</span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-4 transition hover:border-white/15 hover:bg-white/[0.06]">
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 ${
          activity.severity && SEVERITY_COLORS[activity.severity]
            ? SEVERITY_COLORS[activity.severity]
            : "text-(--color-muted)"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-(--color-text)">
            {activity.title}
          </h3>
          <span className="shrink-0 text-[11px] text-(--color-muted)">
            {formatTimestamp(activity.createdAt)}
          </span>
        </div>

        {activity.description && (
          <p className="mt-1 text-xs leading-relaxed text-(--color-muted)">
            {activity.description}
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[activity.source] || "border-white/10 bg-white/[0.04] text-(--color-muted)"}`}>
            {SOURCE_LABELS[activity.source] || activity.source}
          </span>
          {activity.severity && activity.severity !== "info" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                activity.severity === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : activity.severity === "warning"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    : activity.severity === "error"
                      ? "border-red-500/20 bg-red-500/10 text-red-300"
                      : ""
              }`}
            >
              {activity.severity === "success" && (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {activity.severity === "warning" && (
                <AlertTriangle className="h-3 w-3" />
              )}
              {activity.severity === "error" && (
                <XCircle className="h-3 w-3" />
              )}
              {activity.severity.charAt(0).toUpperCase() +
                activity.severity.slice(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
