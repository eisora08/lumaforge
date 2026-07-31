export type AmbientIntensity = "sutil" | "equilibrado" | "vivido";

type AmbientSnapshot = {
  url: string | null;
  enabled: boolean;
  intensity: AmbientIntensity;
};

const AMBIENT_STORAGE_KEY = "lumaforge-ambient-background";
const AMBIENT_INTENSITY_KEY = "lumaforge-ambient-intensity";
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

const _listeners = new Set<() => void>();

function normalizeUrl(url: string | null): string | null {
  return url && url.trim().length > 0 ? url : null;
}

function activeUrl(): string | null {
  return (_detail?.url ?? _context) ?? null;
}

let _snapshot: AmbientSnapshot = { url: activeUrl(), enabled: _enabled, intensity: _intensity };

if (typeof document !== "undefined") {
  document.documentElement.dataset.ambient = _enabled ? "on" : "off";
}

function emit() {
  // Always assign a NEW snapshot object. useSyncExternalStore consumers compare
  // snapshots with Object.is — mutating the same object means the reference is
  // identical and the component never re-renders (the "ambient only updates on
  // minimize/maximize" bug).
  _snapshot = { url: activeUrl(), enabled: _enabled, intensity: _intensity };
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
