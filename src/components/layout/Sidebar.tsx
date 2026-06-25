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

type SidebarProps = {
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
};

const mainItems = [
  { label: "Inicio", icon: Home, active: true },
  { label: "Biblioteca", icon: Library },
  { label: "Juegos", icon: Gamepad2 },
  { label: "Paquetes", icon: PackageSearch },
  { label: "Descargas", icon: Download },
  { label: "Logros", icon: Award },
  { label: "Actividad", icon: Activity },
];

const toolItems = [
  { label: "Verificación", icon: ShieldCheck },
  { label: "Herramientas", icon: Wrench },
  { label: "Reiniciar Steam", icon: RotateCcw },
  { label: "Configuración", icon: Settings },
];

export default function Sidebar({
  isOpen,
  isCollapsed,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 border-r border-white/10 bg-[#140d10]/95 backdrop-blur-xl transition-all duration-300 flex flex-col ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${isCollapsed ? "lg:w-20" : "lg:w-72"} w-72`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-2xl bg-[#b8d7dc]/10 border border-[#b8d7dc]/20 flex items-center justify-center">
              <Flame className="h-5 w-5 text-[#b8d7dc]" />
            </div>

            {!isCollapsed && (
              <div className="min-w-0">
                <h1 className="text-white font-bold leading-none">
                  LumaForge
                </h1>
                <p className="text-[11px] text-gray-500 mt-1">
                  Premium Game Toolkit
                </p>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="lg:hidden h-9 w-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>

          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex h-9 w-9 rounded-xl hover:bg-white/10 items-center justify-center text-gray-300"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarSection
            title="Principal"
            items={mainItems}
            isCollapsed={isCollapsed}
          />

          <div className="my-4 h-px bg-white/10" />

          <SidebarSection
            title="Sistema"
            items={toolItems}
            isCollapsed={isCollapsed}
          />
        </div>

        <div className="p-3 border-t border-white/10">
          <div
            className={`rounded-2xl bg-white/[0.04] border border-white/10 p-3 ${
              isCollapsed ? "hidden lg:block" : ""
            }`}
          >
            {isCollapsed ? (
              <div className="h-9 w-9 mx-auto rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Boxes className="h-4 w-4 text-emerald-400" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-white font-medium">
                  <Boxes className="h-4 w-4 text-emerald-400" />
                  Sistema listo
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Esperando detección de Steam.
                </p>
              </>
            )}
          </div>

          {!isCollapsed && (
            <p className="text-[11px] text-gray-600 mt-3 px-1">
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
  items: {
    label: string;
    icon: React.ElementType;
    active?: boolean;
  }[];
  isCollapsed: boolean;
};

function SidebarSection({ title, items, isCollapsed }: SidebarSectionProps) {
  return (
    <div>
      {!isCollapsed && (
        <p className="px-3 mb-2 text-[11px] uppercase tracking-[0.18em] text-gray-600">
          {title}
        </p>
      )}

      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.label}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition group ${
                item.active
                  ? "bg-[#b8d7dc]/10 text-white border border-[#b8d7dc]/15"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.06]"
              } ${isCollapsed ? "lg:justify-center" : ""}`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 ${
                  item.active ? "text-[#b8d7dc]" : "text-gray-500 group-hover:text-gray-300"
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