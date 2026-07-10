import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X, Shuffle, RefreshCw, Settings,
  Monitor, Power, Moon, Sun, Zap, HelpCircle,
  Wrench, Gamepad2, Film,
  Maximize, Grid3X3, ChevronRight, ArrowLeft,
} from "lucide-react";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";
import { useUserProfile, resolveProfileMediaUrl } from "../profile/userProfile";
import { getAvatarPreset, getBannerPreset } from "../profile/profilePresets";
import type {
  ConsoleSettings,
  ConsoleThemeMode,
  ConsoleInputHintStyle,
  ConsoleBackgroundTexture,
  ConsoleBottomBarPosition,
} from "./consoleSettings";
import {
  resetConsoleLayoutSettings,
  resetConsoleVisualSettings,
  resetConsoleMediaSettings,
  resetConsoleInputSettings,
} from "./consoleSettings";

type PanelPage =
  | "main"
  | "settings"
  | "layout"
  | "visuals"
  | "media"
  | "input"
  | "tools"
  | "help";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ConsoleSettings;
  onPatch: (patch: Partial<ConsoleSettings>) => void;
  onNavigate?: (page: AppPage) => void;
  allGames?: LibraryGame[];
  onSelectGame?: (game: LibraryGame) => void;
  onRefreshLibrary?: () => void;
};

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

const POSITION_OPTIONS: { value: ConsoleBottomBarPosition; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

const ANIM_DURATION_MS = 250;

// ============================================================
// Option row
// ============================================================
function OptionRow({
  icon: Icon, label, description, onClick, disabled, hasArrow, isFocused,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  onClick?: () => void;
  disabled?: boolean;
  hasArrow?: boolean;
  isFocused?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all duration-100 ${
        isFocused
          ? "bg-(--color-accent)/20 ring-2 ring-(--color-accent)/60 scale-[1.02]"
          : disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:bg-white/10 active:bg-white/5"
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-surface)/60">
        <Icon className="h-5 w-5 text-(--color-muted)" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold text-(--color-text)">{label}</div>
        {description && (
          <div className="mt-0.5 text-sm text-(--color-muted) truncate">{description}</div>
        )}
      </div>
      {hasArrow && <ChevronRight className="h-5 w-5 shrink-0 text-(--color-muted)/50" />}
    </button>
  );
}

// ============================================================
// Sub-panel header
// ============================================================
function SubPanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button
        onClick={onBack}
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-surface)/60 text-(--color-muted) transition hover:bg-(--color-surface) hover:text-(--color-text)"
        aria-label="Go back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h2 className="text-xl font-bold text-(--color-text)">{title}</h2>
    </div>
  );
}

// ============================================================
// Toggle row
// ============================================================
function ToggleRow({
  label, description, enabled, onChange, isFocused,
}: {
  label: string; description?: string; enabled: boolean; onChange: () => void; isFocused?: boolean;
}) {
  return (
    <button
      onClick={onChange}
      className={`flex w-full items-center justify-between rounded-xl px-4 py-3 transition ${
        isFocused ? "bg-(--color-accent)/15 ring-2 ring-(--color-accent)/50" : "hover:bg-white/5"
      }`}
    >
      <div className="text-left">
        <span className="text-sm font-medium text-(--color-text)">{label}</span>
        {description && <p className="text-xs text-(--color-muted)">{description}</p>}
      </div>
      <div className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
        enabled ? "bg-(--color-accent)" : "bg-(--color-border)"
      }`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0"
        }`} />
      </div>
    </button>
  );
}

// ============================================================
// Slider row
// ============================================================
function SliderRow({
  label, value, min, max, step, unit, onChange, isFocused,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; isFocused?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 transition ${
      isFocused ? "bg-(--color-accent)/15 ring-2 ring-(--color-accent)/50" : ""
    }`}>
      <span className="w-28 shrink-0 text-sm text-(--color-muted)">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-(--color-accent) h-1.5 cursor-pointer appearance-none rounded-full bg-(--color-border) [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--color-accent) [&::-webkit-slider-thumb]:shadow-md"
      />
      <span className="w-16 text-right text-sm font-medium tabular-nums text-(--color-text)">
        {value}{unit}
      </span>
    </div>
  );
}

// ============================================================
// Button group row
// ============================================================
function ButtonGroupRow<T extends string>({
  label, options, value, onChange, isFocused,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  isFocused?: boolean;
}) {
  return (
    <div className={`rounded-xl px-4 py-3 transition ${
      isFocused ? "bg-(--color-accent)/15 ring-2 ring-(--color-accent)/50" : ""
    }`}>
      <label className="mb-2 block text-sm text-(--color-muted)">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
              value === opt.value
                ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                : "border-(--color-border) bg-(--color-surface) text-(--color-muted) hover:border-(--color-accent)/40 hover:text-(--color-text)"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Layout sub-panel
// ============================================================
function ConsoleLayoutSubPanel({
  settings, onPatch, onBack, focusedIndex, onFocusChange, itemCount,
}: {
  settings: ConsoleSettings;
  onPatch: (p: Partial<ConsoleSettings>) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const totalItems = 11;
  itemCount.current = totalItems;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); onFocusChange(Math.max(0, focusedIndex - 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); onFocusChange(Math.min(totalItems - 1, focusedIndex + 1)); }
    if (e.key === "Enter") { e.preventDefault(); if (focusedIndex === totalItems - 1) { const p = resetConsoleLayoutSettings(); onPatch(p); } }
    if (e.key === "Escape") { e.preventDefault(); onBack(); }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <SubPanelHeader title="Layout Settings" onBack={onBack} />
      <SliderRow label="Card Size" value={settings.cardSize} min={180} max={280} step={5} unit="px" onChange={(v) => onPatch({ cardSize: v })} isFocused={focusedIndex === 1} />
      <SliderRow label="Grid Columns" value={settings.gridColumns} min={4} max={14} step={1} unit="" onChange={(v) => onPatch({ gridColumns: v })} isFocused={focusedIndex === 2} />
      <SliderRow label="Grid Gap" value={settings.gridGap} min={16} max={64} step={4} unit="px" onChange={(v) => onPatch({ gridGap: v })} isFocused={focusedIndex === 3} />
      <SliderRow label="Left Padding" value={settings.leftPadding} min={24} max={160} step={8} unit="px" onChange={(v) => onPatch({ leftPadding: v })} isFocused={focusedIndex === 4} />
      <SliderRow label="Side Panel Width" value={settings.sidePanelWidth} min={560} max={860} step={10} unit="px" onChange={(v) => onPatch({ sidePanelWidth: v })} isFocused={focusedIndex === 5} />
      <ButtonGroupRow label="Bottom Bar Position" options={POSITION_OPTIONS} value={settings.bottomBarPosition} onChange={(v) => onPatch({ bottomBarPosition: v })} isFocused={focusedIndex === 6} />
      <ToggleRow label="Horizontal Scrolling" enabled={settings.horizontalScrolling} onChange={() => onPatch({ horizontalScrolling: !settings.horizontalScrolling })} isFocused={focusedIndex === 7} />
      <ToggleRow label="Smooth Scrolling" enabled={settings.smoothScrolling} onChange={() => onPatch({ smoothScrolling: !settings.smoothScrolling })} isFocused={focusedIndex === 8} />
      <button
        onClick={() => { const p = resetConsoleLayoutSettings(); onPatch(p); }}
        className={`w-full rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm font-medium text-amber-400 transition hover:bg-amber-500/15 ${focusedIndex === 9 ? "ring-2 ring-amber-500/60" : ""}`}
      >
        Reset Layout to Defaults
      </button>
    </div>
  );
}

// ============================================================
// Visuals sub-panel
// ============================================================
function ConsoleVisualsSubPanel({
  settings, onPatch, onBack, focusedIndex, onFocusChange, itemCount,
}: {
  settings: ConsoleSettings;
  onPatch: (p: Partial<ConsoleSettings>) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const totalItems = 8;
  itemCount.current = totalItems;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); onFocusChange(Math.max(0, focusedIndex - 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); onFocusChange(Math.min(totalItems, focusedIndex + 1)); }
    if (e.key === "Enter") { e.preventDefault(); if (focusedIndex === totalItems) { const p = resetConsoleVisualSettings(); onPatch(p); } }
    if (e.key === "Escape") { e.preventDefault(); onBack(); }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <SubPanelHeader title="Visuals" onBack={onBack} />
      <ButtonGroupRow label="Console Theme" options={THEME_OPTIONS} value={settings.themeMode} onChange={(v) => onPatch({ themeMode: v })} isFocused={focusedIndex === 1} />
      <ButtonGroupRow label="Background Texture" options={TEXTURE_OPTIONS} value={settings.backgroundTexture} onChange={(v) => onPatch({ backgroundTexture: v })} isFocused={focusedIndex === 2} />
      <ToggleRow label="Focus Shine Animation" description="Glow sweep on focused cards" enabled={settings.focusShine} onChange={() => onPatch({ focusShine: !settings.focusShine })} isFocused={focusedIndex === 3} />
      <ToggleRow label="Hero Motion" description="Slow Ken Burns effect on hero background" enabled={settings.heroMotion} onChange={() => onPatch({ heroMotion: !settings.heroMotion })} isFocused={focusedIndex === 4} />
      <ToggleRow label="Show Trailer Preview" description="Show mini trailer/artwork preview in Spotlight" enabled={settings.showTrailerPreview} onChange={() => onPatch({ showTrailerPreview: !settings.showTrailerPreview })} isFocused={focusedIndex === 5} />
      <SliderRow label="Spotlight Card Width" value={settings.spotlightCardWidth} min={200} max={420} step={10} unit="px" onChange={(v) => onPatch({ spotlightCardWidth: v })} isFocused={focusedIndex === 6} />
      <SliderRow label="Spotlight Card Gap" value={settings.spotlightCardGap} min={8} max={48} step={2} unit="px" onChange={(v) => onPatch({ spotlightCardGap: v })} isFocused={focusedIndex === 7} />
      <button
        onClick={() => { const p = resetConsoleVisualSettings(); onPatch(p); }}
        className={`w-full rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm font-medium text-amber-400 transition hover:bg-amber-500/15 ${focusedIndex === 8 ? "ring-2 ring-amber-500/60" : ""}`}
      >
        Reset Visuals to Defaults
      </button>
    </div>
  );
}

// ============================================================
// Media sub-panel
// ============================================================
function ConsoleMediaSubPanel({
  settings, onPatch, onBack, focusedIndex, onFocusChange, itemCount,
}: {
  settings: ConsoleSettings;
  onPatch: (p: Partial<ConsoleSettings>) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const totalItems = 7;
  itemCount.current = totalItems + 1;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); onFocusChange(Math.max(0, focusedIndex - 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); onFocusChange(Math.min(totalItems, focusedIndex + 1)); }
    if (e.key === "Enter") { e.preventDefault(); if (focusedIndex === totalItems) { const p = resetConsoleMediaSettings(); onPatch(p); } }
    if (e.key === "Escape") { e.preventDefault(); onBack(); }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <SubPanelHeader title="Media & Trailers" onBack={onBack} />

      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-(--color-muted)/60 pl-1">Media Providers</div>
      <ToggleRow label="Use SteamGridDB" description="Artwork from SteamGridDB (requires API key)" enabled={settings.useSteamGridDb} onChange={() => onPatch({ useSteamGridDb: !settings.useSteamGridDb })} isFocused={focusedIndex === 1} />
      <ToggleRow label="Use Steam AppDetails" description="Images from Steam Store metadata" enabled={settings.useSteamAppDetails} onChange={() => onPatch({ useSteamAppDetails: !settings.useSteamAppDetails })} isFocused={focusedIndex === 2} />
      <ToggleRow label="Use IGDB" description="Cover art from IGDB (requires Client ID + Secret)" enabled={settings.useIgdb} onChange={() => onPatch({ useIgdb: !settings.useIgdb })} isFocused={focusedIndex === 3} />
      <ToggleRow label="Use RAWG" description="Backgrounds from RAWG (requires API key)" enabled={settings.useRawg} onChange={() => onPatch({ useRawg: !settings.useRawg })} isFocused={focusedIndex === 4} />

      <div className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wider text-(--color-muted)/60 pl-1">Trailer Playback</div>
      <ToggleRow label="Show Trailer Preview" description="Show trailer/artwork preview in details panel" enabled={settings.showTrailerPreview} onChange={() => onPatch({ showTrailerPreview: !settings.showTrailerPreview })} isFocused={focusedIndex === 5} />
      <ToggleRow label="Autoplay Trailers" description="Start trailer automatically when entering details" enabled={settings.autoplayTrailerPreviews} onChange={() => onPatch({ autoplayTrailerPreviews: !settings.autoplayTrailerPreviews })} isFocused={focusedIndex === 6} />
      <ToggleRow label="Prefer Direct Video" description="Use MP4/WebM when available (fallback to HLS/DASH)" enabled={settings.preferDirectVideo} onChange={() => onPatch({ preferDirectVideo: !settings.preferDirectVideo })} isFocused={focusedIndex === 7} />

      <button
        onClick={() => { const p = resetConsoleMediaSettings(); onPatch(p); }}
        className={`w-full rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm font-medium text-amber-400 transition hover:bg-amber-500/15 ${focusedIndex === 8 ? "ring-2 ring-amber-500/60" : ""}`}
      >
        Reset Media to Defaults
      </button>
    </div>
  );
}

// ============================================================
// Input sub-panel
// ============================================================
function ConsoleInputSubPanel({
  settings, onPatch, onBack, focusedIndex, onFocusChange, itemCount,
}: {
  settings: ConsoleSettings;
  onPatch: (p: Partial<ConsoleSettings>) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const totalItems = 3;
  itemCount.current = totalItems + 1;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); onFocusChange(Math.max(0, focusedIndex - 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); onFocusChange(Math.min(totalItems, focusedIndex + 1)); }
    if (e.key === "Enter") { e.preventDefault(); if (focusedIndex === totalItems) { const p = resetConsoleInputSettings(); onPatch(p); } }
    if (e.key === "Escape") { e.preventDefault(); onBack(); }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <SubPanelHeader title="Input Settings" onBack={onBack} />
      <ButtonGroupRow label="Input Hints Style" options={GLYPH_OPTIONS} value={settings.inputHints} onChange={(v) => onPatch({ inputHints: v })} isFocused={focusedIndex === 1} />
      <ToggleRow label="Show Button Hints" enabled={settings.showButtonHints} onChange={() => onPatch({ showButtonHints: !settings.showButtonHints })} isFocused={focusedIndex === 2} />
      <ToggleRow label="Show Bottom Hints" enabled={settings.showBottomHints} onChange={() => onPatch({ showBottomHints: !settings.showBottomHints })} isFocused={focusedIndex === 3} />
      <button
        onClick={() => { const p = resetConsoleInputSettings(); onPatch(p); }}
        className={`w-full rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm font-medium text-amber-400 transition hover:bg-amber-500/15 ${focusedIndex === 4 ? "ring-2 ring-amber-500/60" : ""}`}
      >
        Reset Input to Defaults
      </button>
    </div>
  );
}

// ============================================================
// Tools sub-panel (placeholder)
// ============================================================
function ConsoleToolsSubPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <SubPanelHeader title="Tools" onBack={onBack} />
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Wrench className="mb-4 h-12 w-12 text-(--color-muted)/30" />
        <p className="text-lg font-medium text-(--color-muted)">Tools</p>
        <p className="mt-1 text-sm text-(--color-muted)/60">Coming in a future update</p>
      </div>
    </div>
  );
}

// ============================================================
// Help sub-panel
// ============================================================
function ConsoleHelpSubPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <SubPanelHeader title="Help" onBack={onBack} />
      <div className="flex flex-col gap-4 px-2">
        <div className="rounded-xl bg-(--color-surface)/30 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-(--color-text)">
            <Gamepad2 className="h-5 w-5" />
            Console Mode
          </h3>
          <p className="text-sm leading-relaxed text-(--color-muted)">
            Navigate with keyboard arrow keys or a controller. Press Enter to select, Escape to go back. Use Tab to cycle through categories.
          </p>
        </div>
        <div className="rounded-xl bg-(--color-surface)/30 p-5">
          <h3 className="mb-2 text-base font-semibold text-(--color-text)">Keyboard Shortcuts</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <span className="text-(--color-muted)">Arrow Keys</span><span className="text-(--color-text)">Navigate</span>
            <span className="text-(--color-muted)">Enter</span><span className="text-(--color-text)">Select / Open</span>
            <span className="text-(--color-muted)">Escape</span><span className="text-(--color-text)">Back / Close</span>
            <span className="text-(--color-muted)">Tab</span><span className="text-(--color-text)">Next Category</span>
            <span className="text-(--color-muted)">Shift+Tab</span><span className="text-(--color-text)">Prev Category</span>
          </div>
        </div>
        <div className="rounded-xl bg-(--color-surface)/30 p-5">
          <p className="text-xs text-(--color-muted)/60">
            LumaForge Console Mode v2 &middot; Built with React + Tauri
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main menu options
// ============================================================
const MAIN_OPTIONS: {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  action: "sub" | "navigate" | "random" | "refresh" | "coming-soon";
  subPage?: PanelPage;
}[] = [
  { key: "random", icon: Shuffle, label: "Pick Random Game", description: "Surprise me", action: "random" },
  { key: "refresh", icon: RefreshCw, label: "Update Library", description: "Rescan installed games", action: "refresh" },
  { key: "settings", icon: Settings, label: "Console Settings", description: "Layout, visuals, input", action: "sub", subPage: "settings" },
  { key: "tools", icon: Wrench, label: "Tools", description: "Utilities and diagnostics", action: "sub", subPage: "tools" },
  { key: "desktop", icon: Monitor, label: "Switch to Desktop Mode", description: "Exit console mode", action: "navigate" },
  { key: "power-off", icon: Power, label: "Turn Off System", action: "coming-soon" },
  { key: "suspend", icon: Moon, label: "Suspend", action: "coming-soon" },
  { key: "hibernate", icon: Zap, label: "Hibernate", action: "coming-soon" },
  { key: "restart", icon: Sun, label: "Restart", action: "coming-soon" },
  { key: "help", icon: HelpCircle, label: "Help", description: "Keyboard shortcuts & info", action: "sub", subPage: "help" },
];

// ============================================================
// Settings category grid (Layout / Visuals / Input)
// ============================================================
function SettingsCategoryGrid({
  onSelect, onBack, focusedIndex, onFocusChange,
}: {
  onSelect: (page: PanelPage) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
}) {
  const cats: { key: PanelPage; icon: React.ComponentType<{ className?: string }>; label: string; description: string }[] = [
    { key: "layout", icon: Grid3X3, label: "Layout", description: "Card size, columns, gaps" },
    { key: "visuals", icon: Maximize, label: "Visuals", description: "Theme, texture, effects" },
    { key: "media", icon: Film, label: "Media", description: "Providers, trailers, playback" },
    { key: "input", icon: Gamepad2, label: "Input", description: "Hints style, visibility" },
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); onFocusChange(Math.max(0, focusedIndex - 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); onFocusChange(Math.min(cats.length - 1, focusedIndex + 1)); }
    if (e.key === "Enter") { e.preventDefault(); const cat = cats[focusedIndex]; if (cat) onSelect(cat.key); }
    if (e.key === "Escape") { e.preventDefault(); onBack(); }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <SubPanelHeader title="Console Settings" onBack={onBack} />
      {cats.map((cat, i) => {
        const Icon = cat.icon;
        return (
          <button
            key={cat.key}
            onClick={() => onSelect(cat.key)}
            className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all ${
              focusedIndex === i ? "bg-(--color-accent)/20 ring-2 ring-(--color-accent)/60 scale-[1.02]" : "hover:bg-white/10"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-surface)/60">
              <Icon className="h-5 w-5 text-(--color-muted)" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-(--color-text)">{cat.label}</div>
              <div className="mt-0.5 text-sm text-(--color-muted)">{cat.description}</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-(--color-muted)/50" />
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Main export
// ============================================================
export default function ConsoleSettingsPanelV2({
  open, onClose, settings, onPatch,
  onNavigate, allGames, onSelectGame, onRefreshLibrary,
}: Props) {
  const [profile] = useUserProfile();
  const [page, setPage] = useState<PanelPage>("main");
  const [subPage, setSubPage] = useState<PanelPage | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const subItemCount = useRef(0);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const avatarPreset = useMemo(() => getAvatarPreset(profile.avatarPreset), [profile.avatarPreset]);
  const avatarDisplayUrl = useMemo(() => resolveProfileMediaUrl(profile.avatarUrl), [profile.avatarUrl]);
  const bannerPreset = useMemo(() => getBannerPreset(profile.bannerPreset), [profile.bannerPreset]);
  const bannerDisplayUrl = useMemo(() => resolveProfileMediaUrl(profile.bannerUrl), [profile.bannerUrl]);

  // Mount/unmount animation
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setPage("main");
      setSubPage(null);
      setFocusedIndex(0);
      // Small RAF delay so the DOM renders before transition kicks in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [open]);

  // Focus panel when visible
  useEffect(() => {
    if (visible && panelRef.current) {
      panelRef.current.focus();
    }
  }, [visible]);

  // Return focus on unmount
  useEffect(() => {
    return () => {
      // Only restore if we captured a previous element (close animation complete)
      if (!visible && prevFocusRef.current) {
        try { prevFocusRef.current.focus(); } catch {}
      }
    };
  }, [visible]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      onClose();
      if (prevFocusRef.current) {
        try { prevFocusRef.current.focus(); } catch {}
      }
    }, ANIM_DURATION_MS);
  }, [onClose]);

  useEffect(() => {
    setFocusedIndex(0);
    subItemCount.current = 0;
  }, [page, subPage]);

  const handleMainKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIndex((i) => Math.max(0, i - 1)); }
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIndex((i) => Math.min(MAIN_OPTIONS.length - 1, i + 1)); }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = MAIN_OPTIONS[focusedIndex];
      if (!opt) return;
      switch (opt.action) {
        case "sub":
          if (opt.subPage) setPage(opt.subPage);
          break;
        case "navigate":
          handleClose();
          onNavigate?.("home");
          break;
        case "random":
          handleClose();
          if (allGames && allGames.length > 0 && onSelectGame) {
            const idx = Math.floor(Math.random() * allGames.length);
            onSelectGame(allGames[idx]);
          }
          break;
        case "refresh":
          handleClose();
          onRefreshLibrary?.();
          break;
      }
    }
    if (e.key === "Escape") { e.preventDefault(); handleClose(); }
    if (e.key === "b" || e.key === "B") { e.preventDefault(); handleClose(); }
  }, [focusedIndex, allGames, handleClose, onNavigate, onSelectGame, onRefreshLibrary]);

  const handleGlobalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); handleClose(); }
    if (e.key === "b" || e.key === "B") { e.preventDefault(); handleClose(); }
  }, [handleClose]);

  const renderSubPage = () => {
    const sharedSub = {
      settings,
      onPatch,
      onBack: () => setSubPage(null),
      focusedIndex,
      onFocusChange: setFocusedIndex,
      itemCount: subItemCount,
    };
    switch (subPage) {
      case "layout": return <ConsoleLayoutSubPanel {...sharedSub} />;
      case "visuals": return <ConsoleVisualsSubPanel {...sharedSub} />;
      case "media": return <ConsoleMediaSubPanel {...sharedSub} />;
      case "input": return <ConsoleInputSubPanel {...sharedSub} />;
      case "tools": return <ConsoleToolsSubPanel onBack={() => setSubPage(null)} />;
      case "help": return <ConsoleHelpSubPanel onBack={() => setSubPage(null)} />;
      default: return null;
    }
  };

  const renderMain = () => (
    <div className="flex flex-col gap-2" onKeyDown={handleMainKeyDown}>
      {MAIN_OPTIONS.map((opt, i) => (
        <OptionRow
          key={opt.key}
          icon={opt.icon}
          label={opt.label}
          description={opt.description}
          hasArrow={opt.action === "sub"}
          disabled={opt.action === "coming-soon"}
          isFocused={focusedIndex === i}
          onClick={() => {
            switch (opt.action) {
              case "sub":
                if (opt.subPage) setPage(opt.subPage);
                break;
              case "navigate":
                handleClose();
                onNavigate?.("home");
                break;
              case "random":
                handleClose();
                if (allGames && allGames.length > 0 && onSelectGame) {
                  const idx = Math.floor(Math.random() * allGames.length);
                  onSelectGame(allGames[idx]);
                }
                break;
              case "refresh":
                handleClose();
                onRefreshLibrary?.();
                break;
            }
          }}
        />
      ))}
    </div>
  );

  const breadcrumbTitle = page === "settings" && !subPage ? "Console Settings" : subPage ? (
    subPage === "layout" ? "Layout" : subPage === "visuals" ? "Visuals" : subPage === "media" ? "Media" : subPage === "input" ? "Input" : subPage === "tools" ? "Tools" : subPage === "help" ? "Help" : null
  ) : null;

  if (!open && !visible) return null;

  const bannerGradient = bannerPreset?.gradient ?? "var(--color-accent)";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 transition-all duration-[250ms] ease-out"
        style={{
          backgroundColor: visible ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0)",
          backdropFilter: visible ? "blur(4px)" : "blur(0px)",
          WebkitBackdropFilter: visible ? "blur(4px)" : "blur(0px)",
        }}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Console settings panel"
        className="fixed left-0 top-0 bottom-0 z-50 flex w-[480px] max-w-[90vw] flex-col bg-(--color-bg)/95 border-r border-(--color-border) shadow-2xl outline-none transition-all duration-[250ms] ease-out"
        style={{
          transform: visible ? "translateX(0)" : "translateX(-100%)",
          opacity: visible ? 1 : 0,
        }}
        onKeyDown={handleGlobalKeyDown}
      >
        {/* Close button — top-right of drawer */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl bg-black/30 text-(--color-muted) backdrop-blur-sm transition hover:bg-black/50 hover:text-(--color-text)"
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Profile banner header — outer container is NOT overflow-hidden so avatar is never clipped */}
        <div className="relative shrink-0">
          {/* Banner media — only this inner div clips the image/gradient */}
          <div className="relative h-[140px] overflow-hidden">
            {bannerDisplayUrl ? (
              <img
                src={bannerDisplayUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="h-full w-full" style={{ background: bannerGradient }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-(--color-bg) via-(--color-bg)/40 to-transparent pointer-events-none" />
          </div>

          {/* Avatar — sits outside overflow-hidden, cleanly overlapping banner bottom */}
          <div className="absolute -bottom-9 left-6 z-10">
            <div
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full ring-4 ring-(--color-bg) shadow-lg"
              style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
            >
              {avatarDisplayUrl ? (
                <img src={avatarDisplayUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="text-2xl">{avatarPreset?.icon ?? "🎮"}</span>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex flex-1 flex-col overflow-y-auto px-6 pt-[60px] pb-6">
          {/* Display name + status */}
          <div className="mb-4">
            <h2 className="text-xl font-bold text-(--color-text)">{profile.displayName}</h2>
            <p className="text-sm text-(--color-muted)">{profile.status}</p>
          </div>

          {/* Breadcrumb */}
          {(page === "settings" || subPage) && breadcrumbTitle && (
            <div className="mb-4 flex items-center gap-2 text-sm text-(--color-muted)/60">
              <button
                onClick={() => { if (subPage) { setSubPage(null); } else { setPage("main"); } }}
                className="hover:text-(--color-text)"
              >
                Settings
              </button>
              <ChevronRight className="h-3 w-3" />
              <span className="text-(--color-text)/80">{breadcrumbTitle}</span>
            </div>
          )}

          {/* Page content */}
          {page === "settings" && !subPage ? (
            <SettingsCategoryGrid
              onSelect={(p) => setSubPage(p)}
              onBack={() => setPage("main")}
              focusedIndex={focusedIndex}
              onFocusChange={setFocusedIndex}
            />
          ) : subPage ? renderSubPage() : renderMain()}
        </div>
      </div>
    </>
  );
}
