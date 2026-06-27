import type { ElementType, ReactNode } from "react";

type StatusPillProps = {
  children: ReactNode;
  className?: string;
};

export function StatusPill({ children, className = "" }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${className}`}
    >
      {children}
    </span>
  );
}

type InfoBlockProps = {
  icon: ElementType;
  label: string;
  value: string;
  description: string;
};

export function InfoBlock({
  icon: Icon,
  label,
  value,
  description,
}: InfoBlockProps) {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-(--color-muted)">
        <Icon className="h-4 w-4 text-(--color-accent)" />
        {label}
      </div>

      <p className="text-sm font-bold text-(--color-text)">
        {value}
      </p>

      <p className="mt-1 text-xs text-(--color-muted)">
        {description}
      </p>
    </div>
  );
}

type SummaryLineProps = {
  label: string;
  value: string;
};

export function SummaryLine({ label, value }: SummaryLineProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
      <span className="text-xs text-(--color-muted)">
        {label}
      </span>

      <span className="truncate text-xs font-semibold text-(--color-text)">
        {value}
      </span>
    </div>
  );
}
