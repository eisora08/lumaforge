type ToggleOptionProps = {
  label: string;
  description?: string;
  enabled?: boolean;
};

export default function ToggleOption({
  label,
  description,
  enabled = false,
}: ToggleOptionProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/3 p-4">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>

        {description && (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        )}
      </div>

      <button
        className={`relative h-7 w-12 rounded-full transition ${
          enabled ? "bg-[#b8d7dc]" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
            enabled ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}