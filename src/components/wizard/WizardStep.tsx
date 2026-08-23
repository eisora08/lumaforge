import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type WizardStepProps = {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onContinue: () => void;
  onSkip?: () => void;
  canContinue?: boolean;
  continueLabel?: string;
  loading?: boolean;
};

export default function WizardStep({
  icon,
  title,
  description,
  children,
  currentStep,
  totalSteps,
  onBack,
  onContinue,
  onSkip,
  canContinue = true,
  continueLabel,
  loading = false,
}: WizardStepProps) {
  const isLast = currentStep === totalSteps - 1;

  return (
    <div className="flex h-full flex-col items-center px-6 py-8 md:px-12">
      {/* Header */}
      <div className="mb-2 flex flex-col items-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-(--color-accent)/15 text-((--color-accent)">
          {icon}
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-(--color-text)">
          {title}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-(--color-muted)">
          {description}
        </p>
      </div>

      {/* Content */}
      <div className="lf-card-stagger flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4 md:w-[560px] w-full">
        {children}
      </div>

      {/* Navigation */}
      <div className="flex w-full max-w-[560px] items-center justify-between pt-4">
        <div>
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-(--color-muted) transition hover:text-(--color-text)"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {onSkip && (
            <button
              onClick={onSkip}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-(--color-muted) transition hover:text-(--color-text)"
            >
              Skip
            </button>
          )}
          <button
            onClick={onContinue}
            disabled={!canContinue || loading}
            className="flex items-center gap-2 rounded-xl bg-(--color-accent) px-6 py-2.5 text-sm font-semibold text-(--color-accent-text) transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              continueLabel || (isLast ? "Launch LumaForge" : "Continue")
            )}
            {!loading && !isLast && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
