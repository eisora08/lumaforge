import { Activity, Clock, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGameActivity } from "../../context/GameActivityContext";

export default function ActivityFeed() {
  const { t } = useTranslation();
  const { activities } = useGameActivity();
  const recent = activities.slice(0, 5);

  function formatTimestamp(ts: number) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return t("dashboard.activity_feed.just_now", "Just now");
    if (mins < 60) return t("dashboard.activity_feed.minutes_ago", "{{mins}}m ago", { mins });
    if (hours < 24) return t("dashboard.activity_feed.hours_ago", "{{hours}}h ago", { hours });
    if (days < 7) return t("dashboard.activity_feed.days_ago", "{{days}}d ago", { days });
    return new Date(ts).toLocaleDateString();
  }

  return (
    <section className="lf-surface rounded-2xl border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-(--color-text)">
          {t("dashboard.activity_feed.title", "Actividad reciente")}
        </h2>

        <Info className="h-4 w-4 text-(--color-muted)" />
      </div>

      {recent.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Clock className="h-8 w-8 text-(--color-muted)" />
          <p className="text-sm text-(--color-muted)">
            {t("dashboard.activity_feed.empty", "Sin actividad reciente")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recent.map((activity) => (
            <div key={activity.id} className="flex gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5">
                <Activity className="h-4 w-4 text-(--color-muted)" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-(--color-text)">
                    {activity.title}
                  </h3>
                  <span className="shrink-0 text-[11px] text-(--color-muted)">
                    {formatTimestamp(activity.createdAt)}
                  </span>
                </div>

                {activity.description && (
                  <p className="mt-1 text-xs leading-5 text-(--color-muted)">
                    {activity.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}