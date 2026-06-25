import { Check } from "lucide-react";
import { ThemeOption as ThemeOptionType } from "../../types/theme";

type ThemeOptionProps = {
  theme: ThemeOptionType;
  selected: boolean;
  onSelect: (id: ThemeOptionType["id"]) => void;
};

export default function ThemeOption({
  theme,
  selected,
  onSelect,
}: ThemeOptionProps) {
  return (
    <button
      onClick={() => onSelect(theme.id)}
      className={`group rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-[#b8d7dc]/50 bg-[#b8d7dc]/10"
          : "border-white/10 bg-white/3 hover:bg-white/6"
      }`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          <span
            className="h-7 w-7 rounded-full border border-white/10"
            style={{ background: theme.preview.background }}
          />
          <span
            className="h-7 w-7 rounded-full border border-white/10"
            style={{ background: theme.preview.surface }}
          />
          <span
            className="h-7 w-7 rounded-full border border-white/10"
            style={{ background: theme.preview.accent }}
          />
        </div>

        {selected && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#b8d7dc] text-black">
            <Check className="h-4 w-4" />
          </div>
        )}
      </div>

      <h3 className="font-medium text-white">{theme.name}</h3>
      <p className="mt-1 text-xs leading-5 text-gray-400">
        {theme.description}
      </p>
    </button>
  );
}