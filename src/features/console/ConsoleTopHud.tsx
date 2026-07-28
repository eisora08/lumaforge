import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutPanelTop, Monitor, Wifi, WifiOff, Gamepad2, Clock } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useUserProfile, resolveProfileMediaUrl } from "../profile/userProfile";
import { getAvatarPreset } from "../profile/profilePresets";
import type { ConsoleSettings, ConsoleTimeFormat } from "./consoleSettings";
import { useNetworkStatus } from "./useNetworkStatus";

const DEBUG_CONSOLE_HUD = false;

type Props = {
  layoutMode: "spotlight" | "grid";
  onToggleLayout: () => void;
  onNavigate?: (page: AppPage) => void;
  onOpenSettings?: () => void;
  settings?: ConsoleSettings;
};

function formatTimeWithOptions(date: Date, format: ConsoleTimeFormat, showSeconds: boolean): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (showSeconds) opts.second = "2-digit";

  switch (format) {
    case "12h":
      opts.hour12 = true;
      opts.hour = showSeconds ? "numeric" : "numeric";
      break;
    case "24h":
      opts.hour12 = false;
      opts.hour = "2-digit";
      break;
    case "system":
      opts.hour = showSeconds ? "numeric" : "numeric";
      opts.hourCycle = undefined;
      break;
    case "hidden":
      return "";
  }

  return new Intl.DateTimeFormat(navigator.language || "en-US", opts).format(date);
}

function useClock(format: ConsoleTimeFormat, showSeconds: boolean): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (format === "hidden") return;
    const ms = showSeconds ? 1_000 : 60_000;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [format, showSeconds]);

  if (format === "hidden") return "";
  return formatTimeWithOptions(now, format, showSeconds);
}

export default function ConsoleTopHud({
  layoutMode,
  onToggleLayout,
  onNavigate,
  onOpenSettings,
  settings,
}: Props) {
  const [profile] = useUserProfile();
  const profileRef = useRef<HTMLButtonElement>(null);
  const networkStatus = useNetworkStatus();

  const timeFormat = settings?.timeFormat ?? "system";
  const showSeconds = settings?.showSeconds ?? false;
  const time = useClock(timeFormat, showSeconds);

  const showClock = settings?.showClock !== false;
  const showNetwork = settings?.showNetworkIndicator !== false;
  const showController = settings?.showControllerIndicator !== false;

  const avatarPreset = useMemo(() => getAvatarPreset(profile.avatarPreset), [profile.avatarPreset]);
  const avatarDisplayUrl = useMemo(() => resolveProfileMediaUrl(profile.avatarUrl), [profile.avatarUrl]);

  if (DEBUG_CONSOLE_HUD) {
    console.log(`[CONSOLE][HUD] layout=${layoutMode} name=${profile.displayName}`);
  }

  return (
    <div className="relative z-20 flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
      {/* Left: avatar + name — clickable to open settings */}
      <button
        ref={profileRef}
        onClick={() => onOpenSettings?.()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSettings?.(); } }}
        className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1 transition hover:bg-(--color-accent)/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/60"
        aria-label="Open console settings"
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-2 ring-(--color-accent)/15"
          style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
        >
          {avatarDisplayUrl ? (
            <img src={avatarDisplayUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-sm">{avatarPreset?.icon ?? "🎮"}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-(--color-text) drop-shadow-md">
            {profile.displayName}
          </span>
        </div>
      </button>

      {/* Center: source branding */}
      <div className="hidden select-none md:block">
        <span className="rounded-full bg-(--color-surface)/60 px-3 py-1 text-[11px] font-bold tracking-[0.15em] text-(--color-muted)/50 backdrop-blur-sm">
          LUMAFORGE
        </span>
      </div>

      {/* Right: indicators + time + layout toggle + Desktop */}
      <div className="flex items-center gap-2">
        {/* Network indicator */}
        {showNetwork && (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg transition"
            title={networkStatus === "online" ? "Online" : "Offline"}
            aria-label={`Network: ${networkStatus}`}
          >
            {networkStatus === "online" ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-rose-400" />
            )}
          </div>
        )}

        {/* Controller indicator */}
        {showController && (
          <ControllerIndicator />
        )}

        {/* Clock */}
        {showClock && time && (
          <span className="flex items-center gap-1 text-sm font-medium tabular-nums text-(--color-muted) drop-shadow-md">
            <Clock className="h-3 w-3" />
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

function ControllerIndicator() {
  const [connected, setConnected] = useState(() => {
    try {
      return (navigator.getGamepads?.().filter((g) => g !== null).length ?? 0) > 0;
    } catch { return false; }
  });

  useEffect(() => {
    function onConnect() {
      const count = navigator.getGamepads?.().filter((g) => g !== null).length ?? 0;
      setConnected(count > 0);
    }
    function onDisconnect() {
      const count = navigator.getGamepads?.().filter((g) => g !== null).length ?? 0;
      setConnected(count > 0);
    }
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  return (
    <div
      className="flex h-7 w-7 items-center justify-center rounded-lg transition"
      title={connected ? "Controller connected" : "No controller"}
      aria-label={connected ? "Controller connected" : "No controller"}
    >
      <Gamepad2 className={`h-3.5 w-3.5 ${connected ? "text-emerald-400" : "text-(--color-muted)/40"}`} />
    </div>
  );
}
