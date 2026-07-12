import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { Search, X, Gamepad2 } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleInputHintStyle } from "./consoleSettings";
import { getConsoleInputHints } from "./consoleInputHints";
import { getConsoleCardSrc } from "./consoleMedia";
import ConsoleVirtualKeyboard, { VIRTUAL_KEYS } from "./ConsoleVirtualKeyboard";
import type { VirtualKeyDef } from "./ConsoleVirtualKeyboard";
import { useConsoleGamepadInput } from "./useConsoleGamepadInput";

/* ── Debug flags ── */
const DEBUG_SEARCH_KEYBOARD = false;
const DEBUG_SEARCH_INPUT = false;

/* ── Direct gamepad connection check (no module flag dependency) ── */
function isAnyGamepadConnected(): boolean {
  try {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return false;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) return true;
    }
    return false;
  } catch {
    return false;
  }
}

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

  if (title.startsWith(q)) return { game, score: 100, reason: "title-starts-with" };
  if (title.includes(q)) return { game, score: 80, reason: "title-includes" };
  if (appId.includes(q)) return { game, score: 60, reason: "appid-match" };
  if (dev.includes(q) || pubs.includes(q)) return { game, score: 40, reason: "dev-publisher" };
  if (genres.includes(q)) return { game, score: 20, reason: "genre-match" };
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
  const [focusMode, setFocusMode] = useState<"keyboard" | "results">("results");
  const [keyboardRow, setKeyboardRow] = useState(0);
  const [keyboardCol, setKeyboardCol] = useState(0);
  const [gamepadDetected, setGamepadDetectedState] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Refs for event handler (avoids stale closures and handler re-registration) ── */
  const keyboardRowRef = useRef(0);
  const keyboardColRef = useRef(0);
  const focusModeRef = useRef<"keyboard" | "results">("results");
  const focusIndexRef = useRef(0);
  const gamepadDetectedRef = useRef(false);
  const resultsRef = useRef<LibraryGame[]>([]);
  const queryRef = useRef("");

  useEffect(() => { keyboardRowRef.current = keyboardRow; }, [keyboardRow]);
  useEffect(() => { keyboardColRef.current = keyboardCol; }, [keyboardCol]);
  useEffect(() => { focusModeRef.current = focusMode; }, [focusMode]);
  useEffect(() => { focusIndexRef.current = focusIndex; }, [focusIndex]);
  useEffect(() => { gamepadDetectedRef.current = gamepadDetected; }, [gamepadDetected]);
  useEffect(() => { queryRef.current = query; }, [query]);

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

  /* ── resultsRef must be AFTER results decl ── */
  useEffect(() => { resultsRef.current = results; }, [results]);

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
      setKeyboardRow(0);
      setKeyboardCol(0);
      const connected = isAnyGamepadConnected();
      if (DEBUG_SEARCH_KEYBOARD) {
        console.log(`[CONSOLE_SEARCH][OPEN] open=${open} gamepadConnected=${connected} focusMode=${connected ? "keyboard" : "results"} query=""`);
      }
      setGamepadDetectedState(connected);
      setFocusMode(connected ? "keyboard" : "results");
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  /* ── Gamepad input ownership: active while search is open ── */
  useConsoleGamepadInput(open);

  /* ── Keyboard visibility diagnostic ── */
  useEffect(() => {
    if (open && DEBUG_SEARCH_KEYBOARD) {
      console.log(`[CONSOLE_SEARCH][KEYBOARD_VISIBLE] visible=${focusMode === "keyboard"} gamepadDetected=${gamepadDetected} focusMode=${focusMode} rows=${VIRTUAL_KEYS.length}`);
    }
  }, [open, focusMode, gamepadDetected]);

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

  /* ── Keyboard navigation helpers (stable, use functional updaters) ── */
  const handleKeyboardPress = useCallback((key: VirtualKeyDef) => {
    switch (key.action) {
      case "char":
        setQuery((prev) => prev + (key.char ?? key.label.toLowerCase()));
        break;
      case "space":
        setQuery((prev) => prev + " ");
        break;
      case "backspace":
        setQuery((prev) => prev.slice(0, -1));
        break;
      case "clear":
        setQuery("");
        break;
      case "done":
        setFocusMode("results");
        break;
    }
  }, []);

  /* ── Open ref for async safety ── */
  const isOpenRef = useRef(open);
  useEffect(() => { isOpenRef.current = open; }, [open]);

  /* ═══════════════════════════════════════════════════════════════════
   *  WINDOW KEYDOWN HANDLER
   *
   *  Registered ONCE per open/close — deps array is just [open].
   *  All navigational state read from refs (keyboardRowRef,
   *  keyboardColRef, focusModeRef, focusIndexRef, gamepadDetectedRef,
   *  resultsRef) so the closure never goes stale.
   *
   *  Event dedup via timestamp prevents double-dispatch from
   *  useConsoleGamepadInput's polling loop.
   * ═══════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    if (!open) return;

    let lastKey = "";
    let lastTime = 0;

    const handler = (e: KeyboardEvent) => {
      /* ── Event dedup ── */
      if (e.key === lastKey && e.timeStamp - lastTime < 80) {
        if (DEBUG_SEARCH_KEYBOARD) {
          console.log(`[CONSOLE_KEYBOARD][SKIP_PREVENTED] key=${e.key} timeSince=${Math.round(e.timeStamp - lastTime)}ms`);
        }
        return;
      }
      lastKey = e.key;
      lastTime = e.timeStamp;

      if (!isOpenRef.current) return;
      if (e.key === "Alt" || e.key === "Meta") return;

      const mode = focusModeRef.current;
      const gpDetected = gamepadDetectedRef.current;

      /* ── Row length helper (pure, reads VIRTUAL_KEYS) ── */
      function rowLen(row: number): number {
        if (row < 0 || row >= VIRTUAL_KEYS.length) return 0;
        return VIRTUAL_KEYS[row].length;
      }

      /* ── X always deletes one character while Search is open,
            regardless of mode. Consumed before mode-specific handling
            to prevent X=Play from leaking behind Search. ── */
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setQuery((prev) => prev.slice(0, -1));
        if (DEBUG_SEARCH_INPUT) {
          console.log(`[CONSOLE_SEARCH][X_DELETE] queryLength=${queryRef.current.length}`);
        }
        return;
      }

      if (mode === "keyboard" && gpDetected) {
        /* ── Keyboard mode ── */
        if (DEBUG_SEARCH_INPUT) {
          console.log(`[CONSOLE_SEARCH_INPUT][OWNER] key=${e.key} focusMode=keyboard`);
        }

        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            e.stopImmediatePropagation();
            setKeyboardRow((prev) => {
              if (prev <= 0) return prev;
              const next = prev - 1;
              if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_KEYBOARD][MOVE] dir=up row=${prev}→${next} col=${keyboardColRef.current}`);
              return next;
            });
            break;

          case "ArrowDown":
            e.preventDefault();
            e.stopImmediatePropagation();
            setKeyboardRow((prev) => {
              if (prev >= VIRTUAL_KEYS.length - 1) {
                setFocusMode("results");
                if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_KEYBOARD][MOVE] dir=down row=${prev}→results`);
                return prev;
              }
              const next = prev + 1;
              if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_KEYBOARD][MOVE] dir=down row=${prev}→${next} col=${keyboardColRef.current}`);
              return next;
            });
            break;

          case "ArrowLeft":
            e.preventDefault();
            e.stopImmediatePropagation();
            setKeyboardCol((prev) => {
              const len = rowLen(keyboardRowRef.current);
              const next = prev <= 0 ? len - 1 : prev - 1;
              if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_KEYBOARD][MOVE] dir=left col=${prev}→${next} row=${keyboardRowRef.current}`);
              return next;
            });
            break;

          case "ArrowRight":
            e.preventDefault();
            e.stopImmediatePropagation();
            setKeyboardCol((prev) => {
              const len = rowLen(keyboardRowRef.current);
              const next = prev >= len - 1 ? 0 : prev + 1;
              if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_KEYBOARD][MOVE] dir=right col=${prev}→${next} row=${keyboardRowRef.current}`);
              return next;
            });
            break;

          case "Enter":
            e.preventDefault();
            e.stopImmediatePropagation();
            {
              const r = keyboardRowRef.current;
              const c = keyboardColRef.current;
              const row = VIRTUAL_KEYS[r];
              if (row) {
                const keyDef = row[c];
                if (keyDef) handleKeyboardPress(keyDef);
              }
            }
            break;

          case "y":
          case "Y":
            e.preventDefault();
            e.stopImmediatePropagation();
            if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_SEARCH][FOCUS_MODE] keyboard→results via Y`);
            setFocusMode("results");
            break;

          case "Escape":
          case "b":
          case "B":
            e.preventDefault();
            e.stopImmediatePropagation();
            if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_SEARCH][FOCUS_MODE] keyboard→results via ${e.key}`);
            setFocusMode("results");
            break;

          case "v":
          case "V":
            e.preventDefault();
            e.stopImmediatePropagation();
            if (DEBUG_SEARCH_INPUT) {
              console.log(`[CONSOLE_SEARCH_INPUT][CONSUME] key=${e.key} blocked-behind-search`);
            }
            break;
        }
      } else {
        /* ── Results mode or no gamepad ── */
        if (DEBUG_SEARCH_INPUT && gpDetected) {
          console.log(`[CONSOLE_SEARCH_INPUT][OWNER] key=${e.key} focusMode=results`);
        }

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            e.stopImmediatePropagation();
            setFocusIndex((i) => {
              const cur = resultsRef.current.length;
              const next = i < cur - 1 ? i + 1 : 0;
              if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_SEARCH][FOCUS_MODE] results-down index=${i}→${next}`);
              return next;
            });
            break;

          case "ArrowUp":
            e.preventDefault();
            e.stopImmediatePropagation();
            {
              const curIdx = focusIndexRef.current;
              const resLen = resultsRef.current.length;
              if (curIdx <= 0 && gpDetected && resLen > 0) {
                // Return to keyboard, reset focus to Q
                setFocusMode("keyboard");
                setKeyboardRow(0);
                setKeyboardCol(0);
                if (DEBUG_SEARCH_KEYBOARD) {
                  console.log(`[CONSOLE_SEARCH][KEYBOARD_RESTORE] reason=arrowup-from-first result=0 row→0 col→0`);
                }
              } else {
                setFocusIndex((i) => {
                  const next = i > 0 ? i - 1 : (resLen > 0 ? resLen - 1 : 0);
                  if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_SEARCH][FOCUS_MODE] results-up index=${i}→${next}`);
                  return next;
                });
              }
            }
            break;

          case "ArrowLeft":
          case "ArrowRight":
            e.preventDefault();
            e.stopImmediatePropagation();
            break;

          case "Enter":
            e.preventDefault();
            e.stopImmediatePropagation();
            {
              const idx = focusIndexRef.current;
              const res = resultsRef.current;
              if (res.length > 0 && idx >= 0 && idx < res.length) {
                handleSelect(res[idx]);
              }
            }
            break;

          case "y":
          case "Y":
            e.preventDefault();
            e.stopImmediatePropagation();
            if (gpDetected) {
              if (DEBUG_SEARCH_KEYBOARD) console.log(`[CONSOLE_SEARCH][FOCUS_MODE] results→keyboard via Y`);
              setFocusMode("keyboard");
              setKeyboardRow(0);
              setKeyboardCol(0);
            }
            break;

          case "Escape":
          case "/":
            e.preventDefault();
            e.stopImmediatePropagation();
            handleClose();
            break;

          case "b":
          case "B":
            e.preventDefault();
            e.stopImmediatePropagation();
            handleClose();
            break;

          case "v":
          case "V":
            e.preventDefault();
            e.stopImmediatePropagation();
            if (DEBUG_SEARCH_INPUT) {
              console.log(`[CONSOLE_SEARCH_INPUT][CONSUME] key=${e.key} blocked-behind-search`);
            }
            break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    /* stable effect: only re-register on open/close */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

        {/* ── Virtual keyboard (gamepad mode) ── */}
        {gamepadDetected && (
          <ConsoleVirtualKeyboard
            visible={focusMode === "keyboard"}
            focusedRow={keyboardRow}
            focusedCol={keyboardCol}
            onKeyPress={handleKeyboardPress}
          />
        )}

        {/* ── Results ── */}
        <div className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin scrollbar-thumb-(--color-border)/20">
          {query.trim().length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Search className="h-10 w-10 text-(--color-muted)/20" />
              <p className="text-base text-(--color-muted)/50 font-medium">
                Start typing to search your library
              </p>
            </div>
          ) : results.length === 0 ? (
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
            {gamepadDetected && focusMode === "keyboard" ? (
              <>
                <HintPill label={hints.navigate} />
                <HintPill label={hints.select} primary />
                <HintPill label={hints.delete} />
                <HintPill label="[Y] Results" />
                <HintPill label={hints.back} />
              </>
            ) : (
              <>
                <HintPill label={hints.navigate} />
                <HintPill label={hints.select} primary />
                {gamepadDetected && <HintPill label={hints.delete} />}
                {gamepadDetected && <HintPill label="[Y] Keyboard" />}
                <HintPill label={hints.back} />
                <HintPill label="[⌨] Type" />
              </>
            )}
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
