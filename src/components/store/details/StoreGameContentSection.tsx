type StoreGameContentSectionProps = {
  dlcLabel: string;
  dlcCount: number;
};

export default function StoreGameContentSection({
  dlcLabel,
  dlcCount,
}: StoreGameContentSectionProps) {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        Content For This Game
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        {dlcLabel}
      </p>

      {dlcCount > 0 && (
        <p className="mt-2 text-sm text-(--color-text)">
          {dlcCount} DLC item{dlcCount !== 1 ? "s" : ""} detected.
        </p>
      )}

      {dlcCount === 0 && (
        <p className="mt-4 rounded-xl border border-(--surface-active-border) bg-black/20 p-4 text-sm text-(--color-muted)">
          No additional content detected for this game.
        </p>
      )}
    </section>
  );
}
