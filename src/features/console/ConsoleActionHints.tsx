import { useMemo } from "react";
import { getConsoleInputHints } from "./consoleInputHints";
import type { ConsoleInputHintStyle } from "./consoleSettings";

type Props = {
  hintStyle: ConsoleInputHintStyle;
  visible?: boolean;
};

function parseHint(text: string): { key: string; label: string } | null {
  const m = text.match(/^\[(.+?)\]\s*(.*)$/);
  if (!m) return null;
  return { key: m[1], label: m[2] };
}

export default function ConsoleActionHints({ hintStyle, visible = true }: Props) {
  const hints = useMemo(() => getConsoleInputHints(hintStyle), [hintStyle]);

  if (!visible) return null;

  const items = [
    { raw: hints.select, primary: true },
    { raw: hints.play, primary: false },
    { raw: hints.profile, primary: false },
    { raw: hints.options, primary: false },
    { raw: hints.search, primary: false },
    { raw: hints.back, primary: false },
  ];

  return (
    <div className="inline-flex items-center gap-[clamp(12px,1.5vw,20px)] rounded-full bg-black/20 px-[clamp(12px,1.2vw,18px)] py-[clamp(5px,0.7vh,8px)] backdrop-blur-sm">
      {items.map((item) => {
        const parsed = parseHint(item.raw);
        if (!parsed) return null;
        return (
          <div key={parsed.label} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold leading-none ${
                item.primary
                  ? "bg-(--color-accent) text-white"
                  : "bg-white/[0.09] text-white/70"
              }`}
            >
              {parsed.key}
            </span>
            <span className="text-[11px] font-medium text-white/55">
              {parsed.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
