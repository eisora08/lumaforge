type DownloadProgressBarProps = {
  progress: number;
  mode?: "determinate" | "indeterminate";
};

export default function DownloadProgressBar({
  progress,
  mode = "determinate",
}: DownloadProgressBarProps) {
  const safeProgress = Math.min(100, Math.max(0, progress));

  return (
    <div>
      {mode === "determinate" && (
        <div className="mb-2 flex items-center justify-between text-xs text-(--color-muted)">
          <span>Progreso</span>
          <span>{safeProgress}%</span>
        </div>
      )}

      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        {mode === "determinate" ? (
          <div
            className="h-full rounded-full bg-(--color-accent) transition-all duration-300"
            style={{ width: `${safeProgress}%` }}
          />
        ) : (
          <div className="h-full w-full">
            <div className="lf-launch-bar h-full w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
