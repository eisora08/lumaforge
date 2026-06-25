import { Gamepad2, Play, Star } from "lucide-react";

const games = [
  {
    title: "Biblioteca vacía",
    subtitle: "Cuando detectemos juegos instalados aparecerán aquí.",
    status: "Pendiente",
  },
  {
    title: "Favoritos",
    subtitle: "Tus juegos marcados como favoritos.",
    status: "0 juegos",
  },
  {
    title: "Recientes",
    subtitle: "Últimos juegos ejecutados desde LumaForge.",
    status: "Sin actividad",
  },
];

export default function LibraryPreview() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-(--color-text)">
          Biblioteca
        </h2>

        <button className="text-xs text-(--color-muted) hover:text-(--color-text)">
          Ver todo
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {games.map((game, index) => (
          <div
            key={game.title}
            className="rounded-2xl border border-(--color-border) bg-(--color-surface) p-5"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
                {index === 1 ? (
                  <Star className="h-5 w-5 text-yellow-300" />
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

            <button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white/6 px-4 py-2 text-sm text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)">
              <Play className="h-4 w-4" />
              Abrir
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}