import type React from "react";

type Props = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  compact?: boolean;
  action?: React.ReactNode;
};

export default function ActivityEmptyState({ icon: Icon, title, description, compact, action }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-8" : "py-12"}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-(--color-border)/15 bg-white/[0.03] mb-4">
        <Icon className="h-6 w-6 text-(--color-muted)/30" />
      </div>
      <p className="text-sm font-medium text-(--color-text)/80">{title}</p>
      <p className="mt-1.5 text-xs text-(--color-muted)/60 max-w-[260px]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
