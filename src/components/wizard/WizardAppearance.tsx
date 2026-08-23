import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../context/ThemeContext";
import { themes, surfaceModes } from "../../theme/themes";
import ThemeOption from "../settings/ThemeOption";
import SurfaceModeOption from "../settings/SurfaceModeOption";
import AccentColorPicker from "../settings/AccentColorPicker";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

export default function WizardAppearance({ currentStep, totalSteps, onBack, onContinue, onSkip }: Props) {
  const { t } = useTranslation();
  const { theme, surfaceMode, accentOverride, setTheme, setSurfaceMode, setAccentOverride } = useTheme();

  const currentTheme = themes.find((th) => th.id === theme);
  const themeAccent = currentTheme?.preview.accent ?? "#38bdf8";

  return (
    <WizardStep
      icon={<Palette className="h-8 w-8" />}
      title={t("wizard.appearance_title")}
      description={t("wizard.appearance_desc")}
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
    >
      {/* Theme cards */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-(--color-muted)">{t("wizard.appearance_theme")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((th) => (
            <ThemeOption key={th.id} theme={th} selected={theme === th.id} onSelect={setTheme} />
          ))}
        </div>
      </div>

      {/* Surface modes */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-(--color-muted)">{t("wizard.appearance_surface")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {surfaceModes.map((m) => (
            <SurfaceModeOption key={m.id} mode={m} selected={surfaceMode === m.id} onSelect={setSurfaceMode} />
          ))}
        </div>
      </div>

      {/* Accent color */}
      <AccentColorPicker value={accentOverride} themeAccent={themeAccent} onChange={setAccentOverride} />
    </WizardStep>
  );
}
