import { useTranslation } from "react-i18next";
import LumaForgeMark from "../../brand/LumaForgeMark";

type WizardWelcomeProps = {
  onGetStarted: () => void;
};

export default function WizardWelcome({ onGetStarted }: WizardWelcomeProps) {
  const { t } = useTranslation();

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
      <div className="relative mb-8">
        <LumaForgeMark className="h-40 w-40" />
      </div>

      <h1 className="relative text-4xl font-extrabold tracking-tight text-(--color-text) md:text-5xl">
        {t("wizard.welcome_title")}{" "}
      </h1>

      <p className="relative mt-4 max-w-lg text-base leading-relaxed text-(--color-muted)">
        {t("wizard.welcome_desc")}
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
        {t("wizard.welcome_cta")}
      </button>

      <p className="relative mt-4 text-xs text-(--color-muted)">
        {t("wizard.welcome_note")}
      </p>
    </div>
  );
}
