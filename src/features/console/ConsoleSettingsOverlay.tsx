import { X } from "lucide-react";
import type {
  ConsoleSettings,
  ConsoleThemeMode,
  ConsoleInputHintStyle,
  ConsoleBackgroundTexture,
  ConsoleBottomBarPosition,
  ConsoleStartCategory,
} from "./consoleSettings";
import {
  resetConsoleSettings,
  resetConsoleLayoutSettings,
} from "./consoleSettings";

const THEME_OPTIONS: { value: ConsoleThemeMode; label: string }[] = [
  { value: "follow-app", label: "Follow App Theme" },
  { value: "solaris-dark", label: "Solaris Dark" },
  { value: "steam-deck", label: "Steam Deck" },
  { value: "midnight", label: "Midnight" },
  { value: "amoled", label: "AMOLED" },
];

const GLYPH_OPTIONS: { value: ConsoleInputHintStyle; label: string }[] = [
  { value: "xbox", label: "Xbox" },
  { value: "playstation", label: "PlayStation" },
  { value: "keyboard", label: "Keyboard" },
  { value: "auto", label: "Auto" },
];

const TEXTURE_OPTIONS: { value: ConsoleBackgroundTexture; label: string }[] = [
  { value: "none", label: "None" },
  { value: "grain-soft", label: "Grain Soft" },
  { value: "vignette", label: "Vignette" },
  { value: "blur", label: "Blur" },
];

const START_CATEGORY_OPTIONS: { value: ConsoleStartCategory; label: string }[] = [
  { value: "continue", label: "Continue" },
  { value: "installed", label: "Installed" },
  { value: "lua", label: "Lua" },
  { value: "favorites", label: "Favorites" },
  { value: "all", label: "All" },
];

const POSITION_OPTIONS: { value: ConsoleBottomBarPosition; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ConsoleSettings;
  onPatch: (patch: Partial<ConsoleSettings>) => void;
};

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-(--color-muted)">
      {children}
    </h3>
  );
}

function ToggleRow({
  label, description, enabled, onChange,
}: {
  label: string; description?: string; enabled: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm font-medium text-(--color-text)">{label}</span>
        {description && (
          <p className="text-[11px] text-(--color-muted)">{description}</p>
        )}
      </div>
      <button
        onClick={onChange}
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
          enabled ? "bg-(--color-accent)" : "bg-(--color-border)"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-(--color-border)" />;
}

export default function ConsoleSettingsOverlay({ open, onClose, settings, onPatch }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-(--color-border) bg-(--color-bg) p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-(--color-text)">Console Settings</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-surface) text-(--color-muted) transition hover:bg-(--color-surface-active) hover:text-(--color-text)"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          {/* ====== SECTION 1: General ====== */}
          <section>
            <SectionTitle>General</SectionTitle>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-(--color-text)">Default Layout</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => onPatch({ layoutMode: "grid" })}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                      settings.layoutMode === "grid"
                        ? "bg-(--color-accent)/20 text-(--color-accent)"
                        : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    onClick={() => onPatch({ layoutMode: "spotlight" })}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                      settings.layoutMode === "spotlight"
                        ? "bg-(--color-accent)/20 text-(--color-accent)"
                        : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                    }`}
                  >
                    Spotlight
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-(--color-text)">Start Category</span>
                <select
                  value={settings.startCategory}
                  onChange={(e) => onPatch({ startCategory: e.target.value as ConsoleStartCategory })}
                  className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-text) outline-none"
                >
                  {START_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <ToggleRow label="Show Clock" enabled={settings.showClock} onChange={() => onPatch({ showClock: !settings.showClock })} />
              <ToggleRow label="Show Profile HUD" enabled={settings.showProfileHud} onChange={() => onPatch({ showProfileHud: !settings.showProfileHud })} />
              <ToggleRow label="Show Platform Label" enabled={settings.showPlatformLabel} onChange={() => onPatch({ showPlatformLabel: !settings.showPlatformLabel })} />
            </div>
          </section>

          <Divider />

          {/* ====== SECTION 2: Visuals ====== */}
          <section>
            <SectionTitle>Visuals</SectionTitle>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-(--color-muted)">Console Theme</label>
                <div className="flex flex-wrap gap-2">
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onPatch({ themeMode: opt.value })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        settings.themeMode === opt.value
                          ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                          : "border-(--color-border) bg-(--color-surface) text-(--color-muted) hover:border-(--color-accent)/40 hover:text-(--color-text)"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-(--color-muted)">Background Texture</label>
                <div className="flex flex-wrap gap-2">
                  {TEXTURE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onPatch({ backgroundTexture: opt.value })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        settings.backgroundTexture === opt.value
                          ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                          : "border-(--color-border) bg-(--color-surface) text-(--color-muted) hover:border-(--color-accent)/40 hover:text-(--color-text)"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <ToggleRow
                label="Focus Shine Animation"
                description="Glow sweep on focused cards"
                enabled={settings.focusShine}
                onChange={() => onPatch({ focusShine: !settings.focusShine })}
              />
            </div>
          </section>

          <Divider />

          {/* ====== SECTION 3: Layout ====== */}
          <section>
            <SectionTitle>Layout</SectionTitle>
            <div className="flex flex-col gap-4">
              <SliderRow label="Card Size" value={settings.cardSize} min={180} max={280} step={5} unit="px" onChange={(v) => onPatch({ cardSize: v })} />
              <SliderRow label="Grid Columns" value={settings.gridColumns} min={4} max={14} step={1} unit="" onChange={(v) => onPatch({ gridColumns: v })} />
              <SliderRow label="Grid Gap" value={settings.gridGap} min={16} max={64} step={4} unit="px" onChange={(v) => onPatch({ gridGap: v })} />
              <SliderRow label="Left Padding" value={settings.leftPadding} min={24} max={160} step={8} unit="px" onChange={(v) => onPatch({ leftPadding: v })} />
              <SliderRow label="Side Panel Width" value={settings.sidePanelWidth} min={560} max={860} step={10} unit="px" onChange={(v) => onPatch({ sidePanelWidth: v })} />
              <div className="flex items-center justify-between">
                <span className="text-sm text-(--color-text)">Bottom Bar Position</span>
                <div className="flex gap-1">
                  {POSITION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onPatch({ bottomBarPosition: opt.value })}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                        settings.bottomBarPosition === opt.value
                          ? "bg-(--color-accent)/20 text-(--color-accent)"
                          : "bg-(--color-surface) text-(--color-muted) hover:text-(--color-text)"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <ToggleRow label="Horizontal Scrolling" enabled={settings.horizontalScrolling} onChange={() => onPatch({ horizontalScrolling: !settings.horizontalScrolling })} />
              <ToggleRow label="Smooth Scrolling" enabled={settings.smoothScrolling} onChange={() => onPatch({ smoothScrolling: !settings.smoothScrolling })} />
              <button
                onClick={() => {
                  const patched = resetConsoleLayoutSettings();
                  onPatch(patched);
                }}
                className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs font-medium text-amber-400 transition hover:bg-amber-500/15"
              >
                Reset Layout
              </button>
            </div>
          </section>

          <Divider />

          {/* ====== SECTION 4: Input ====== */}
          <section>
            <SectionTitle>Input</SectionTitle>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-xs text-(--color-muted)">Input Hints</label>
                <div className="flex flex-wrap gap-2">
                  {GLYPH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onPatch({ inputHints: opt.value })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        settings.inputHints === opt.value
                          ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                          : "border-(--color-border) bg-(--color-surface) text-(--color-muted) hover:border-(--color-accent)/40 hover:text-(--color-text)"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <ToggleRow label="Show Button Hints" enabled={settings.showButtonHints} onChange={() => onPatch({ showButtonHints: !settings.showButtonHints })} />
              <ToggleRow label="Show Bottom Hints" enabled={settings.showBottomHints} onChange={() => onPatch({ showBottomHints: !settings.showBottomHints })} />
            </div>
          </section>

          <Divider />

          {/* ====== SECTION 5: Advanced ====== */}
          <section>
            <SectionTitle>Advanced</SectionTitle>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  const defaults = resetConsoleSettings();
                  onPatch(defaults);
                }}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/15"
              >
                Reset Console Settings
              </button>
              <button
                onClick={() => {
                  const defaults = resetConsoleSettings();
                  onPatch(defaults);
                }}
                className="w-full rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/20"
              >
                Reset All Settings
              </button>
            </div>
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
