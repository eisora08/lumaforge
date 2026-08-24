import { useTranslation } from "react-i18next";

type StoreGameContentSectionProps = {
  dlcLabel: string;
  dlcCount: number;
};

export default function StoreGameContentSection({
  dlcLabel,
  dlcCount,
}: StoreGameContentSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        {t("store.content.title", "Content For This Game")}
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        {dlcLabel}
      </p>

      {dlcCount > 0 && (
        <p className="mt-2 text-sm text-(--color-text)">
          {dlcCount === 1 ? t("store.content.count_1", "1 DLC item detected.") : t("store.content.count_x", "{{count}} DLC items detected.", { count: dlcCount })}
        </p>
      )}

      {dlcCount === 0 && (
        <p className="mt-4 rounded-xl border border-(--surface-active-border) bg-black/20 p-4 text-sm text-(--color-muted)">
          {t("store.content.empty", "No additional content detected for this game.")}
        </p>
      )}
    </section>
  );
}
