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
  },
  {
    label: "Refresh Sources",
    icon: RefreshCcw,
    action: "store" as AppPage,
  },
  {
    label: "Downloads",
    icon: Download,
    action: "downloads",
  },
  {
    label: "Settings",
    icon: Settings,
    action: "settings" as AppPage,
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
              onClick={() => {
                if (action.action === "downloads") {
                  window.dispatchEvent(new CustomEvent("lumaforge-open-downloads"));
                } else {
                  onNavigate?.(action.action as AppPage);
                }
              }}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/[0.03] px-4 py-2.5 text-sm text-(--color-muted) transition hover:bg-white/[0.06] hover:text-(--color-text)"
            >
              <Icon className="h-4 w-4 text-(--color-muted)" />
              {action.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
