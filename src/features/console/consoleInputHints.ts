export type ConsoleInputHintStyle = "xbox" | "playstation" | "keyboard" | "auto";

export type ConsoleInputHints = {
  selectPlay: string;
  details: string;
  search: string;
  options: string;
  back: string;
  filter: string;
};

const HINT_MAP: Record<Exclude<ConsoleInputHintStyle, "auto">, ConsoleInputHints> = {
  xbox: {
    selectPlay: "[A] Play",
    details: "[X] Details",
    search: "[Y] Search",
    options: "[Menu] Options",
    back: "[B] Back",
    filter: "[LB/RB] Filter",
  },
  playstation: {
    selectPlay: "[✕] Play",
    details: "[▢] Details",
    search: "[△] Search",
    options: "[Options] Options",
    back: "[○] Back",
    filter: "[L1/R1] Filter",
  },
  keyboard: {
    selectPlay: "[Enter] Play",
    details: "[Enter] Details",
    search: "[/] Search",
    options: "[Esc] Options",
    back: "[Esc] Back",
    filter: "[F] Filter",
  },
};

export function getConsoleInputHints(style: ConsoleInputHintStyle = "xbox"): ConsoleInputHints {
  if (style === "auto") {
    const prefersPlayStation = typeof navigator !== "undefined"
      && navigator.platform?.toLowerCase().includes("mac");
    return prefersPlayStation ? HINT_MAP.playstation : HINT_MAP.xbox;
  }
  return HINT_MAP[style] ?? HINT_MAP.xbox;
}
