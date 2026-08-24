import { useState } from "react";
import { Monitor, Terminal, Apple } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SteamAppMetadata } from "../../../types/gameMetadata";
import type { SystemRequirements as SystemRequirementsType } from "../../../types/gameMetadata";

type StoreGameTechnicalSectionProps = {
  metadata?: SteamAppMetadata;
};

type PlatformInfo = {
  key: string;
  label: string;
  icon: typeof Monitor;
  requirements?: SystemRequirementsType | null;
};

function stripReqHtml(input: string): string {
  let text = input.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li\s*\/?>/gi, "\n");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, "\"");
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/\u00a0/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

const LABEL_PATTERN = /^(OS|Sistema operativo|Processor|Procesador|Memory|Memoria|RAM|Graphics|Tarjeta gráfica|Video Card|Video|GPU|Storage|Almacenamiento|Hard Drive|HDD|SSD|DirectX|Versión de DirectX|Network|Red|Sound Card|Sound|Audio|Additional Notes|Notas adicionales|VR Support|Soporte VR)\s*:\s*/i;

function parseRequirements(text: string): { label: string; value: string }[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: { label: string; value: string }[] = [];
  let current: { label: string; value: string } | null = null;

  for (const line of lines) {
    const match = line.match(LABEL_PATTERN);
    if (match) {
      if (current) items.push(current);
      const label = match[1];
      const rest = line.slice(match[0].length).trim();
      current = { label, value: rest };
    } else if (current) {
      current.value += " " + line;
    }
  }

  if (current) items.push(current);

  return items.length > 0 ? items : [{ label: "Requirements", value: text }];
}

export default function StoreGameTechnicalSection({
  metadata,
}: StoreGameTechnicalSectionProps) {
  const { t } = useTranslation();
  const [activePlatform, setActivePlatform] = useState("pc");

  const platforms: PlatformInfo[] = [
    { key: "pc", label: "Windows", icon: Monitor, requirements: metadata?.pc_requirements },
    { key: "mac", label: "macOS", icon: Apple, requirements: metadata?.mac_requirements },
    { key: "linux", label: "Linux", icon: Terminal, requirements: metadata?.linux_requirements },
  ];

  const availablePlatforms = platforms.filter(
    (p) => p.requirements?.minimum || p.requirements?.recommended
  );

  const active = availablePlatforms.find((p) => p.key === activePlatform) ?? availablePlatforms[0];

  if (availablePlatforms.length === 0 || !active?.requirements) {
    return (
      <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
        <h2 className="text-lg font-bold text-(--color-text)">
          {t("store.technical.title", "System Requirements")}
        </h2>
        <p className="mt-1 text-sm text-(--color-muted)">
          {t("store.technical.unavailable", "Steam system requirements not available for this title.")}
        </p>
        <div className="mt-4 rounded-xl border border-(--surface-active-border) bg-black/20 p-4 text-sm text-(--color-muted)">
          {t("store.technical.not_found", "System requirements data was not found in Steam metadata.")}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-5 lg:p-6">
      <h2 className="text-lg font-bold text-(--color-text)">
        {t("store.technical.title", "System Requirements")}
      </h2>

      <div className="mt-4 flex gap-2">
        {availablePlatforms.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setActivePlatform(p.key)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
              activePlatform === p.key
                ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                : "border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
            }`}
          >
            <p.icon className="h-3.5 w-3.5" />
            {p.label}
          </button>
        ))}
      </div>

      {active.requirements && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {active.requirements.minimum && (
            <RequirementsCard
              title={t("store.technical.minimum", "Minimum")}
              text={active.requirements.minimum}
            />
          )}

          {active.requirements.recommended && (
            <RequirementsCard
              title={t("store.technical.recommended", "Recommended")}
              text={active.requirements.recommended}
            />
          )}
        </div>
      )}
    </section>
  );
}

type RequirementsCardProps = {
  title: string;
  text: string;
};

function RequirementsCard({ title, text }: RequirementsCardProps) {
  const clean = stripReqHtml(text);
  const items = parseRequirements(clean);

  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
        {title}
      </h3>

      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="text-sm">
            <span className="font-medium text-(--color-text)/90">
              {item.label}
            </span>
            <span className="ml-1 text-(--color-text)/60">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
