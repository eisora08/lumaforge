import { Download, Gamepad2, Sparkles } from "lucide-react";

export default function HeroPanel() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#332127] via-[#24171b] to-[#121014] p-7">
      <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-[#b8d7dc]/10 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl" />

      <div className="relative z-10 max-w-2xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b8d7dc]/20 bg-[#b8d7dc]/10 px-3 py-1 text-xs text-[#b8d7dc]">
          <Sparkles className="h-3.5 w-3.5" />
          Premium Game Toolkit
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white">
          Gestiona tus juegos, paquetes Lua y manifests desde un solo lugar.
        </h1>

        <p className="mt-3 max-w-xl text-sm leading-6 text-gray-400">
          Detecta Steam, instala paquetes desde API, administra descargas,
          revisa actividad y ejecuta tus juegos desde una interfaz moderna.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button className="inline-flex items-center gap-2 rounded-xl bg-[#b8d7dc] px-5 py-3 text-sm font-medium text-black hover:bg-[#cce7eb] transition">
            <Download className="h-4 w-4" />
            Explorar paquetes
          </button>

          <button className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm text-white hover:bg-white/[0.1] transition">
            <Gamepad2 className="h-4 w-4" />
            Ver biblioteca
          </button>
        </div>
      </div>
    </section>
  );
}