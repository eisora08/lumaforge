import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  FolderOpen,
  FileUp,
  Check,
  Monitor,
  RefreshCw,
} from "lucide-react";
import {
  scanInstalledPrograms,
  scanLocalGames,
  pickFile,
  pickFolder,
} from "../../services/tauri";
import type { InstalledProgram } from "../../services/tauri";

export type ScannedProgram = {
  name: string;
  exePath: string;
  installPath: string;
  displayIcon?: string;
  selected: boolean;
  source: "registry" | "file-picker" | "folder-scan";
};

type GameScannerModalProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (programs: ScannedProgram[]) => void;
};

const GLASS = "bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl";
const ROW_HOVER = "hover:bg-white/[0.06] transition-colors";
const ROW_SELECTED = "bg-(--color-accent)/10 border border-(--color-accent)/30";

function formatSize(kb?: number): string {
  if (!kb) return "";
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function programToScanned(
  p: InstalledProgram,
  source: ScannedProgram["source"]
): ScannedProgram {
  return {
    name: p.name,
    exePath: p.exePath ?? "",
    installPath: p.installPath,
    displayIcon: p.displayIcon,
    selected: false,
    source,
  };
}

export default function GameScannerModal({ open, onClose, onAdd }: GameScannerModalProps) {
  const [programs, setPrograms] = useState<ScannedProgram[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Load registry programs on mount
  useEffect(() => {
    if (!open) return;
    setPrograms([]);
    setQuery("");
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const installed = await scanInstalledPrograms();
        if (cancelled) return;
        setPrograms(installed.map((p) => programToScanned(p, "registry")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Live filter
  const filtered = useMemo(() => {
    if (!query.trim()) return programs;
    const q = query.toLowerCase();
    return programs.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.exePath.toLowerCase().includes(q) ||
        p.installPath.toLowerCase().includes(q)
    );
  }, [programs, query]);

  const selectedCount = programs.filter((p) => p.selected).length;

  // Browse: pick single exe
  const handleBrowse = async () => {
  const file = await pickFile("Select executable", [
    { name: "Executables", extensions: ["exe"] },
  ]);
  if (!file) return;
  const exePath = file as string;
  const lastSep = Math.max(exePath.lastIndexOf("\\"), exePath.lastIndexOf("/"));
  const rawName = lastSep >= 0 ? exePath.substring(lastSep + 1) : exePath;
  const name = rawName.replace(/\.exe$/i, "") || "Unknown";
    setPrograms([
      {
        name,
        exePath,
        installPath: exePath.substring(0, Math.max(exePath.lastIndexOf("\\"), exePath.lastIndexOf("/"))),
        selected: true,
        source: "file-picker",
      },
    ]);
    setQuery("");
  };

  // Select Folder: scan folder for exes
  const handleFolder = async () => {
    const folder = await pickFolder("Select folder to scan");
    if (!folder) return;
    setLoading(true);
    try {
      const discovered = await scanLocalGames({ folders: [folder] });
      setPrograms(
        discovered.map((d) => ({
          name: d.fileName,
          exePath: d.exePath,
          installPath: d.dirName,
          selected: false,
          source: "folder-scan" as const,
        }))
      );
      setQuery("");
    } finally {
      setLoading(false);
    }
  };

  // Toggle selection
  const toggle = (index: number) => {
    setPrograms((prev) =>
      prev.map((p, i) => (i === index ? { ...p, selected: !p.selected } : p))
    );
  };

  // Add selected
  const handleAdd = () => {
    const selected = programs.filter((p) => p.selected);
    if (selected.length > 0) onAdd(selected);
  };

  // Escape to close
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`${GLASS} flex w-full max-w-[680px] flex-col overflow-hidden shadow-2xl shadow-black/50`}
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-base font-semibold text-white">
            Add games to your library
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-5 pb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search programs..."
              className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.06] pl-8 pr-3 text-xs text-white placeholder:text-white/30 outline-none transition focus:border-(--color-accent)/50 focus:bg-white/[0.08]"
            />
          </div>
          <button
            onClick={handleBrowse}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <FileUp className="h-3.5 w-3.5" />
            Browse
          </button>
          <button
            onClick={handleFolder}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Select Folder
          </button>
        </div>

        {/* Divider */}
        <div className="mx-5 border-t border-white/[0.08]" />

        {/* Program list */}
        <div className="flex-1 overflow-y-auto px-5 py-2" style={{ minHeight: 200 }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/40">
              <RefreshCw className="mb-2 h-5 w-5 animate-spin" />
              <span className="text-xs">Scanning programs...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/40">
              <Monitor className="mb-2 h-5 w-5" />
              <span className="text-xs">
                {query ? "No programs match your search" : "No programs found"}
              </span>
            </div>
          ) : (
            <>
              <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-white/30">
                {filtered.length} program{filtered.length !== 1 ? "s" : ""} found
              </div>
              {filtered.map((program, i) => {
                const globalIndex = programs.indexOf(program);
                return (
                  <button
                    key={`${program.source}-${program.name}-${i}`}
                    type="button"
                    onClick={() => toggle(globalIndex)}
                    className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      program.selected ? ROW_SELECTED : ROW_HOVER
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors ${
                        program.selected
                          ? "border-(--color-accent) bg-(--color-accent)"
                          : "border-white/20 bg-white/[0.04]"
                      }`}
                    >
                      {program.selected && (
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      )}
                    </div>

                    {/* Icon placeholder */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
                      <Monitor className="h-4 w-4 text-white/30" />
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-white">
                        {program.name}
                      </div>
                      <div className="truncate text-[11px] text-white/40">
                        {program.exePath || program.installPath}
                      </div>
                    </div>

                    {/* Size (registry only) */}
                    {program.source === "registry" && programs.find((p) => p === program) && (
                      <span className="shrink-0 text-[10px] text-white/25">
                        {formatSize(
                          (program as ScannedProgram & { _size?: number })._size as number | undefined
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Divider */}
        <div className="mx-5 border-t border-white/[0.08]" />

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs text-white/40">
            {selectedCount > 0
              ? `${selectedCount} selected`
              : "Select programs to add"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={selectedCount === 0}
              className="rounded-lg bg-(--color-accent) px-3.5 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add{selectedCount > 0 ? ` ${selectedCount}` : ""} game{selectedCount !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
