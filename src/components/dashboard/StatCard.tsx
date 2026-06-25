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
    <div className="bg-[#302b2f] border border-white/10 rounded-2xl p-5 shadow-lg">
      <p className="text-xs uppercase tracking-wide text-gray-400">
        {label}
      </p>

      <h2 className="text-3xl font-bold text-[#b8d7dc] mt-2">
        {value}
      </h2>

      {description && (
        <p className="text-sm text-gray-400 mt-2">
          {description}
        </p>
      )}
    </div>
  );
}