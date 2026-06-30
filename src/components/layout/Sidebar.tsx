import { useCallback, useEffect, useRef, type ElementType } from "react";

import {
  Activity,
  Award,
  ChevronLeft,
  ChevronRight,
  Store,
  Download,
  Library,
  Home,
  RotateCcw,
  Settings,
  Wrench,
  X,
  Flame,
} from "lucide-react";

import type { AppPage } from "../../types/navigation";
import SidebarLibraryList from "./SidebarLibraryList";

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
  { label: "Actividad", page: "activity", icon: Activity },
  { label: "Logros", page: "achievements", icon: Award },
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
      className={`flex h-full flex-col lf-sidebar-panel ${
        isCollapsed ? "w-[72px]" : mode === "compact" ? "w-[340px]" : "w-[360px]"
      }`}
    >
      {/* Header — shrink-0 */}
      <div
        className={`flex shrink-0 h-16 items-center ${
          showLabels ? "justify-between px-5" : "justify-center px-2"
        }`}
      >
        <div
          className={`flex min-w-0 items-center gap-3 ${
            isCollapsed ? "justify-center" : ""
          }`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-(--color-accent)/10 bg-(--color-accent)/8">
            <Flame className="h-4.5 w-4.5 text-(--color-accent)" />
          </div>

          <div
            className={`min-w-0 lf-sidebar-label ${
              showLabels
                ? "lf-sidebar-label-visible"
                : "lf-sidebar-label-hidden"
            }`}
          >
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

        {/* Close button (drawer) */}
        {isDrawer && (
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-(--color-muted) hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
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
      <div className={`flex-1 min-h-0 overflow-y-auto lf-scroll-area will-change-transform ${
        showLabels ? "px-4" : "px-3"
      }`}>        
        {showLabels && (
          <div className="pt-1">
            <SidebarLibraryList
              onOpenGame={handleOpenGame}
              compact={mode === "compact"}
            />
          </div>
        )}

        {isCollapsed && (
          <div className="pt-1">
            <SidebarLibraryList
              onOpenGame={handleOpenGame}
              compact={false}
              collapsed={true}
            />
          </div>
        )}
      </div>

      {/* Bottom block — shrink-0, pinned at bottom */}
      <div className={`shrink-0 ${
        showLabels ? "px-4 pt-2 pb-4" : "px-3 pt-2 pb-3"
      }`}>
        {/* Restart Steam */}
        <button
          title={isCollapsed ? "Reiniciar Steam" : undefined}
          className={`mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-xs text-(--color-muted)/60 transition-colors hover:bg-white/[0.04] hover:text-(--color-muted) lf-press-effect ${
            isCollapsed ? "justify-center" : ""
          }`}
        >
          <RotateCcw className="h-5 w-5 shrink-0 text-(--color-muted)" />
          <span
            className={`lf-sidebar-label ${
              showLabels
                ? "lf-sidebar-label-visible"
                : "lf-sidebar-label-hidden"
            }`}
          >
            Reiniciar Steam
          </span>
        </button>

        {/* System status */}
        <div
          className={`lf-surface rounded-2xl ${
            isCollapsed ? "p-2" : "p-3"
          }`}
          title={isCollapsed ? "Sistema listo" : undefined}
        >
          {isCollapsed ? (
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
              <Store className="h-4 w-4 text-emerald-400" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                <div className="flex h-2 w-2 items-center justify-center">
                  <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
                </div>
                Sistema listo
              </div>
              {mode === "expanded" && (
                <p className="mt-1.5 text-[11px] text-(--color-muted)">
                  Esperando detección de Steam.
                </p>
              )}
            </>
          )}
        </div>

        {showLabels && (
          <p className="mt-3 px-1 text-[10px] text-(--color-muted)/50">
            v0.1.0 Preview
          </p>
        )}
      </div>

      {/* Collapse/expand toggle (desktop only, not in drawer mode) */}
      {!isDrawer && (
        <button
          onClick={onToggleCollapse}
          title={isCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
          className="absolute -right-3 top-24 z-50 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-(--color-surface) text-(--color-muted) shadow-md transition-colors hover:bg-(--color-panel) hover:text-(--color-text) hover:shadow-lg focus-visible:ring-2 focus-visible:ring-(--color-accent) lf-press-effect"
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      )}
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
        isCollapsed ? "w-[72px]" : mode === "compact" ? "w-[340px]" : "w-[360px]"
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
              className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors lf-press-effect ${
                isActive
                  ? "bg-(--color-accent)/8 text-(--color-text)"
                  : "text-(--color-muted) hover:bg-white/[0.06] hover:text-(--color-text)"
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
