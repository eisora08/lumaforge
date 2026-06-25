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
        <p className="text-sm font-medium text-white">{label}</p>

        {description && (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        )}
      </div>

      <input
        value={value}
        placeholder={placeholder}
        readOnly
        className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#b8d7dc]/40"
      />
    </label>
  );
}
