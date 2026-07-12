export type ConsoleInputHintStyle = "xbox" | "playstation" | "keyboard" | "auto";

export type ConsoleInputHints = {
  select: string;
  back: string;
  play: string;
  navigate: string;
  media: string;
  options: string;
  search: string;
  details: string;
  profile: string;
  page: string;
  delete: string;
};

const HINT_MAP: Record<Exclude<ConsoleInputHintStyle, "auto">, ConsoleInputHints> = {
  xbox: {
    select: "[A] Select",
    back: "[B] Back",
    play: "[X] Play",
    navigate: "[D-Pad] Navigate",
    media: "[LB/RB] Media",
    options: "[Menu] Options",
    search: "[Y] Search",
    details: "[D] Details",
    profile: "[View] Profile",
    page: "[LT/RT] Page",
    delete: "[X] Delete",
  },
  playstation: {
    select: "[✕] Select",
    back: "[○] Back",
    play: "[▢] Play",
    navigate: "[D-Pad] Navigate",
    media: "[L1/R1] Media",
    options: "[Options] Options",
    search: "[△] Search",
    details: "[D] Details",
    profile: "[TouchPad] Profile",
    page: "[L2/R2] Page",
    delete: "[▢] Delete",
  },
  keyboard: {
    select: "[Enter] Select",
    back: "[Esc] Back",
    play: "[P] Play",
    navigate: "[Arrows] Navigate",
    media: "[Q/E] Media",
    options: "[O] Options",
    search: "[/] Search",
    details: "[D] Details",
    profile: "[V] Profile",
    page: "[PgUp/PgDn] Page",
    delete: "[Backspace] Delete",
  },
};

let _gamepadDetected = false;

export function setGamepadDetected(v: boolean): void {
  _gamepadDetected = v;
}

export function isGamepadDetected(): boolean {
  return _gamepadDetected;
}

export function getConsoleInputHints(style: ConsoleInputHintStyle = "xbox"): ConsoleInputHints {
  if (style === "auto") {
    if (!_gamepadDetected) return HINT_MAP.keyboard;
    const prefersPlayStation = typeof navigator !== "undefined"
      && navigator.platform?.toLowerCase().includes("mac");
    return prefersPlayStation ? HINT_MAP.playstation : HINT_MAP.xbox;
  }
  return HINT_MAP[style] ?? HINT_MAP.xbox;
}
