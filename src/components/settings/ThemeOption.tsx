import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <button
      onClick={() => onSelect(theme.id)}
      className={`rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-(--color-accent) bg-(--color-accent)/10"
          : "lf-surface lf-surface-hover"
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
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-(--color-accent) text-(--color-accent-text)">
            <Check className="h-4 w-4" />
          </div>
        )}
      </div>

      <h3 className="font-medium text-(--color-text)">
        {theme.name}
      </h3>

      <p className="mt-1 text-xs leading-5 text-(--color-muted)">
        {theme.descriptionKey ? t(theme.descriptionKey, theme.description) : theme.description}
      </p>
    </button>
  );
}