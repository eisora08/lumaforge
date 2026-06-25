type SettingsInputProps = {
  label: string;
  description?: string;
  placeholder?: string;
  value?: string;
};

export default function SettingsInput({
  label,
  description,
  placeholder,
  value,
}: SettingsInputProps) {
  return (
    <label className="block">
      <div className="mb-2">
        <p className="text-sm font-medium text-(--color-text)">
          {label}
        </p>

        {description && (
          <p className="mt-1 text-xs text-(--color-muted)">
            {description}
          </p>
        )}
      </div>

      <input
        value={value}
        placeholder={placeholder}
        readOnly
        className="h-11 w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)"
      />
    </label>
  );
}