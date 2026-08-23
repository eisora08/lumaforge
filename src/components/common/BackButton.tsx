import { ArrowLeft } from "lucide-react";

type BackButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

/**
 * Unified back navigation button. Minimalist chevron + text, no pill/background.
 * Works for routing navigation AND non-routing actions (closing overlays, breadcrumbs).
 */
export default function BackButton({ label, onClick, className = "" }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-(--color-muted) transition-colors duration-150 hover:text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}
