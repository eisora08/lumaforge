import { Gamepad2, Play, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function LibraryPreview() {
  const { t } = useTranslation();

  const games = [
    {
      title: t("dashboard.library_preview.empty_title", "Biblioteca vacía"),
      subtitle: t("dashboard.library_preview.empty_desc", "Cuando detectemos juegos instalados aparecerán aquí."),
      status: t("dashboard.library_preview.pending", "Pendiente"),
    },
    {
      title: t("dashboard.library_preview.favorites_title", "Favoritos"),
      subtitle: t("dashboard.library_preview.favorites_desc", "Tus juegos marcados como favoritos."),
      status: t("dashboard.library_preview.no_games", "0 juegos"),
    },
    {
      title: t("dashboard.library_preview.recent_title", "Recientes"),
      subtitle: t("dashboard.library_preview.recent_desc", "Últimos juegos ejecutados desde LumaForge."),
      status: t("dashboard.library_preview.no_activity", "Sin actividad"),
    },
  ];
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-(--color-text)">
          {t("dashboard.library_preview.library", "Biblioteca")}
        </h2>

        <button className="text-xs text-(--color-muted) hover:text-(--color-text)">
          {t("dashboard.library_preview.view_all", "Ver todo")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {games.map((game, index) => (
          <div
            key={game.title}
            className="rounded-2xl border backdrop-blur-xl border-(--surface-active-border) bg-(--surface-active) p-5"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
                {index === 1 ? (
                  <Heart className="h-5 w-5 text-rose-400" />
                ) : (
                  <Gamepad2 className="h-5 w-5 text-(--color-accent)" />
                )}
              </div>

              <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-(--color-muted)">
                {game.status}
              </span>
            </div>

            <h3 className="font-semibold text-(--color-text)">
              {game.title}
            </h3>

            <p className="mt-2 text-sm leading-5 text-(--color-muted)">
              {game.subtitle}
            </p>

            <button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white/6 px-4 py-2 text-sm text-(--color-muted) lf-surface lf-surface-hover hover:bg-white/10 hover:text-(--color-text)">
              <Play className="h-4 w-4" />
              {t("dashboard.library_preview.open", "Abrir")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}