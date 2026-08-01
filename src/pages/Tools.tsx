import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Wrench, Shield, Disc3, Puzzle, Zap,
  CheckCircle2, XCircle, ChevronDown,
  RotateCcw, Trash2, Gamepad2, Package, Clock,
} from "lucide-react";

import { useLibraryGames } from "../context/LibraryGamesContext";
import type { LibraryGame } from "../types/libraryGame";
import type { ToolDetectionResult, AppliedFix, ToolId } from "../extensions/tools/types";
import {
  initToolManager,
  subscribeToolManager,
  getAllTools,
  detectToolsForGame,
  applyTool,
  revertTool,
  getAppliedFixes,
} from "../extensions/tools/ToolManager";
import type { Tool } from "../extensions/tools/types";
import { resolveAppDataDir } from "../services/tauri";
import { showError } from "../components/toast/GameToast";
import ConfirmModal from "../components/common/ConfirmModal";

// =============================================================================
// Helpers
// =============================================================================

const TOOL_ICONS: Record<string, React.ReactNode> = {
  goldberg: <Shield className="h-5 w-5" />,
  smokeapi: <Disc3 className="h-5 w-5" />,
  steamless: <Package className="h-5 w-5" />,
  onlinefix: <Zap className="h-5 w-5" />,
};

function getToolIcon(tool: Tool): React.ReactNode {
  if (tool.icon && TOOL_ICONS[tool.icon]) return TOOL_ICONS[tool.icon];
  if (tool.category === "emulator") return <Shield className="h-5 w-5" />;
  if (tool.category === "fix") return <Zap className="h-5 w-5" />;
  if (tool.category === "utility") return <Wrench className="h-5 w-5" />;
  return <Puzzle className="h-5 w-5" />;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// =============================================================================
// Component
// =============================================================================

export default function Tools() {
  const { games } = useLibraryGames();

  const [selectedGame, setSelectedGame] = useState<LibraryGame | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [detectionResults, setDetectionResults] = useState<Map<ToolId, ToolDetectionResult>>(new Map());
  const [detecting, setDetecting] = useState(false);
  const [applying, setApplying] = useState<ToolId | null>(null);
  const [reverting, setReverting] = useState<ToolId | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<AppliedFix[]>([]);
  const [allTools, setAllTools] = useState<Tool[]>([]);
  const [confirmRevert, setConfirmRevert] = useState<{ toolId: ToolId; toolName: string } | null>(null);
  const [extensionDir, setExtensionDir] = useState<string>("");

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Initialize tool manager
  useEffect(() => {
    initToolManager();
    const unsub = subscribeToolManager(() => {
      setAllTools(getAllTools());
      setAppliedFixes(getAppliedFixes());
    });
    setAllTools(getAllTools());
    setAppliedFixes(getAppliedFixes());

    // Resolve extension dir
    resolveAppDataDir().then((dir) => {
      setExtensionDir(`${dir}\\extensions`);
    }).catch(() => {});

    return unsub;
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Filter games for dropdown (installed games only)
  const installedGames = useMemo(() => {
    return games
      .filter((g) => g.steamInstalled || g.isInstalled)
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [games]);

  const filteredGames = useMemo(() => {
    if (!searchQuery.trim()) return installedGames;
    const q = searchQuery.toLowerCase();
    return installedGames.filter(
      (g) =>
        g.title?.toLowerCase().includes(q) ||
        g.appId?.includes(q) ||
        g.id?.toLowerCase().includes(q),
    );
  }, [installedGames, searchQuery]);

  // Detect tools for selected game
  useEffect(() => {
    if (!selectedGame?.installDir) {
      setDetectionResults(new Map());
      return;
    }

    let cancelled = false;
    setDetecting(true);

    detectToolsForGame(selectedGame.installDir).then((results) => {
      if (!cancelled) {
        setDetectionResults(results);
        setDetecting(false);
      }
    }).catch(() => {
      if (!cancelled) setDetecting(false);
    });

    return () => { cancelled = true; };
  }, [selectedGame?.installDir, allTools.length, appliedFixes.length]);

  // Handlers
  const handleApply = useCallback(async (tool: Tool) => {
    if (!selectedGame?.installDir || !extensionDir) {
      showError("No game selected or extension directory not resolved.");
      return;
    }

    setApplying(tool.id);
    try {
      await applyTool(tool.id, selectedGame.installDir, extensionDir, {
        gameId: selectedGame.id,
        appId: selectedGame.appId,
        gameTitle: selectedGame.title,
      });
      // Refresh detection
      const results = await detectToolsForGame(selectedGame.installDir);
      setDetectionResults(results);
      setAppliedFixes(getAppliedFixes());
    } catch (err) {
      showError(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(null);
    }
  }, [selectedGame, extensionDir]);

  const handleRevert = useCallback(async (toolId: ToolId) => {
    if (!selectedGame?.installDir) return;

    setReverting(toolId);
    try {
      await revertTool(toolId, selectedGame.installDir, selectedGame.id);
      const results = await detectToolsForGame(selectedGame.installDir);
      setDetectionResults(results);
      setAppliedFixes(getAppliedFixes());
    } catch (err) {
      showError(`Revert failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReverting(null);
    }
  }, [selectedGame]);

  // ── Render ──

  return (
    <div className="space-y-6 p-5 lg:p-7 lf-page-in">
      {/* ── Header ── */}
      <header>
        <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
          <Wrench className="h-3.5 w-3.5" /> Tools Manager
        </span>
        <h1 className="mt-3 text-3xl font-bold text-(--color-text)">Herramientas</h1>
        <p className="mt-2 text-(--color-muted)">
          Aplica herramientas de compatibilidad a tus juegos: emuladores, fixes y utilidades.
        </p>
      </header>

      {/* ── Game Selector ── */}
      <section className="lf-surface rounded-2xl border p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
          <Gamepad2 className="h-4 w-4 text-(--color-accent)" />
          Seleccionar juego
        </h2>

        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setDropdownOpen(!dropdownOpen);
              if (!dropdownOpen) {
                setTimeout(() => searchRef.current?.focus(), 50);
              }
            }}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-left text-sm transition hover:bg-white/10"
          >
            {selectedGame ? (
              <span className="flex items-center gap-2 text-(--color-text)">
                <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
                {selectedGame.title}
                {selectedGame.appId && (
                  <span className="text-xs text-(--color-muted)">#{selectedGame.appId}</span>
                )}
              </span>
            ) : (
              <span className="text-(--color-muted)">Click to select a game...</span>
            )}
            <ChevronDown className={`h-4 w-4 text-(--color-muted) transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-(--surface-active-border) bg-(--surface-bg) shadow-xl">
              <div className="border-b border-(--surface-active-border) p-2">
                <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                  <Search className="h-4 w-4 text-(--color-muted)" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search games..."
                    className="flex-1 bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredGames.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-(--color-muted)">
                    {installedGames.length === 0
                      ? "No installed games found."
                      : "No games match your search."}
                  </div>
                ) : (
                  filteredGames.map((game) => (
                    <button
                      key={game.id}
                      type="button"
                      onClick={() => {
                        setSelectedGame(game);
                        setDropdownOpen(false);
                        setSearchQuery("");
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10 ${
                        selectedGame?.id === game.id
                          ? "bg-(--color-accent)/15 text-(--color-accent)"
                          : "text-(--color-text)"
                      }`}
                    >
                      <Gamepad2 className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                      <span className="truncate">{game.title}</span>
                      {game.appId && (
                        <span className="ml-auto shrink-0 text-xs text-(--color-muted)">#{game.appId}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Tools Grid ── */}
      {selectedGame ? (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <Wrench className="h-4 w-4 text-(--color-accent)" />
            Herramientas disponibles
            {detecting && <span className="text-xs text-(--color-muted)">(detecting...)</span>}
          </h2>

          {allTools.length === 0 ? (
            <div className="lf-surface rounded-2xl border p-8 text-center">
              <Puzzle className="mx-auto mb-3 h-10 w-10 text-(--color-muted)" />
              <p className="text-sm text-(--color-muted)">
                No hay herramientas instaladas. Instala extensiones de herramientas desde el repositorio.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {allTools.map((tool) => {
                const detection = detectionResults.get(tool.id);
                const isApplied = detection?.applied ?? false;
                const isLoading = applying === tool.id || reverting === tool.id;

                return (
                  <div
                    key={tool.id}
                    className="lf-surface flex flex-col rounded-2xl border p-5"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-accent)/10 text-(--color-accent)">
                        {getToolIcon(tool)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-(--color-text)">{tool.displayName}</h3>
                        <p className="mt-0.5 line-clamp-2 text-xs text-(--color-muted)">{tool.description}</p>
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="mb-4">
                      {isApplied ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Applied
                        </span>
                      ) : detection ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-(--color-muted)">
                          <XCircle className="h-3 w-3" /> Not applied
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-(--color-muted)">
                          <Clock className="h-3 w-3" /> Unknown
                        </span>
                      )}
                    </div>

                    {/* File details */}
                    {detection && Object.keys(detection.fileStatus).length > 0 && (
                      <div className="mb-4 rounded-lg bg-white/5 p-2.5">
                        <p className="mb-1.5 text-[10px] font-medium uppercase text-(--color-muted)">Files</p>
                        <div className="space-y-1">
                          {Object.entries(detection.fileStatus).map(([file, present]) => (
                            <div key={file} className="flex items-center gap-1.5 text-xs">
                              {present ? (
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-400" />
                              )}
                              <span className={present ? "text-(--color-text)" : "text-(--color-muted)"}>
                                {file}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-auto flex gap-2">
                      {isApplied ? (
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => setConfirmRevert({ toolId: tool.id, toolName: tool.displayName })}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {reverting === tool.id ? "Reverting..." : "Revert"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isLoading || !extensionDir}
                          onClick={() => handleApply(tool)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:opacity-50"
                        >
                          <Zap className="h-3.5 w-3.5" />
                          {applying === tool.id ? "Applying..." : "Apply"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <div className="lf-surface rounded-2xl border p-8 text-center">
          <Gamepad2 className="mx-auto mb-3 h-10 w-10 text-(--color-muted)" />
          <p className="text-sm text-(--color-muted)">
            Selecciona un juego para ver y aplicar herramientas.
          </p>
        </div>
      )}

      {/* ── Applied Fixes History ── */}
      {appliedFixes.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Applied Fixes ({appliedFixes.length})
          </h2>

          <div className="lf-surface rounded-2xl border overflow-hidden">
            <div className="divide-y divide-(--surface-active-border)">
              {appliedFixes.map((fix) => (
                <div
                  key={`${fix.toolId}:${fix.gameId}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-(--color-text)">
                      {fix.toolName}
                      <span className="mx-1.5 text-(--color-muted)">→</span>
                      {fix.gameTitle}
                    </p>
                    <p className="text-xs text-(--color-muted)">
                      {fix.files.length} file{fix.files.length !== 1 ? "s" : ""} · {formatTimestamp(fix.appliedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmRevert({ toolId: fix.toolId, toolName: fix.toolName })}
                    className="shrink-0 rounded-lg p-1.5 text-(--color-muted) transition hover:bg-white/10 hover:text-red-400"
                    title="Revert this fix"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Confirm Revert Modal ── */}
      <ConfirmModal
        open={!!confirmRevert}
        title={`Revert ${confirmRevert?.toolName ?? ""}`}
        description={`This will remove the tool files from ${selectedGame?.title ?? "the game"} and restore the originals if backups exist.`}
        confirmLabel="Revert"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={() => {
          if (confirmRevert) {
            handleRevert(confirmRevert.toolId);
          }
          setConfirmRevert(null);
        }}
        onCancel={() => setConfirmRevert(null)}
      />
    </div>
  );
}
