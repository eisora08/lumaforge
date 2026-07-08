import { useEffect, useMemo, useState } from "react";
import { LayoutPanelTop, Monitor, Settings } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useUserProfile } from "../profile/userProfile";
import { getAvatarPreset } from "../profile/profilePresets";
import type { ConsoleSettings } from "./consoleSettings";

const DEBUG_CONSOLE_MODE = false;

type Props = {
  layoutMode: "spotlight" | "grid";
  onToggleLayout: () => void;
  onNavigate?: (page: AppPage) => void;
  onOpenSettings?: () => void;
  settings?: ConsoleSettings;
};

function formatTime(): string {
  const now = new Date();
  const h = now.getHours() % 12 || 12;
  const m = now.getMinutes().toString().padStart(2, "0");
  const ampm = now.getHours() >= 12 ? "PM" : "AM";
  return `${h}:${m} ${ampm}`;
}

export default function ConsoleTopHud({
  layoutMode,
  onToggleLayout,
  onNavigate,
  onOpenSettings,
  settings,
}: Props) {
  const [profile] = useUserProfile();
  const [time, setTime] = useState(formatTime);

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime()), 60_000);
    return () => clearInterval(id);
  }, []);

  const avatarPreset = useMemo(() => getAvatarPreset(profile.avatarPreset), [profile.avatarPreset]);

  if (DEBUG_CONSOLE_MODE) {
    console.log(`[CONSOLE][HUD] layout=${layoutMode} name=${profile.displayName}`);
  }

  const showClock = settings?.showClock !== false;

  return (
    <div className="relative z-20 flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
      {/* Left: avatar + name */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-(--color-accent)/15"
          style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
        >
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-sm">{avatarPreset?.icon ?? "🎮"}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-(--color-text) drop-shadow-md">
            {profile.displayName}
          </span>
        </div>
      </div>

      {/* Center: source branding */}
      <div className="hidden select-none md:block">
        <span className="rounded-full bg-(--color-surface)/60 px-3 py-1 text-[11px] font-bold tracking-[0.15em] text-(--color-muted)/50 backdrop-blur-sm">
          LUMAFORGE
        </span>
      </div>

      {/* Right: settings + time + layout toggle + Desktop */}
      <div className="flex items-center gap-2">
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-surface)/40 text-(--color-muted) backdrop-blur-sm transition hover:bg-(--color-surface) hover:text-(--color-text)"
            aria-label="Console settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
        {showClock && (
          <span className="text-sm font-medium tabular-nums text-(--color-muted) drop-shadow-md">
            {time}
          </span>
        )}
        <button
          onClick={onToggleLayout}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-(--color-surface)/40 text-(--color-muted) backdrop-blur-sm transition hover:bg-(--color-surface) hover:text-(--color-text)"
          aria-label={layoutMode === "spotlight" ? "Grid view" : "Spotlight view"}
        >
          {layoutMode === "spotlight" ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
          ) : (
            <LayoutPanelTop className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => onNavigate?.("home")}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-(--color-border) bg-(--color-surface)/40 px-3 text-xs font-medium text-(--color-muted) backdrop-blur-sm transition hover:bg-(--color-surface) hover:text-(--color-text)"
          aria-label="Exit console mode"
        >
          <Monitor className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Desktop</span>
        </button>
      </div>
    </div>
  );
}
