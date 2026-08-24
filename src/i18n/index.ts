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

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: savedLang || "es",
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

export default i18n;
