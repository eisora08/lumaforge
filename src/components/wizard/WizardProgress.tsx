import { Check } from "lucide-react";

const TOTAL_STEPS = 7;

type WizardProgressProps = {
  currentStep: number;
};

export default function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;

        return (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-all duration-300 ${
                isActive
                  ? "bg-(--color-accent) text-(--color-accent-text) scale-110"
                  : isCompleted
                    ? "bg-(--color-accent)/80 text-(--color-accent-text)"
                    : "bg-white/10 text-(--color-muted)"
              }`}
            >
              {isCompleted ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            {i < TOTAL_STEPS - 1 && (
              <div
                className={`h-[2px] w-6 rounded-full transition-all duration-500 ${
                  isCompleted ? "bg-(--color-accent)/60" : "bg-white/10"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
