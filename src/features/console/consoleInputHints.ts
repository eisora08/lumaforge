export type ConsoleInputHintStyle = "xbox" | "playstation" | "keyboard" | "auto";

export type ConsoleInputHints = {
  select: string;
  back: string;
  navigate: string;
  media: string;
  options: string;
  search: string;
};

const HINT_MAP: Record<Exclude<ConsoleInputHintStyle, "auto">, ConsoleInputHints> = {
  xbox: {
    select: "[A] Select",
    back: "[B] Back",
    navigate: "[D-Pad] Navigate",
    media: "[LB/RB] Media",
    options: "[Menu] Options",
    search: "[Y] Search",
  },
  playstation: {
    select: "[✕] Select",
    back: "[○] Back",
    navigate: "[D-Pad] Navigate",
    media: "[L1/R1] Media",
    options: "[Options] Options",
    search: "[△] Search",
  },
  keyboard: {
    select: "[Enter] Select",
    back: "[Esc] Back",
    navigate: "[Arrows] Navigate",
    media: "[Q/E] Media",
    options: "[O] Options",
    search: "[/] Search",
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
