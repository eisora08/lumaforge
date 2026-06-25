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
        <h2 className="font-semibold text-white">Biblioteca</h2>

        <button className="text-xs text-gray-400 hover:text-white">
          Ver todo
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {games.map((game, index) => (
          <div
            key={game.title}
            className="rounded-2xl border border-white/10 bg-[#302b2f] p-5"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05]">
                {index === 1 ? (
                  <Star className="h-5 w-5 text-yellow-300" />
                ) : (
                  <Gamepad2 className="h-5 w-5 text-[#b8d7dc]" />
                )}
              </div>

              <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-gray-400">
                {game.status}
              </span>
            </div>

            <h3 className="font-semibold text-white">{game.title}</h3>
            <p className="mt-2 text-sm leading-5 text-gray-500">
              {game.subtitle}
            </p>

            <button className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white/[0.06] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.1] hover:text-white">
              <Play className="h-4 w-4" />
              Abrir
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}