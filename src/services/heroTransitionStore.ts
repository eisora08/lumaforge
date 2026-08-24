export type HeroTransitionId = "crossfade" | "kenburns" | "focus";

export type HeroTransitionOption = {
  id: HeroTransitionId;
  label: string;
  description: string;
  labelKey: string;
  descriptionKey: string;
};

export type HeroTransitionSnapshot = {
  id: HeroTransitionId;
};

export const HERO_TRANSITION_OPTIONS: HeroTransitionOption[] = [
  {
    id: "crossfade",
    label: "Crossfade",
    description: "Fundido suave de dos capas entre imágenes (por defecto).",
    labelKey: "settings.hero_transitions.crossfade.label",
    descriptionKey: "settings.hero_transitions.crossfade.description",
  },
  {
    id: "kenburns",
    label: "Ken Burns",
    description: "Zoom y paneo lento y continuo sobre el arte del fondo.",
    labelKey: "settings.hero_transitions.kenburns.label",
    descriptionKey: "settings.hero_transitions.kenburns.description",
  },
  {
    id: "focus",
    label: "Enfoque",
    description: "Revelado de desenfoque a nitidez al cargar la imagen.",
    labelKey: "settings.hero_transitions.focus.label",
    descriptionKey: "settings.hero_transitions.focus.description",
  },
];

const HERO_TRANSITION_KEY = "lumaforge-hero-transition";

function isHeroTransitionId(v: unknown): v is HeroTransitionId {
  return v === "crossfade" || v === "kenburns" || v === "focus";
}

let _id: HeroTransitionId = (() => {
  try {
    const v = localStorage.getItem(HERO_TRANSITION_KEY);
    return isHeroTransitionId(v) ? v : "crossfade";
  } catch {
    return "crossfade";
  }
})();

const _listeners = new Set<() => void>();

let _snapshot: HeroTransitionSnapshot = { id: _id };

function emit() {
  // Always assign a NEW snapshot object — useSyncExternalStore compares with
  // Object.is, so mutating the same object would never re-render consumers.
  _snapshot = { id: _id };
  _listeners.forEach((cb) => cb());
}

export function setHeroTransition(id: HeroTransitionId) {
  if (_id === id) {
    return;
  }
  _id = id;
  try {
    localStorage.setItem(HERO_TRANSITION_KEY, id);
  } catch {
    // storage unavailable — keep session-only state
  }
  emit();
}

export function getHeroTransition() {
  return _id;
}

export function subscribeHeroTransition(cb: () => void) {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

export function getHeroTransitionSnapshot() {
  return _snapshot;
}
