import { Settings, X } from "lucide-react";
import type { ConsoleSettings, ConsoleThemeMode, ConsoleInputGlyphStyle } from "./consoleSettings";
import { resetConsoleSettings, DEFAULT_CONSOLE_SETTINGS } from "./consoleSettings";

const THEME_OPTIONS: { value: ConsoleThemeMode; label: string }[] = [
  { value: "follow-app", label: "Follow App Theme" },
  { value: "solaris-dark", label: "Solaris Dark" },
  { value: "steam-deck", label: "Steam Deck" },
  { value: "midnight", label: "Midnight" },
  { value: "amoled", label: "AMOLED" },
];

const GLYPH_OPTIONS: { value: ConsoleInputGlyphStyle; label: string }[] = [
  { value: "xbox", label: "Xbox" },
  { value: "playstation", label: "PlayStation" },
  { value: "keyboard", label: "Keyboard" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ConsoleSettings;
  onPatch: (patch: Partial<ConsoleSettings>) => void;
};

export default function ConsoleSettingsOverlay({ open, onClose, settings, onPatch }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-(--color-border) bg-(--color-bg) p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-(--color-accent)" />
            <h2 className="text-lg font-bold text-(--color-text)">Console Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-surface) text-(--color-muted) transition hover:bg-(--color-surface-active) hover:text-(--color-text)"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          {/* Theme */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-(--color-muted)">Theme</h3>
            <div className="flex flex-wrap gap-2">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onPatch({ theme: opt.value })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    settings.theme === opt.value
                      ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                      : "border-(--color-border) bg-(--color-surface) text-(--color-muted) hover:border-(--color-accent)/40 hover:text-(--color-text)"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Input Glyphs */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-(--color-muted)">Input Hints</h3>
            <div className="flex flex-wrap gap-2">
              {GLYPH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onPatch({ inputGlyphs: opt.value })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    settings.inputGlyphs === opt.value
                      ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                      : "border-(--color-border) bg-(--color-surface) text-(--color-muted) hover:border-(--color-accent)/40 hover:text-(--color-text)"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Grid sliders */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-(--color-muted)">Grid Layout</h3>
            <div className="flex flex-col gap-4">
              <SliderRow
                label="Card Size"
                value={settings.cardSize}
                min={180}
                max={260}
                step={5}
                unit="px"
                onChange={(v) => onPatch({ cardSize: v })}
              />
              <SliderRow
                label="Grid Columns"
                value={settings.gridColumns}
                min={4}
                max={14}
                step={1}
                unit=""
                onChange={(v) => onPatch({ gridColumns: v })}
              />
              <SliderRow
                label="Grid Gap"
                value={settings.gridGap}
                min={16}
                max={64}
                step={4}
                unit="px"
                onChange={(v) => onPatch({ gridGap: v })}
              />
              <SliderRow
                label="Side Panel Width"
                value={settings.sidePanelWidth}
                min={560}
                max={780}
                step={10}
                unit="px"
                onChange={(v) => onPatch({ sidePanelWidth: v })}
              />
            </div>
          </section>

          {/* Shine Animation toggle */}
          <section className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-(--color-text)">Focus Shine Animation</span>
              <p className="text-[11px] text-(--color-muted)">Glow sweep on focused cards</p>
            </div>
            <button
              onClick={() => onPatch({ enableShineAnimation: !settings.enableShineAnimation })}
              className={`relative h-6 w-10 rounded-full transition-colors ${
                settings.enableShineAnimation ? "bg-(--color-accent)" : "bg-(--color-border)"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  settings.enableShineAnimation ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </section>

          {/* Reset to Defaults */}
          <section className="border-t border-(--color-border) pt-4">
            <button
              onClick={() => {
                resetConsoleSettings();
                onPatch(DEFAULT_CONSOLE_SETTINGS);
              }}
              className="w-full rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/15 hover:border-red-500/50"
            >
              Reset to Defaults
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-(--color-muted)">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-(--color-accent) h-1.5 cursor-pointer appearance-none rounded-full bg-(--color-border) [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--color-accent) [&::-webkit-slider-thumb]:shadow-md"
      />
      <span className="w-16 text-right text-xs font-medium tabular-nums text-(--color-text)">
        {value}{unit}
      </span>
    </div>
  );
}
