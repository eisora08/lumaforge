import { useMemo } from "react";

/* ── Key definitions ── */
export type VirtualKeyAction = "char" | "space" | "backspace" | "clear" | "done";
export type VirtualKeyDef = { label: string; action: VirtualKeyAction; char?: string };
export type KeyboardRow = VirtualKeyDef[];

export const VIRTUAL_KEYS: KeyboardRow[] = [
  [
    { label: "Q", action: "char", char: "q" },
    { label: "W", action: "char", char: "w" },
    { label: "E", action: "char", char: "e" },
    { label: "R", action: "char", char: "r" },
    { label: "T", action: "char", char: "t" },
    { label: "Y", action: "char", char: "y" },
    { label: "U", action: "char", char: "u" },
    { label: "I", action: "char", char: "i" },
    { label: "O", action: "char", char: "o" },
    { label: "P", action: "char", char: "p" },
  ],
  [
    { label: "A", action: "char", char: "a" },
    { label: "S", action: "char", char: "s" },
    { label: "D", action: "char", char: "d" },
    { label: "F", action: "char", char: "f" },
    { label: "G", action: "char", char: "g" },
    { label: "H", action: "char", char: "h" },
    { label: "J", action: "char", char: "j" },
    { label: "K", action: "char", char: "k" },
    { label: "L", action: "char", char: "l" },
  ],
  [
    { label: "Z", action: "char", char: "z" },
    { label: "X", action: "char", char: "x" },
    { label: "C", action: "char", char: "c" },
    { label: "V", action: "char", char: "v" },
    { label: "B", action: "char", char: "b" },
    { label: "N", action: "char", char: "n" },
    { label: "M", action: "char", char: "m" },
  ],
  [
    { label: "SPACE", action: "space" },
    { label: "⌫", action: "backspace" },
    { label: "CLR", action: "clear" },
    { label: "DONE", action: "done" },
  ],
];

/* ── Row metadata for navigation ── */
export function getRowLength(row: number): number {
  if (row < 0 || row >= VIRTUAL_KEYS.length) return 0;
  return VIRTUAL_KEYS[row].length;
}

export function clampCol(row: number, col: number): number {
  const len = getRowLength(row);
  if (len === 0) return 0;
  if (col < 0) return 0;
  if (col >= len) return len - 1;
  return col;
}

export function clampRow(row: number): number {
  if (row < 0) return 0;
  if (row >= VIRTUAL_KEYS.length) return VIRTUAL_KEYS.length - 1;
  return row;
}

/* ── Component ── */
type Props = {
  visible: boolean;
  focusedRow: number;
  focusedCol: number;
  onKeyPress: (key: VirtualKeyDef) => void;
};

export default function ConsoleVirtualKeyboard({
  visible, focusedRow, focusedCol, onKeyPress,
}: Props) {
  const rows = useMemo(() => VIRTUAL_KEYS, []);

  if (!visible) return null;

  return (
    <div className="shrink-0 px-4 py-3 border-t border-(--color-border)/10">
      <div className="mx-auto flex max-w-[520px] flex-col items-center gap-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center justify-center gap-1">
            {row.map((key, ci) => {
              const focused = ri === focusedRow && ci === focusedCol;
              const isSpace = key.action === "space";
              const isWide = isSpace || key.action === "clear" || key.action === "done";
              const isBackspace = key.action === "backspace";
              return (
                <button
                  key={`${ri}-${ci}`}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onKeyPress(key)}
                  className={`flex items-center justify-center rounded-lg font-medium text-sm transition-all duration-75 outline-none ${
                    isSpace ? "min-w-[120px] px-4 py-2.5 text-xs tracking-wider" : isWide ? "min-w-[72px] px-3 py-2.5" : isBackspace ? "min-w-[44px] px-2 py-2.5" : "min-w-[38px] px-1 py-2.5"
                  } ${
                    focused
                      ? "bg-(--color-accent)/25 ring-2 ring-(--color-accent)/60 scale-110 text-(--color-text) shadow-lg shadow-(--color-accent)/20 z-10"
                      : "bg-white/[0.07] text-(--color-muted)/80 hover:bg-white/[0.12] hover:text-(--color-text)/90 ring-1 ring-white/[0.04]"
                  }`}
                >
                  {key.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
