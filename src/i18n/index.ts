import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import es from "./es.json";

const savedLang = (() => {
  try {
    // Try dedicated key first
    const dedicated = localStorage.getItem("lumaforge-lang");
    if (dedicated) return dedicated;
    // Fallback: read from AppSettings
    const raw = localStorage.getItem("lumaforge-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.language === "es" || parsed.language === "en") return parsed.language;
    }
  } catch {
    // ignore
  }
  return null;
})();

const activeLng = savedLang || "es";
const inactiveLng = activeLng === "es" ? "en" : "es";

// Load active language synchronously, lazy-load the other on demand.
// Cuts initial sync parse from 251KB (both) to ~125KB (one).
i18n.use(initReactI18next).init({
  resources: {
    [activeLng]: { translation: activeLng === "es" ? es : en },
  },
  lng: activeLng,
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

// Pre-load the inactive language in the background so language switching is instant.
import(`./${inactiveLng}.json`).then((mod) => {
  i18n.addResourceBundle(inactiveLng, "translation", mod.default);
}).catch(() => { /* non-critical */ });

export default i18n;
