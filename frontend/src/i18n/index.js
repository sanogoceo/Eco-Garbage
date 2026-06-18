import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import en from './locales/en.json';

function safeLocalStorageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('localStorage get failed', key, error);
    return fallback;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('localStorage set failed', key, error);
  }
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    lng: safeLocalStorageGet('eco_lang', 'fr') || 'fr',
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', (lng) => {
  safeLocalStorageSet('eco_lang', lng);
});

export default i18n;
