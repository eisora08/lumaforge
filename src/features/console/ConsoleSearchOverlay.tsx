import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { Search, X, Gamepad2 } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleInputHintStyle } from "./consoleSettings";
import { getConsoleInputHints } from "./consoleInputHints";
import { getConsoleCardSrc } from "./consoleMedia";

const FADE_DURATION = 180;

type Props = {
  open: boolean;
  games: LibraryGame[];
  onClose: () => void;
  onSelectGame: (game: LibraryGame) => void;
  inputHints: ConsoleInputHintStyle;
};

/* ── Search scoring ── */
type Scored = { game: LibraryGame; score: number; reason: string };

function scoreGame(game: LibraryGame, query: string): Scored | null {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const title = (game.title ?? "").toLowerCase();
  const appId = (game.appId ?? "").toLowerCase();
  const dev = (game.metadata?.developer ?? "").toLowerCase();
  const pubs = (game.metadata?.publishers ?? []).join(" ").toLowerCase();
  const genres = (game.metadata?.genres ?? []).join(" ").toLowerCase();

  // 1. Exact title startsWith
  if (title.startsWith(q)) {
    return { game, score: 100, reason: "title-starts-with" };
  }
  // 2. Title includes
  if (title.includes(q)) {
    return { game, score: 80, reason: "title-includes" };
  }
  // 3. appId match
  if (appId.includes(q)) {
    return { game, score: 60, reason: "appid-match" };
  }
  // 4. Developer / publisher match
  if (dev.includes(q) || pubs.includes(q)) {
    return { game, score: 40, reason: "dev-publisher" };
  }
  // 5. Genre match
  if (genres.includes(q)) {
    return { game, score: 20, reason: "genre-match" };
  }
  return null;
}

function sortScored(a: Scored, b: Scored): number {
  if (a.score !== b.score) return b.score - a.score;
  return (a.game.title ?? "").localeCompare(b.game.title ?? "");
}

export default function ConsoleSearchOverlay({
  open, games, onClose, onSelectGame, inputHints,
}: Props) {
  const hints = useMemo(() => getConsoleInputHints(inputHints), [inputHints]);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Enter animation ── */
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [open]);

  /* ── Focus input and reset state on open ── */
  useEffect(() => {
    if (open) {
      setQuery("");
      setFocusIndex(0);
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  /* ── Search results ── */
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const scored: Scored[] = [];
    for (const game of games) {
      const s = scoreGame(game, q);
      if (s) scored.push(s);
    }
    scored.sort(sortScored);
    return scored.slice(0, 50).map((s) => s.game);
  }, [query, games]);

  /* ── Clamp focus index when results change ── */
  useEffect(() => {
    setFocusIndex((prev) => {
      if (results.length === 0) return 0;
      return Math.min(prev, results.length - 1);
    });
  }, [results.length]);

  const handleSelect = useCallback((game: LibraryGame) => {
    onSelectGame(game);
  }, [onSelectGame]);

  const handleClose = useCallback(() => {
    if (isOpenRef.current) onClose();
  }, [onClose]);

  /* ── Keyboard navigation ── */
  const isOpenRef = useRef(open);
  useEffect(() => {
    isOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (!isOpenRef.current) return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((i) => (i < results.length - 1 ? i + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((i) => (i > 0 ? i - 1 : results.length - 1));
          break;
        case "Enter":
          e.preventDefault();
          if (results.length > 0 && focusIndex >= 0 && focusIndex < results.length) {
            handleSelect(results[focusIndex]);
          }
          break;
        case "Escape":
        case "/":
          e.preventDefault();
          handleClose();
          break;
        case "y":
        case "Y":
          // Only close if input is empty (Y is a letter character too)
          if (!isInput || query.length === 0) {
            e.preventDefault();
            handleClose();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, results, focusIndex, handleSelect, handleClose, query]);

  const overlayOpacity = visible ? 1 : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search games"
      className="fixed inset-0 z-[200] flex items-start justify-center"
      style={{
        transition: `opacity ${FADE_DURATION}ms ease`,
        opacity: overlayOpacity,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        className="relative mt-[clamp(80px,10vh,160px)] w-[clamp(480px,50vw,720px)] max-h-[clamp(520px,70vh,680px)] flex flex-col rounded-2xl border border-(--color-border)/30 bg-(--color-surface)/90 shadow-2xl shadow-black/50 backdrop-blur-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        style={{
          transition: `transform ${FADE_DURATION}ms ease, opacity ${FADE_DURATION}ms ease`,
          transform: visible ? "translateY(0)" : "translateY(-12px)",
          opacity: overlayOpacity,
        }}
      >
        {/* ── Header: search input ── */}
        <div className="shrink-0 border-b border-(--color-border)/20 px-5 py-4">
          <div className="relative flex items-center gap-3">
            <Search className="h-5 w-5 shrink-0 text-(--color-muted)/50" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Start typing to search your library…"
              className="min-w-0 flex-1 bg-transparent text-lg font-medium text-(--color-text) placeholder:text-(--color-muted)/40 outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-(--color-muted)/60 hover:bg-white/[0.14] hover:text-(--color-muted) transition"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Results ── */}
        <div className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin scrollbar-thumb-(--color-border)/20">
          {query.trim().length === 0 ? (
            /* Empty query: prompt */
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Search className="h-10 w-10 text-(--color-muted)/20" />
              <p className="text-base text-(--color-muted)/50 font-medium">
                Start typing to search your library
              </p>
            </div>
          ) : results.length === 0 ? (
            /* No results */
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Gamepad2 className="h-10 w-10 text-(--color-muted)/20" />
              <p className="text-base text-(--color-muted)/60 font-medium">No games found</p>
              <p className="text-sm text-(--color-muted)/40">
                Try a different search term
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-3 rounded-lg bg-(--color-surface)/60 px-4 py-2 text-sm font-medium text-(--color-muted)/70 ring-1 ring-(--color-border)/30 hover:bg-(--color-surface) transition"
              >
                Clear search
              </button>
            </div>
          ) : (
            /* Results list */
            <div className="space-y-1">
              {results.map((game, i) => {
                const focused = focusIndex === i;
                const coverSrc = getConsoleCardSrc(game, "poster");
                const isInstalled = game.steamInstalled;
                const isLua = game.isLuaActive;

                return (
                  <button
                    key={game.appId ?? game.id}
                    type="button"
                    onMouseEnter={() => setFocusIndex(i)}
                    onClick={() => handleSelect(game)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-all duration-100 ${
                      focused
                        ? "bg-(--color-accent)/15 ring-1 ring-(--color-accent)/40"
                        : "hover:bg-(--color-surface)/40"
                    }`}
                  >
                    {/* Cover thumbnail */}
                    <div className="h-[56px] w-[40px] shrink-0 overflow-hidden rounded-lg bg-(--color-surface)/60 shadow-sm ring-1 ring-white/[0.04]">
                      {coverSrc ? (
                        <img
                          src={coverSrc}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
                          <Gamepad2 className="h-5 w-5 text-(--color-muted)/30" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold truncate ${
                        focused ? "text-(--color-text)" : "text-(--color-text)/90"
                      }`}>
                        {game.title}
                      </p>
                      <p className="text-xs text-(--color-muted)/60 mt-0.5 truncate">
                        {game.metadata?.developer
                          ? game.metadata.developer
                          : game.appId
                            ? `App ID: ${game.appId}`
                            : ""}
                      </p>
                    </div>

                    {/* Badges */}
                    <div className="flex shrink-0 gap-1.5">
                      {isInstalled && (
                        <span className="rounded-md bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-black">
                          Installed
                        </span>
                      )}
                      {isLua && (
                        <span className="rounded-md bg-violet-500/80 px-2 py-0.5 text-[10px] font-medium text-white">
                          Lua
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer hint bar ── */}
        <div className="shrink-0 border-t border-(--color-border)/20 px-5 py-3">
          <div className="flex items-center justify-center gap-4">
            <HintPill label={hints.select} primary />
            <HintPill label={hints.back} />
            <HintPill label={hints.navigate} />
            <HintPill label="[⌨] Type" />
          </div>
        </div>
      </div>
    </div>
  );
}

function HintPill({ label, primary }: { label: string; primary?: boolean }) {
  const m = label.match(/^\[(.+?)\]\s*(.*)$/);
  if (!m) return <span className="text-xs text-(--color-muted)/60">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)/70">
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
        primary
          ? "bg-(--color-accent) text-white"
          : "bg-white/[0.09] text-white/60"
      }`}>
        {m[1]}
      </span>
      <span>{m[2]}</span>
    </span>
  );
}
