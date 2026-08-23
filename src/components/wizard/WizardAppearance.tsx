import { Palette } from "lucide-react";
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
  const { theme, surfaceMode, accentOverride, setTheme, setSurfaceMode, setAccentOverride } = useTheme();

  const currentTheme = themes.find((t) => t.id === theme);
  const themeAccent = currentTheme?.preview.accent ?? "#38bdf8";

  return (
    <WizardStep
      icon={<Palette className="h-8 w-8" />}
      title="Choose Your Style"
      description="Pick a theme, surface finish, and accent color. You can change these anytime."
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
    >
      {/* Theme cards */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-(--color-muted)">Theme</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((t) => (
            <ThemeOption key={t.id} theme={t} selected={theme === t.id} onSelect={setTheme} />
          ))}
        </div>
      </div>

      {/* Surface modes */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-(--color-muted)">Surface Finish</p>
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
