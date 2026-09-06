import type { ReactNode } from "react";

type ToggleOptionProps = {
  label: string;
  description?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  trailing?: ReactNode;
};

export default function ToggleOption({
  label,
  description,
  enabled,
  onChange,
  trailing,
}: ToggleOptionProps) {
  return (
    <div className="lf-surface flex items-center justify-between gap-4 rounded-2xl border p-4">
      <div>
        <p className="text-sm font-medium text-(--color-text)">
          {label}
        </p>

        {description && (
          <p className="mt-1 text-xs text-(--color-muted)">
            {description}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {trailing}
        <button
          type="button"
          onClick={() => onChange(!enabled)}
          className={`relative h-7 w-12 rounded-full transition ${
            enabled ? "bg-(--color-accent)" : "bg-white/10"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
              enabled ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}