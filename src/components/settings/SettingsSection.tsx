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
    <section className="lf-surface rounded-2xl border p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-(--color-text)">
          {title}
        </h2>

        {description && (
          <p className="mt-1 text-sm text-(--color-muted)">
            {description}
          </p>
        )}
      </div>

      {children}
    </section>
  );
}