type StatCardProps = {
  label: string;
  value: string | number;
  description?: string;
};

export default function StatCard({
  label,
  value,
  description,
}: StatCardProps) {
  return (
    <div className="lf-surface rounded-2xl border p-5">
      <p className="text-xs uppercase tracking-wide text-(--color-muted)">
        {label}
      </p>

      <h2 className="mt-2 text-3xl font-bold text-(--color-accent)">
        {value}
      </h2>

      {description && (
        <p className="mt-2 text-sm text-(--color-muted)">
          {description}
        </p>
      )}
    </div>
  );
}