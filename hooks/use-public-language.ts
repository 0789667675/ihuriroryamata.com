'use client';

import { useCallback, useEffect, useState } from 'react';
import { LANGUAGE_STORAGE_KEY, normalizePublicLanguage, publicCopy, type PublicCopyKey, type PublicLanguage } from '@/lib/i18n/public-copy';

export function usePublicLanguage() {
  const [language, setLanguageState] = useState<PublicLanguage>('rw');

  useEffect(() => {
    let storedLanguage: string | null = null;
    try {
      storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      storedLanguage = null;
    }
    setLanguageState(normalizePublicLanguage(storedLanguage));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((nextLanguage: PublicLanguage) => {
    setLanguageState(nextLanguage);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The selected language remains available for the current page session.
    }
  }, []);

  const t = useCallback((key: PublicCopyKey) => publicCopy[language][key], [language]);
  return { language, setLanguage, t };
}