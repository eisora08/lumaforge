import { useGrowOnMount } from "../../hooks/useGrowOnMount";

interface GrowBarProps {
  percent: number;
  minPercent?: number;
  trackClassName?: string;
  fillClassName?: string;
}

/**
 * Shared width-based progress bar that grows from 0 to `percent` when it
 * mounts (page-entry animation) via useGrowOnMount + the existing CSS
 * transition on the fill. `minPercent` reserves a visible sliver for
 * near-zero values (e.g. `Math.max(2, ...)` XP bars).
 */
export default function GrowBar({
  percent,
  minPercent = 0,
  trackClassName = "",
  fillClassName = "",
}: GrowBarProps) {
  const grow = useGrowOnMount();
  const width = grow ? Math.max(minPercent, percent) : 0;

  return (
    <div className={`overflow-hidden ${trackClassName}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ${fillClassName}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
