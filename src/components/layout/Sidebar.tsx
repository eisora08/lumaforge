import { useCallback, useEffect, useRef, useState, type ElementType } from "react";

import {
  Award,
  Store,
  Download,
  Library,
  Home,
  RotateCcw,
  Settings,
  Wrench,
  X,
  Flame,
  PanelLeftOpen,
  PanelLeftClose,
  Ellipsis,
  BarChart3,
} from "lucide-react";

import type { AppPage } from "../../types/navigation";
import SidebarLibraryList from "./SidebarLibraryList";
import { useUserProfile, saveUserProfile, resolveProfileMediaUrl } from "../../features/profile/userProfile";
import { getAvatarPreset } from "../../features/profile/profilePresets";
import ProfileModal from "../../features/profile/ProfileModal";
import { getPlayerProfile, subscribeAchievementStore } from "../../features/activity/achievements/achievementStore";

export type SidebarMode = "expanded" | "compact" | "collapsed" | "drawer";

type SidebarProps = {
  mode: SidebarMode;
  isDrawerOpen: boolean;
  activePage: AppPage;
  onClose: () => void;
  onToggleCollapse: () => void;
  onNavigate: (page: AppPage) => void;
};

type SidebarItem = {
  label: string;
  page: AppPage;
  icon: ElementType;
};

const mainItems: SidebarItem[] = [
  { label: "Inicio", page: "home", icon: Home },
  { label: "Biblioteca", page: "library", icon: Library },
  { label: "Tienda", page: "store", icon: Store },
  { label: "Descargas", page: "downloads", icon: Download },
  { label: "Stats", page: "activity", icon: BarChart3 },
  { label: "Logros", page: "launcher-achievements", icon: Award },
];

const toolItems: SidebarItem[] = [
  { label: "Herramientas", page: "tools", icon: Wrench },
  { label: "Configuración", page: "settings", icon: Settings },
];

const isNavExpanded = (mode: SidebarMode) =>
  mode === "expanded" || mode === "compact";

export default function Sidebar({
  mode,
  isDrawerOpen,
  activePage,
  onClose,
  onToggleCollapse,
  onNavigate,
}: SidebarProps) {
  const isDrawer = mode === "drawer";
  const showLabels = isNavExpanded(mode);
  const isCollapsed = mode === "collapsed";
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [profile, patchProfile] = useUserProfile();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);
  const avatarPreset = getAvatarPreset(profile.avatarPreset);
  const avatarDisplayUrl = resolveProfileMediaUrl(profile.avatarUrl);
  const [playerProfile, setPlayerProfile] = useState(() => getPlayerProfile());

  useEffect(() => {
    return subscribeAchievementStore(() => setPlayerProfile(getPlayerProfile()));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node) &&
        profileBtnRef.current &&
        !profileBtnRef.current.contains(e.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleNavigate(page: AppPage) {
    onNavigate(page);
    if (isDrawer) onClose();
  }

  function handleOpenGame() {
    onNavigate("library-game-detail");
    if (isDrawer) onClose();
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDrawer && isDrawerOpen) {
        onClose();
      }
    },
    [isDrawer, isDrawerOpen, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const sidebarContent = (
    <div
      className={`flex h-full flex-col lf-sidebar-panel bg-(--shell-bg) ${
        isCollapsed ? "w-18" : mode === "compact" ? "w-85" : "w-90"
      }`}
      style={{ backdropFilter: 'var(--shell-blur, none)', WebkitBackdropFilter: 'var(--shell-blur, none)' } as React.CSSProperties}
    >
      {/* Header — shrink-0 */}
      <div
        className={`flex shrink-0 h-16 items-center ${
          isCollapsed ? "justify-center px-2" : isDrawer ? "justify-between px-5" : "justify-between px-5"
        }`}
      >
        {isCollapsed ? (
          /* Collapsed: centered logo button with hover swap to PanelLeftOpen */
          <button
            onClick={onToggleCollapse}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="group relative flex h-9 w-9 items-center justify-center rounded-xl border border-(--color-accent)/10 bg-(--color-accent)/8 transition hover:bg-white/10 active:scale-[0.97] lf-press-effect"
          >
            <Flame className="absolute h-4.5 w-4.5 text-(--color-accent) transition-all duration-200 opacity-100 scale-100 group-hover:opacity-0 group-hover:scale-90 group-focus-visible:opacity-0" />
            <PanelLeftOpen className="absolute h-4 w-4 text-(--color-accent) transition-all duration-200 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100" />
          </button>
        ) : (
          <>
            {/* Left: logo + title */}
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-(--color-accent)/10 bg-(--color-accent)/8">
                <Flame className="h-4.5 w-4.5 text-(--color-accent)" />
              </div>

              <div className="min-w-0 lf-sidebar-label lf-sidebar-label-visible">
                <h1 className="font-bold leading-none text-(--color-text)">
                  LumaForge
                </h1>
                {mode === "expanded" && (
                  <p className="mt-1.5 text-[10px] text-(--color-muted)/50">
                    Premium Game Toolkit
                  </p>
                )}
              </div>
            </div>

            {/* Right: close button (drawer) or collapse toggle (desktop) */}
            {isDrawer ? (
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-(--color-muted) hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <button
                onClick={onToggleCollapse}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) active:scale-[0.97] lf-press-effect"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Nav sections — shrink-0, always visible */}
      <div className={`shrink-0 ${
        showLabels ? "px-4 pb-1" : "px-3 pb-1"
      }`}>
        <SidebarSection
          title="Principal"
          items={mainItems}
          activePage={activePage}
          showLabels={showLabels}
          isCollapsed={isCollapsed}
          onNavigate={handleNavigate}
        />

        <div className={showLabels ? "mt-3" : "mt-2"}>
          <SidebarSection
            title="Sistema"
            items={toolItems}
            activePage={activePage}
            showLabels={showLabels}
            isCollapsed={isCollapsed}
            onNavigate={handleNavigate}
          />
        </div>
      </div>

      {/* Game list — flex-1, fills remaining space, scrolls internally */}
      <div className={`flex flex-col flex-1 min-h-0 ${
        showLabels ? "px-4" : "px-3"
      }`}>
        {/* Sticky header + search — outside scroll, stays fixed */}
        {showLabels && (
          <div className="shrink-0 pt-3">
            <SidebarLibraryList
              onOpenGame={handleOpenGame}
              activePage={activePage}
              compact={mode === "compact"}
              variant="header"
              searchQuery={sidebarSearchQuery}
              onSearchChange={setSidebarSearchQuery}
            />
          </div>
        )}

        {/* Scrollable game items */}
        <div className="flex-1 min-h-0 overflow-y-auto lf-scroll-area will-change-transform pt-2">
          {showLabels && (
            <SidebarLibraryList
              onOpenGame={handleOpenGame}
              activePage={activePage}
              compact={mode === "compact"}
              variant="list"
              searchQuery={sidebarSearchQuery}
            />
          )}

          {isCollapsed && (
            <SidebarLibraryList
              onOpenGame={handleOpenGame}
              activePage={activePage}
              compact={false}
              collapsed={true}
            />
          )}
        </div>
      </div>

      {/* Bottom block — shrink-0, pinned at bottom */}
      <div className={`shrink-0 ${
        showLabels ? "px-4 pt-1 pb-4" : "px-3 pt-1 pb-3"
      }`}>
        {/* Profile card — distinct from game rows */}
        <div className="relative">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setProfileModalOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProfileModalOpen(true); } }}
            className={`group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-(--color-border)/30 bg-(--color-surface) p-3 text-left transition hover:border-(--color-border)/60 hover:brightness-110 hover:ring-1 hover:ring-(--color-accent)/15 ${
              isCollapsed ? "justify-center" : ""
            }`}
            title={isCollapsed ? `${profile.displayName} — ${profile.status}` : undefined}
          >
            <div className="relative shrink-0">
              <div
                className={`flex items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10 ${
                  isCollapsed ? "h-10 w-10" : "h-10 w-10"
                }`}
                style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
              >
                {avatarDisplayUrl ? (
                  <img
                    src={avatarDisplayUrl}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="text-lg">{avatarPreset?.icon ?? "🎮"}</span>
                )}
              </div>
              <span
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-(--color-bg)"
                style={{ background: "var(--color-accent)" }}
              />
            </div>

            {!isCollapsed && (
              <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className="text-sm font-semibold text-(--color-text) truncate w-full">
                  {profile.displayName}
                </span>
                <span className="text-[11px] text-(--color-muted)/70 truncate max-w-32">
                  {profile.status}
                </span>
                {playerProfile.level > 0 && (
                  <div className="mt-1.5 w-full">
                    <div className="flex items-center gap-1.5">
                      <div className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400/15 px-1.5">
                        <span className="text-[9px] font-bold text-amber-400">Lv.{playerProfile.level}</span>
                      </div>
                      <span className="text-[9px] text-amber-400/50">{playerProfile.totalXp} XP</span>
                    </div>
                    <div className="mt-1 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-400/50 transition-all duration-500"
                        style={{ width: `${Math.max(2, playerProfile.progressPercent)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isCollapsed && (
              <button
                ref={profileBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileMenuOpen((p) => !p);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--color-muted)/30 opacity-0 transition hover:bg-white/8 hover:text-(--color-muted) group-hover:opacity-100"
                aria-label="Profile menu"
              >
                <Ellipsis className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Dropdown menu — anchored to ellipsis button corner */}
          {profileMenuOpen && (
            <div
              ref={profileMenuRef}
              className="absolute right-0 bottom-full mb-2 w-48 rounded-xl border border-(--color-border) bg-(--color-surface) p-1.5 shadow-2xl z-[100]"
            >
              <button
                onClick={() => {
                  setProfileMenuOpen(false);
                  onNavigate("settings");
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-(--color-text) transition hover:bg-white/8"
              >
                <Settings className="h-4 w-4 text-(--color-muted)" />
                Configuración
              </button>
              <button
                onClick={() => {
                  setProfileMenuOpen(false);
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-(--color-muted)/70 transition hover:bg-white/8 hover:text-(--color-text)"
              >
                <RotateCcw className="h-4 w-4" />
                Reiniciar Steam
              </button>
            </div>
          )}
        </div>

        {showLabels && (
          <p className="mt-3 px-1 text-[10px] text-(--color-muted)/50">
            v0.1.0 Preview
          </p>
        )}
      </div>

      {/* Profile Modal */}
      <ProfileModal
        open={profileModalOpen}
        profile={profile}
        onSave={(updated) => {
          saveUserProfile(updated);
          patchProfile(updated);
        }}
        onClose={() => setProfileModalOpen(false)}
      />


    </div>
  );

  if (isDrawer) {
    return (
      <>
        {isDrawerOpen && (
          <div
            onClick={onClose}
            className="lf-sidebar-overlay fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          />
        )}

        <aside
          ref={drawerRef}
          className={`fixed inset-y-0 left-0 z-40 ${
            isDrawerOpen
              ? "lf-sidebar-drawer"
              : "lf-sidebar-drawer-exit"
          } ${isDrawerOpen ? "" : "pointer-events-none"}`}
          style={{ width: "360px" }}
        >
          {sidebarContent}
        </aside>
      </>
    );
  }

  return (
    <aside
      className={`relative z-10 lf-sidebar-panel ${
        isCollapsed ? "w-18" : mode === "compact" ? "w-85" : "w-90"
      }`}
    >
      {sidebarContent}
    </aside>
  );
}

type SidebarSectionProps = {
  title: string;
  items: SidebarItem[];
  activePage: AppPage;
  showLabels: boolean;
  isCollapsed: boolean;
  onNavigate: (page: AppPage) => void;
};

function SidebarSection({
  title,
  items,
  activePage,
  showLabels,
  isCollapsed,
  onNavigate,
}: SidebarSectionProps) {
  return (
    <div>
      {showLabels && (
        <p className="mb-2.5 px-3 text-[10px] uppercase tracking-[0.2em] text-(--color-muted)/50">
          {title}
        </p>
      )}

      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.page;

          return (
            <button
              key={item.label}
              onClick={() => onNavigate(item.page)}
              title={isCollapsed ? item.label : undefined}
              className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 lf-press-effect lf-hover-lift ${
                isActive
                  ? "bg-(--color-accent)/8 text-(--color-text) lf-active-glow border-l-[3px] border-l-(--color-accent)/40"
                  : "text-(--color-muted) hover:bg-white/6 hover:text-(--color-text)"
              } ${isCollapsed ? "justify-center" : ""}`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 ${
                  isActive
                    ? "text-(--color-accent)"
                    : "text-(--color-muted) group-hover:text-(--color-text)"
                }`}
              />

              {showLabels && (
                <span className="lf-sidebar-label lf-sidebar-label-visible">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
