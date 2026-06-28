import ActivityFeed from "../components/activity/ActivityFeed";

export default function Activity() {
  return (
    <div className="p-5 lg:p-7">
      <h1 className="text-3xl font-bold">Actividad</h1>
      <p className="mt-2 text-sm text-(--color-muted)">
        Logs de instalaciones, descargas, errores y eventos del sistema.
      </p>

      <div className="mt-8">
        <ActivityFeed />
      </div>
    </div>
  );
}