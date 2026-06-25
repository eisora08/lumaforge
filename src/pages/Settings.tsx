export default function Settings() {
  return (
    <div className="p-5 lg:p-7 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configuración</h1>
        <p className="mt-2 text-gray-400">
          Personaliza LumaForge, rutas, API, tema y comportamiento.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#302b2f] p-5">
        <h2 className="font-semibold">Tema</h2>
        <p className="mt-1 text-sm text-gray-400">
          Más adelante podrás cambiar entre Crimson Dark, Midnight Blue,
          Steam Gray, OLED Black y colores personalizados.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#302b2f] p-5">
        <h2 className="font-semibold">API</h2>
        <p className="mt-1 text-sm text-gray-400">
          Aquí irá la URL base de la API para cargar paquetes.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#302b2f] p-5">
        <h2 className="font-semibold">Rutas</h2>
        <p className="mt-1 text-sm text-gray-400">
          Configuración manual de Steam, config/lua, depotcache y carpeta temporal.
        </p>
      </section>
    </div>
  );
}