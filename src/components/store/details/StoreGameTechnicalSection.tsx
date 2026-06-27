export default function StoreGameTechnicalSection() {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        System Requirements
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        Steam system requirements not available yet.
      </p>

      <div className="mt-4 rounded-xl border border-(--surface-active-border) bg-black/20 p-4 text-sm text-(--color-muted)">
        System requirements data will appear here once available from Steam metadata.
      </div>
    </section>
  );
}
