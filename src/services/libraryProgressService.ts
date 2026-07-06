import { useEffect, useState } from "react";

export type LibraryLoadSource =
  | "snapshot"
  | "sqlite"
  | "steam"
  | "steam-owned"
  | "lua"
  | "local-exe"
  | "epic"
  | "gog"
  | "xbox"
  | "unknown";

export type LibraryLoadPhase =
  | "idle"
  | "hydrating-snapshot"
  | "reading-sqlite"
  | "scanning-steam-installed"
  | "fetching-steam-owned"
  | "scanning-lua"
  | "scanning-local-exe"
  | "merging-library"
  | "updating-cache"
  | "done"
  | "error";

export type LibraryLoadProgress = {
  active: boolean;
  source: LibraryLoadSource;
  phase: LibraryLoadPhase;
  message: string;
  current?: number;
  total?: number;
  percent?: number;
  itemsFound?: number;
  itemsAdded?: number;
  itemsSkipped?: number;
  errors?: string[];
  startedAt?: number;
  updatedAt?: number;
};

type ProgressListener = (state: LibraryLoadProgress) => void;

const _initialState: LibraryLoadProgress = {
  active: false,
  source: "unknown",
  phase: "idle",
  message: "",
};

let _listeners: Set<ProgressListener> = new Set();
let _state: LibraryLoadProgress = { ..._initialState };
function notify() {
  for (const listener of _listeners) {
    listener(_state);
  }
}

function getProgressMessage(_source: LibraryLoadSource, phase: LibraryLoadPhase, itemsFound?: number, itemsAdded?: number): string {
  if (phase === "idle") return "";
  if (phase === "done") {
    const parts: string[] = ["Library ready"];
    if (itemsAdded && itemsAdded > 0) parts.push(`+${itemsAdded} games added`);
    if (itemsFound && itemsFound > 0) parts.push(`${itemsFound} total`);
    return parts.join(" — ");
  }
  if (phase === "error") return "Library loaded with warnings";
  if (phase === "hydrating-snapshot") return "Hydrating startup snapshot\u2026";
  if (phase === "reading-sqlite") return "Reading game database\u2026";
  if (phase === "scanning-steam-installed") return "Scanning installed Steam games\u2026";
  if (phase === "fetching-steam-owned") return "Fetching owned Steam games\u2026";
  if (phase === "scanning-lua") return "Scanning Lua scripts\u2026";
  if (phase === "scanning-local-exe") return "Scanning local executables\u2026";
  if (phase === "merging-library") return "Merging library sources\u2026";
  if (phase === "updating-cache") return "Updating cache\u2026";
  return "Loading library\u2026";
}

/**
 * Report a library loading progress update. Every call with phase="done" or "error"
 * ends the current active progress. Callers MUST always eventually call done/error
 * via try/catch/finally.
 */
export function reportLibraryProgress(update: Partial<LibraryLoadProgress> & { phase: LibraryLoadPhase; message?: string }): void {
  const now = Date.now();
  const isEnding = update.phase === "done" || update.phase === "error";
  const wasActive = _state.active;

  // Log all transitions
  if (!wasActive && !isEnding && update.phase !== "idle") {
    console.log(`[LIB_PROGRESS] start source=${update.source ?? _state.source} phase=${update.phase} message=${update.message ?? getProgressMessage(update.source ?? _state.source, update.phase, update.itemsFound, update.itemsAdded)}`);
  } else if (isEnding) {
    console.log(`[LIB_PROGRESS] ${update.phase} source=${update.source ?? _state.source} phase=${update.phase} itemsFound=${update.itemsFound ?? _state.itemsFound}`);
  } else if (update.phase !== "idle") {
    console.log(`[LIB_PROGRESS] update source=${update.source ?? _state.source} phase=${update.phase}`);
  } else {
    console.log(`[LIB_PROGRESS] clear reason=${String(update.source)}`);
  }

  _state = {
    ..._state,
    ...update,
    message: update.message ?? getProgressMessage(update.source ?? _state.source, update.phase, update.itemsFound, update.itemsAdded),
    active: !isEnding,
    updatedAt: now,
    startedAt: !wasActive && !isEnding && update.phase !== "idle" ? now : _state.startedAt,
  };

  notify();
}

/** Reset progress state to idle (manual/user-initiated clear). */
export function resetLibraryProgress(): void {
  const wasActive = _state.active;
  _state = { ..._initialState };
  if (wasActive) {
    console.log(`[LIB_PROGRESS] clear reason=explicit-reset`);
  }
  notify();
}

export function subscribeLibraryProgress(listener: ProgressListener): () => void {
  _listeners.add(listener);
  listener(_state);
  return () => { _listeners.delete(listener); };
}

export function useLibraryProgress(): LibraryLoadProgress {
  const [state, setState] = useState<LibraryLoadProgress>(_state);
  useEffect(() => {
    return subscribeLibraryProgress(setState);
  }, []);
  return state;
}
