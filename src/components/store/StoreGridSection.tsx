import { Children, memo, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { countRender } from "../../services/perfCounters";

type StoreGridSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onViewAll?: () => void;
  sectionKey?: string;
  loading?: boolean;
  skeletonCount?: number;
  accent?: boolean;
};

function areSectionPropsEqual(
  a: StoreGridSectionProps,
  b: StoreGridSectionProps,
): boolean {
  if (a.title !== b.title) return false;
  if (a.description !== b.description) return false;
  if (a.sectionKey !== b.sectionKey) return false;
  if (a.loading !== b.loading) return false;
  if (a.accent !== b.accent) return false;
  if (a.skeletonCount !== b.skeletonCount) return false;
  if (a.onViewAll !== b.onViewAll) return false;
  return true;
}

function StoreGridSectionRaw({
  title,
  description,
  children,
  onViewAll,
  sectionKey,
  loading = false,
  skeletonCount = 12,
  accent = false,
}: StoreGridSectionProps) {
  const { t } = useTranslation();
  countRender("StoreGridSection");

  const items = Children.toArray(children);

  if (items.length === 0 && !loading) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className={`text-xl font-bold text-(--color-text) ${accent ? "lf-store-section-accent" : ""}`}>
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-(--color-muted)">
              {description}
            </p>
          )}
        </div>
        {onViewAll && !loading && (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97]"
          >
            {t("store.view_all", "View all")}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {loading
          ? Array.from({ length: skeletonCount }, (_, i) => (
              <div
                key={`skeleton-${i}`}
                className="lf-fade-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="lf-store-skeleton-card aspect-video w-full rounded-2xl" />
                <div className="mt-2.5 space-y-1.5">
                  <div className="lf-store-skeleton-card h-4 w-3/4 rounded" />
                  <div className="lf-store-skeleton-card h-3 w-1/2 rounded" />
                </div>
              </div>
            ))
          : items.map((item, index) => (
              <div
                key={sectionKey ? `${sectionKey}:steam:${index}` : index}
                className="lf-fade-in lf-store-card-glow"
                style={{ animationDelay: `${index * 25}ms` }}
              >
                {item}
              </div>
            ))}
      </div>
    </section>
  );
}

const StoreGridSection = memo(StoreGridSectionRaw, areSectionPropsEqual);
export default StoreGridSection;
