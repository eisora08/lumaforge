import { Flame } from "lucide-react";

type WizardWelcomeProps = {
  onGetStarted: () => void;
};

export default function WizardWelcome({ onGetStarted }: WizardWelcomeProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {/* Animated gradient orb */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
          style={{
            background: "radial-gradient(circle, var(--color-accent) 0%, transparent 70%)",
            animation: "wizardPulse 6s ease-in-out infinite",
          }}
        />
      </div>

      {/* Logo */}
      <div className="relative mb-8 flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-(--color-accent)/15 shadow-lg shadow-(--color-accent)/10">
          <Flame className="h-10 w-10 text-(--color-accent)" />
        </div>
      </div>

      <h1 className="relative text-4xl font-extrabold tracking-tight text-(--color-text) md:text-5xl">
        Welcome to{" "}
        <span className="text-(--color-accent)">LumaForge</span>
      </h1>

      <p className="relative mt-4 max-w-lg text-base leading-relaxed text-(--color-muted)">
        Your open-source game launcher with Steam integration, achievements, 
        Debrid downloads, and more. Let&apos;s get you set up in just a minute.
      </p>

      {/* Feature pills */}
      <div className="relative mt-8 flex flex-wrap justify-center gap-2">
        {["Steam Library", "Achievements", "Debrid", "Epic Games", "Lua Scripts", "Artwork"].map(
          (feature) => (
            <span
              key={feature}
              className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs font-medium text-(--color-muted)"
            >
              {feature}
            </span>
          ),
        )}
      </div>

      <button
        onClick={onGetStarted}
        className="relative mt-10 flex items-center gap-2 rounded-2xl bg-(--color-accent) px-8 py-3 text-base font-semibold text-(--color-accent-text) shadow-lg shadow-(--color-accent)/20 transition hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
      >
        Get Started
      </button>

      <p className="relative mt-4 text-xs text-(--color-muted)">
        All steps are optional — you can always configure later in Settings.
      </p>
    </div>
  );
}
