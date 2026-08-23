import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import es from "./es.json";

const savedLang = (() => {
  try {
    return localStorage.getItem("lumaforge-lang");
  } catch {
    return null;
  }
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
