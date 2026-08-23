import { RotateCcw } from "lucide-react";

type AccentColorPickerProps = {
  value: string | null;
  themeAccent: string;
  onChange: (hex: string | null) => void;
};

export default function AccentColorPicker({
  value,
  themeAccent,
  onChange,
}: AccentColorPickerProps) {
  const activeHex = value ?? themeAccent;
  const hasOverride = value !== null;

  return (
    <div className="lf-surface flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4">
      <div>
        <p className="text-sm font-medium text-(--color-text)">Color de acento</p>
        <p className="mt-1 text-xs text-(--color-muted)">
          Personaliza el color resaltado (botones, selección, enlaces) sobre el tema activo.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-(--color-muted)">{activeHex}</span>

        <label
          className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-xl border border-white/15 shadow-sm transition hover:scale-105"
          style={{ background: activeHex }}
          title={
            hasOverride
              ? "Cambiar color de acento"
              : "Usa el acento del tema o elige uno propio"
          }
        >
          <input
            type="color"
            value={activeHex}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        {hasOverride && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            title="Restaurar el color del tema"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar
          </button>
        )}
      </div>
    </div>
  );
}
