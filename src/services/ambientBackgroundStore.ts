export type AmbientIntensity = "sutil" | "equilibrado" | "vivido";
export type AmbientMode = "image" | "color";

type AmbientSnapshot = {
  url: string | null;
  enabled: boolean;
  intensity: AmbientIntensity;
  mode: AmbientMode;
  pulseColor: string | null;
};

const AMBIENT_STORAGE_KEY = "lumaforge-ambient-background";
const AMBIENT_INTENSITY_KEY = "lumaforge-ambient-intensity";
const AMBIENT_MODE_KEY = "lumaforge-ambient-mode";
const PAGE_CONTEXT_SCOPE = "page-context";

// Two-slot source model:
// - _detail — the "active page" feed (dashboard / library-details / console-details …).
//   While mounted it wins over everything else.
// - _context — a navigation-level fallback updated on every page change. It guarantees
//   the ambient art never goes stale/blank during transitions between detail pages
//   (the previous page's feed unmounts, the next page's async resolution hasn't
//   resolved yet, and pages without a dedicated feed still have a background).
type AmbientDetail = { scope: string; url: string | null };

let _detail: AmbientDetail | null = null;
let _context: string | null = null;
// Session-level memory of the last resolved library-details art. Unlike the
// _detail slot it is NOT cleared on unmount — Library.tsx reads it to keep the
// ambient background on the last game viewed while the grid is mounted.
let _lastLibraryDetailsUrl: string | null = null;
let _enabled: boolean = (() => {
  try {
    return localStorage.getItem(AMBIENT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();
let _intensity: AmbientIntensity = (() => {
  try {
    const v = localStorage.getItem(AMBIENT_INTENSITY_KEY);
    return v === "sutil" || v === "equilibrado" || v === "vivido" ? v : "equilibrado";
  } catch {
    return "equilibrado";
  }
})();
let _mode: AmbientMode = (() => {
  try {
    return localStorage.getItem(AMBIENT_MODE_KEY) === "color" ? "color" : "image";
  } catch {
    return "image";
  }
})();

const _listeners = new Set<() => void>();

function normalizeUrl(url: string | null): string | null {
  return url && url.trim().length > 0 ? url : null;
}

function activeUrl(): string | null {
  return (_detail?.url ?? _context) ?? null;
}

let _snapshot: AmbientSnapshot = {
  url: activeUrl(),
  enabled: _enabled,
  intensity: _intensity,
  mode: _mode,
  pulseColor: null,
};

// ── Achievement unlock ambient pulse ──────────────────────────────────────
let _pulseColor: string | null = null;
let _pulseTimer: ReturnType<typeof setTimeout> | null = null;

const PULSE_DURATION_MS = 2500;

const RARITY_PULSE_COLORS: Record<string, string> = {
  common: "#94a3b8",
  uncommon: "#34d399",
  rare: "#22d3ee",
  epic: "#a855f7",
  legendary: "#fbbf24",
};

export function pulseAmbientRarity(rarity: string): void {
  const color = RARITY_PULSE_COLORS[rarity];
  if (!color) return;
  _pulseColor = color;
  emit();
  if (_pulseTimer) clearTimeout(_pulseTimer);
  _pulseTimer = setTimeout(() => {
    _pulseColor = null;
    _pulseTimer = null;
    emit();
  }, PULSE_DURATION_MS);
}

if (typeof document !== "undefined") {
  document.documentElement.dataset.ambient = _enabled ? "on" : "off";
}

function emit() {
  // Always assign a NEW snapshot object. useSyncExternalStore consumers compare
  // snapshots with Object.is — mutating the same object means the reference is
  // identical and the component never re-renders (the "ambient only updates on
  // minimize/maximize" bug).
  _snapshot = {
    url: activeUrl(),
    enabled: _enabled,
    intensity: _intensity,
    mode: _mode,
    pulseColor: _pulseColor,
  };
  _listeners.forEach((cb) => cb());
  document.documentElement.dataset.ambient = _enabled ? "on" : "off";
}

export function setAmbientSource(scope: string, url: string | null) {
  const nextUrl = normalizeUrl(url);
  if (scope === PAGE_CONTEXT_SCOPE) {
    if (_context !== nextUrl) {
      _context = nextUrl;
      emit();
    }
    return;
  }
  if (!_detail || _detail.scope !== scope || _detail.url !== nextUrl) {
    _detail = { scope, url: nextUrl };
    emit();
  }
}

export function clearAmbientSource(scope: string) {
  if (scope === PAGE_CONTEXT_SCOPE) {
    if (_context !== null) {
      _context = null;
      emit();
    }
    return;
  }
  if (_detail && _detail.scope === scope) {
    _detail = null;
    emit();
  }
}

// ── Navigation-level fallback (page-context) ────────────────────────────────
export function setPageContextSource(url: string | null) {
  setAmbientSource(PAGE_CONTEXT_SCOPE, url);
}

export function clearPageContextSource() {
  clearAmbientSource(PAGE_CONTEXT_SCOPE);
}

// ── Last library-details memory ─────────────────────────────────────────────
// Persists the art of the last game opened in LibraryGameDetails so the Library
// grid can keep showing it after navigating back (session-scoped, not cleared
// on detail unmount).
export function rememberLibraryDetails(url: string | null) {
  _lastLibraryDetailsUrl = normalizeUrl(url);
}

export function getLastLibraryDetailsUrl(): string | null {
  return _lastLibraryDetailsUrl;
}

// ── Intensity level ─────────────────────────────────────────────────────────
export function setAmbientIntensity(intensity: AmbientIntensity) {
  if (_intensity === intensity) {
    emit();
    return;
  }
  _intensity = intensity;
  try {
    localStorage.setItem(AMBIENT_INTENSITY_KEY, intensity);
  } catch {
    // storage unavailable — keep session-only state
  }
  emit();
}

export function getAmbientIntensity() {
  return _intensity;
}

// ── Display mode (image vs dominant color) ──────────────────────────────────
export function setAmbientMode(mode: AmbientMode) {
  if (_mode === mode) {
    emit();
    return;
  }
  _mode = mode;
  try {
    localStorage.setItem(AMBIENT_MODE_KEY, mode);
  } catch {
    // storage unavailable — keep session-only state
  }
  emit();
}

export function getAmbientMode() {
  return _mode;
}

export function setAmbientEnabled(enabled: boolean) {
  if (_enabled === enabled) {
    emit();
    return;
  }
  _enabled = enabled;
  try {
    localStorage.setItem(AMBIENT_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // storage unavailable — keep session-only state
  }
  emit();
}

export function isAmbientEnabled() {
  return _enabled;
}

export function subscribeAmbient(cb: () => void) {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

export function getAmbientSnapshot() {
  return _snapshot;
}
