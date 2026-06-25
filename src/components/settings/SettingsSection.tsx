type SettingsSectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export default function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#302b2f] p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">{title}</h2>

        {description && (
          <p className="mt-1 text-sm text-gray-400">{description}</p>
        )}
      </div>

      {children}
    </section>
  );
}