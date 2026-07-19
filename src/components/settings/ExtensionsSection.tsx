/**
 * ExtensionsSection — Standalone Settings component.
 *
 * Shows the RuntimeStore snapshot: overview counts, extension list,
 * enable/disable toggles. Pure in-memory reads — no networking,
 * no repository lookups, no disk I/O.
 */

import { useEffect, useState, useCallback } from "react";
import { Puzzle, CheckCircle, XCircle, AlertTriangle, Eye, EyeOff, Info } from "lucide-react";
import SettingsSection from "./SettingsSection";
import {
  snapshot,
  enableExtension,
  disableExtension,
  addListener,
  type ExtensionRuntimeRecord,
  type ExtensionRuntimeSnapshot,
} from "../../extensions/runtime";

// =============================================================================
// Helpers
// =============================================================================

function statusLabel(status: ExtensionRuntimeRecord["status"]): string {
  switch (status) {
    case "enabled": return "Enabled";
    case "available": return "Available";
    case "disabled": return "Disabled";
    case "incompatible": return "Incompatible";
    case "invalid": return "Invalid";
    case "error": return "Error";
    case "registered": return "Registered";
    default: return status;
  }
}

function statusColor(status: ExtensionRuntimeRecord["status"]): string {
  switch (status) {
    case "enabled": return "text-emerald-400";
    case "available": return "text-sky-400";
    case "disabled": return "text-zinc-500";
    case "incompatible": return "text-amber-400";
    case "invalid":
    case "error": return "text-rose-400";
    default: return "text-zinc-400";
  }
}

function statusIcon(status: ExtensionRuntimeRecord["status"]) {
  switch (status) {
    case "enabled": return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    case "incompatible": return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "invalid":
    case "error": return <XCircle className="h-4 w-4 text-rose-400" />;
    default: return <Info className="h-4 w-4 text-zinc-500" />;
  }
}

// =============================================================================
// Component
// =============================================================================

export default function ExtensionsSection() {
  const [snap, setSnap] = useState<ExtensionRuntimeSnapshot>(() => snapshot());

  useEffect(() => {
    return addListener(() => {
      setSnap(snapshot());
    });
  }, []);

  const handleToggle = useCallback((record: ExtensionRuntimeRecord) => {
    if (record.status === "enabled") {
      disableExtension(record.manifest.id);
    } else if (record.status === "available" || record.status === "registered") {
      enableExtension(record.manifest.id);
    }
  }, []);

  return (
    <SettingsSection
      title="Extensions"
      description="Manage installed extensions and their active contributions."
    >
      {/* Overview counts */}
      <div className="mb-5 grid grid-cols-5 gap-3">
        <StatCard label="Total" value={snap.total} />
        <StatCard label="Enabled" value={snap.enabledCount} color="text-emerald-400" />
        <StatCard label="Disabled" value={snap.disabledCount} color="text-zinc-500" />
        <StatCard label="Incompatible" value={snap.incompatibleCount} color="text-amber-400" />
        <StatCard label="Invalid" value={snap.invalidCount} color="text-rose-400" />
      </div>

      {/* Extension list */}
      {snap.total === 0 ? (
        <div className="py-8 text-center text-sm text-(--color-muted)">
          No extensions registered.
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(snap.records.values()).map((record) => (
            <ExtensionRow
              key={record.manifest.id}
              record={record}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* Footer info */}
      <p className="mt-4 text-xs text-(--color-muted)">
        Extensions are registered declaratively. Enable or disable to control
        which contributions are active in LumaForge.
      </p>
    </SettingsSection>
  );
}

// =============================================================================
// Stat Card
// =============================================================================

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="lf-surface rounded-xl border p-3 text-center">
      <div className={`text-xl font-bold ${color ?? "text-(--color-text)"}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-(--color-muted)">{label}</div>
    </div>
  );
}

// =============================================================================
// Extension Row
// =============================================================================

function ExtensionRow({
  record,
  onToggle,
}: {
  record: ExtensionRuntimeRecord;
  onToggle: (r: ExtensionRuntimeRecord) => void;
}) {
  const canToggle =
    record.validation.valid &&
    record.compatibility.compatible &&
    (record.status === "enabled" || record.status === "available" || record.status === "registered");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 transition hover:bg-white/[0.04]">
      {/* Icon / Status */}
      <div className="flex-shrink-0">
        {statusIcon(record.status)}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-(--color-text)">
            {record.manifest.displayName}
          </span>
          <span className="text-[10px] font-mono text-(--color-muted)">
            v{record.manifest.version}
          </span>
          {record.builtIn && (
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-medium text-sky-400">
              Built-in
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-(--color-muted)">
          {record.manifest.description}
        </p>
        {record.validation.errors.length > 0 && (
          <p className="mt-1 text-[10px] text-rose-400">
            {record.validation.errors[0]}
          </p>
        )}
        {!record.compatibility.compatible && record.compatibility.reasons.length > 0 && (
          <p className="mt-1 text-[10px] text-amber-400">
            {record.compatibility.reasons[0]}
          </p>
        )}
      </div>

      {/* Status label */}
      <span className={`flex-shrink-0 text-xs font-medium ${statusColor(record.status)}`}>
        {statusLabel(record.status)}
      </span>

      {/* Toggle */}
      <button
        onClick={() => onToggle(record)}
        disabled={!canToggle}
        className="flex-shrink-0 rounded-lg p-1.5 text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text) disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--color-muted)"
        title={record.status === "enabled" ? "Disable extension" : "Enable extension"}
      >
        {record.status === "enabled"
          ? <EyeOff className="h-4 w-4" />
          : <Eye className="h-4 w-4" />
        }
      </button>
    </div>
  );
}
