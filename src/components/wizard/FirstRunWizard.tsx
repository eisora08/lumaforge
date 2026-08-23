import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import WizardProgress from "./WizardProgress";
import WizardWelcome from "./WizardWelcome";
import WizardAppearance from "./WizardAppearance";
import WizardSteam from "./WizardSteam";
import WizardProviders from "./WizardProviders";
import WizardMetadata from "./WizardMetadata";
import WizardTools from "./WizardTools";
import WizardReady from "./WizardReady";

type FirstRunWizardProps = {
  onComplete: () => void;
};

const TOTAL_STEPS = 7;

export default function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [visible, setVisible] = useState(true);

  const goNext = useCallback(() => {
    setDirection("forward");
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const goBack = useCallback(() => {
    setDirection("backward");
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleSkip = useCallback(() => {
    setDirection("forward");
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const handleComplete = useCallback(() => {
    setVisible(false);
    setTimeout(onComplete, 400);
  }, [onComplete]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && currentStep === 0) {
        handleComplete();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [currentStep, handleComplete]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const slideClass = direction === "forward"
    ? "wizard-slide-in-right"
    : "wizard-slide-in-left";

  function renderStep() {
    const props = {
      currentStep,
      totalSteps: TOTAL_STEPS,
      onBack: goBack,
      onContinue: goNext,
      onSkip: handleSkip,
    };

    switch (currentStep) {
      case 0: return <WizardWelcome onGetStarted={goNext} />;
      case 1: return <WizardAppearance {...props} />;
      case 2: return <WizardSteam {...props} />;
      case 3: return <WizardProviders {...props} />;
      case 4: return <WizardMetadata {...props} />;
      case 5: return <WizardTools {...props} />;
      case 6: return <WizardReady {...props} onLaunch={handleComplete} />;
      default: return null;
    }
  }

  return createPortal (
    <div
      className={`fixed inset-0 z-[99999] flex flex-col transition-opacity duration-400 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ background: "var(--color-bg, #0b0b14)" }}
    >
      {/* Animated gradient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full opacity-[0.07] blur-[120px]"
          style={{
            background: "var(--color-accent)",
            animation: "wizardFloat 20s ease-in-out infinite",
          }}
        />
        <div
          className="absolute -bottom-32 -left-32 h-[400px] w-[400px] rounded-full opacity-[0.05] blur-[100px]"
          style={{
            background: "var(--color-accent)",
            animation: "wizardFloat 25s ease-in-out infinite reverse",
          }}
        />
      </div>

      {/* Top bar: progress + skip */}
      <div className="relative flex items-center justify-between px-6 py-4 md:px-10">
        <WizardProgress currentStep={currentStep} />
        {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
          <button
            onClick={handleComplete}
            className="rounded-xl px-4 py-2 text-sm font-medium text-(--color-muted) transition hover:text-(--color-text)"
          >
            Skip All
          </button>
        )}
      </div>

      {/* Step content with slide transition */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          key={currentStep}
          className={`flex min-h-0 flex-1 flex-col ${slideClass}`}
        >
          {renderStep()}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes wizardPulse {
          0%, 100% { opacity: 0.15; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.25; transform: translate(-50%, -50%) scale(1.1); }
        }
        @keyframes wizardFloat {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(30px, -20px); }
          66% { transform: translate(-20px, 15px); }
        }
        @keyframes wizardSlideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes wizardSlideInLeft {
          from { opacity: 0; transform: translateX(-40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .wizard-slide-in-right {
          animation: wizardSlideInRight 400ms cubic-bezier(.2,.8,.2,1) both;
        }
        .wizard-slide-in-left {
          animation: wizardSlideInLeft 400ms cubic-bezier(.2,.8,.2,1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .wizard-slide-in-right,
          .wizard-slide-in-left {
            animation: none !important;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}
