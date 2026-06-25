import type { ElementType } from "react";

import {
  Activity,
  Award,
  Boxes,
  Download,
  Gamepad2,
  Home,
  Library,
  Menu,
  PackageSearch,
  RotateCcw,
  Settings,
  ShieldCheck,
  Wrench,
  X,
  Flame,
} from "lucide-react";

import { AppPage } from "../../types/navigation";

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
  { label: "Juegos", page: "games", icon: Gamepad2 },
  { label: "Paquetes", page: "packages", icon: PackageSearch },
  { label: "Descargas", page: "downloads", icon: Download },
  { label: "Logros", page: "achievements", icon: Award },
  { label: "Actividad", page: "activity", icon: Activity },
];

const toolItems: SidebarItem[] = [
  { label: "Verificación", page: "verification", icon: ShieldCheck },
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

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 flex flex-col border-r border-(--color-border) bg-(--color-sidebar)/95 backdrop-blur-xl transition-all duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${isCollapsed ? "lg:w-20" : "lg:w-72"} w-72`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-(--color-border)">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-2xl bg-(--color-accent)/10 border border-(--color-accent)/20 flex items-center justify-center">
              <Flame className="h-5 w-5 text-(--color-accent)" />
            </div>

            {!isCollapsed && (
              <div className="min-w-0">
                <h1 className="text-(--color-text) font-bold leading-none">
                  LumaForge
                </h1>

                <p className="text-[11px] text-(--color-muted) mt-1">
                  Premium Game Toolkit
                </p>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="lg:hidden h-9 w-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-(--color-muted)"
          >
            <X className="h-5 w-5" />
          </button>

          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex h-9 w-9 rounded-xl hover:bg-white/10 items-center justify-center text-(--color-muted)"
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

          <div className="my-4 h-px bg-(--color-border)" />

          <SidebarSection
            title="Sistema"
            items={toolItems}
            activePage={activePage}
            isCollapsed={isCollapsed}
            onNavigate={handleNavigate}
          />

          <button
            className={`mt-3 w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-(--color-muted) hover:text-(--color-text) hover:bg-white/6 ${
              isCollapsed ? "lg:justify-center" : ""
            }`}
          >
            <RotateCcw className="h-5 w-5 shrink-0 text-(--color-muted)" />

            {!isCollapsed && <span>Reiniciar Steam</span>}
          </button>
        </div>

        <div className="p-3 border-t border-(--color-border)">
          <div
            className={`rounded-2xl bg-white/4 border border-(--color-border) p-3 ${
              isCollapsed ? "hidden lg:block" : ""
            }`}
          >
            {isCollapsed ? (
              <div className="h-9 w-9 mx-auto rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Boxes className="h-4 w-4 text-emerald-400" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-(--color-text) font-medium">
                  <Boxes className="h-4 w-4 text-emerald-400" />
                  Sistema listo
                </div>

                <p className="text-xs text-(--color-muted) mt-1">
                  Esperando detección de Steam.
                </p>
              </>
            )}
          </div>

          {!isCollapsed && (
            <p className="text-[11px] text-(--color-muted) mt-3 px-1">
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
        <p className="px-3 mb-2 text-[11px] uppercase tracking-[0.18em] text-(--color-muted)">
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
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition group ${
                isActive
                  ? "bg-(--color-accent)/10 text-(--color-text) border border-(--color-accent)/20"
                  : "text-(--color-muted) hover:text-(--color-text) hover:bg-white/6"
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