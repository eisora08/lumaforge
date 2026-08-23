import { Check } from "lucide-react";
import { SurfaceModeOption as SurfaceModeOptionType } from "../../types/theme";

type SurfaceModeOptionProps = {
  mode: SurfaceModeOptionType;
  selected: boolean;
  onSelect: (id: SurfaceModeOptionType["id"]) => void;
};

export default function SurfaceModeOption({
  mode,
  selected,
  onSelect,
}: SurfaceModeOptionProps) {
  return (
    <button
      onClick={() => onSelect(mode.id)}
      className={`rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-(--color-accent) bg-(--color-accent)/10"
          : "lf-surface lf-surface-hover"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-(--color-text)">
          {mode.name}
        </span>

        {selected && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-(--color-accent) text-(--color-accent-text)">
            <Check className="h-4 w-4" />
          </span>
        )}
      </div>

      <p className="text-xs leading-5 text-(--color-muted)">
        {mode.description}
      </p>
    </button>
  );
}