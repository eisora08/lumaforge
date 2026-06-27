type StoreGameLanguagesPanelProps = {
  languages: string[];
};

export default function StoreGameLanguagesPanel({
  languages,
}: StoreGameLanguagesPanelProps) {
  if (languages.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        Supported Languages
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        Languages detected from Steam metadata.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {languages.map((language) => (
          <span
            key={language}
            className="rounded-md border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-white/75"
          >
            {language}
          </span>
        ))}
      </div>
    </section>
  );
}
