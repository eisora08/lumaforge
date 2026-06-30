import {
  Download,
  RefreshCcw,
  Search,
  Settings,
} from "lucide-react";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

const actions = [
  {
    label: "Scan Library",
    icon: Search,
    action: "library" as AppPage,
    color: "text-emerald-300",
  },
  {
    label: "Refresh Sources",
    icon: RefreshCcw,
    action: "store" as AppPage,
    color: "text-purple-300",
  },
  {
    label: "Downloads",
    icon: Download,
    action: "downloads" as AppPage,
    color: "text-sky-300",
  },
  {
    label: "Settings",
    icon: Settings,
    action: "settings" as AppPage,
    color: "text-orange-300",
  },
];

export default function QuickActionsCompact({ onNavigate }: Props) {
  return (
    <section>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              onClick={() => onNavigate?.(action.action)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/[0.03] px-4 py-2.5 text-sm text-(--color-muted) transition hover:bg-white/[0.06] hover:text-(--color-text)"
            >
              <Icon className={`h-4 w-4 ${action.color}`} />
              {action.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
