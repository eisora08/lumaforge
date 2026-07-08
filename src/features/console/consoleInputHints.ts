export type ConsoleInputGlyphStyle = "xbox" | "playstation" | "keyboard";

export type ConsoleInputHints = {
  selectPlay: string;
  details: string;
  search: string;
  options: string;
  back: string;
  filter: string;
};

const HINT_MAP: Record<ConsoleInputGlyphStyle, ConsoleInputHints> = {
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

export function getConsoleInputHints(style: ConsoleInputGlyphStyle = "xbox"): ConsoleInputHints {
  return HINT_MAP[style] ?? HINT_MAP.xbox;
}
