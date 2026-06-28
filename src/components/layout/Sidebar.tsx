import type { ElementType } from "react";

import {
  Award,
  Store,
  Download,
  Library,
  Home,
  Menu,
  RotateCcw,
  Settings,
  Wrench,
  X,
  Flame,
} from "lucide-react";

import { AppPage } from "../../types/navigation";
import SidebarLibraryList from "./SidebarLibraryList";

type SidebarProps = {
  isOpen: boolean;
  isCollapsed: boolean;
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
  { label: "Logros", page: "achievements", icon: Award },
];

const toolItems: SidebarItem[] = [
  { label: "Herramientas", page: "tools", icon: Wrench },
  { label: "Configuración", page: "settings", icon: Settings },
];

export default function Sidebar({
  isOpen,
  isCollapsed,
  activePage,
  onClose,
  onToggleCollapse,
  onNavigate,
}: SidebarProps) {
  function handleNavigate(page: AppPage) {
    onNavigate(page);
    onClose();
  }

  function handleOpenGame() {
    onNavigate("library-game-detail");
    onClose();
  }

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r lf-shell transition-all duration-300 lg:static ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${isCollapsed ? "lg:w-20" : "lg:w-72"}`}
      >
        <div className="flex h-16 items-center justify-between border-b border-(--shell-border) px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-(--color-accent)/20 bg-(--color-accent)/10">
              <Flame className="h-5 w-5 text-(--color-accent)" />
            </div>

            {!isCollapsed && (
              <div className="min-w-0">
                <h1 className="font-bold leading-none text-(--color-text)">
                  LumaForge
                </h1>

                <p className="mt-1 text-[11px] text-(--color-muted)">
                  Premium Game Toolkit
                </p>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-(--color-muted) hover:bg-white/10 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>

          <button
            onClick={onToggleCollapse}
            className="hidden h-9 w-9 items-center justify-center rounded-xl text-(--color-muted) hover:bg-white/10 lg:flex"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarSection
            title="Principal"
            items={mainItems}
            activePage={activePage}
            isCollapsed={isCollapsed}
            onNavigate={handleNavigate}
          />

          <div className="my-4 h-px bg-(--shell-border)" />

          <SidebarSection
            title="Sistema"
            items={toolItems}
            activePage={activePage}
            isCollapsed={isCollapsed}
            onNavigate={handleNavigate}
          />

          <div className="my-4 h-px bg-(--shell-border)" />

          {!isCollapsed && <SidebarLibraryList onOpenGame={handleOpenGame} />}

          <button
            className={`mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-(--color-muted) hover:bg-white/6 hover:text-(--color-text) ${
              isCollapsed ? "lg:justify-center" : ""
            }`}
          >
            <RotateCcw className="h-5 w-5 shrink-0 text-(--color-muted)" />

            {!isCollapsed && <span>Reiniciar Steam</span>}
          </button>
        </div>

        <div className="border-t border-(--shell-border) p-3">
          <div
            className={`lf-surface rounded-2xl border p-3 ${
              isCollapsed ? "hidden lg:block" : ""
            }`}
          >
            {isCollapsed ? (
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
                <Store className="h-4 w-4 text-emerald-400" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                  <Store className="h-4 w-4 text-emerald-400" />
                  Sistema listo
                </div>

                <p className="mt-1 text-xs text-(--color-muted)">
                  Esperando detección de Steam.
                </p>
              </>
            )}
          </div>

          {!isCollapsed && (
            <p className="mt-3 px-1 text-[11px] text-(--color-muted)">
              v0.1.0 Preview
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

type SidebarSectionProps = {
  title: string;
  items: SidebarItem[];
  activePage: AppPage;
  isCollapsed: boolean;
  onNavigate: (page: AppPage) => void;
};

function SidebarSection({
  title,
  items,
  activePage,
  isCollapsed,
  onNavigate,
}: SidebarSectionProps) {
  return (
    <div>
      {!isCollapsed && (
        <p className="mb-2 px-3 text-[11px] uppercase tracking-[0.18em] text-(--color-muted)">
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
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
                isActive
                  ? "border border-(--color-accent)/20 bg-(--color-accent)/10 text-(--color-text)"
                  : "text-(--color-muted) hover:bg-white/6 hover:text-(--color-text)"
              } ${isCollapsed ? "lg:justify-center" : ""}`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 ${
                  isActive
                    ? "text-(--color-accent)"
                    : "text-(--color-muted) group-hover:text-(--color-text)"
                }`}
              />

              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}