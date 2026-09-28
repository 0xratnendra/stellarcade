/**
 * Custom hook for managing arcade theme persistence in local storage.
 * Scoped to experimental namespace to avoid conflicts.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ArcadeTheme } from './types';

const STORAGE_KEY = 'experimental:arcade-theme';
const DEFAULT_THEME: ArcadeTheme = 'neon-cyan';

/**
 * Hook to manage arcade theme storage and retrieval.
 * Persists theme selection to local storage and syncs across tabs.
 */
export const useThemeStorage = () => {
  const [theme, setTheme] = useState<ArcadeTheme>(DEFAULT_THEME);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load theme from storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && isValidTheme(stored)) {
        setTheme(stored as ArcadeTheme);
      }
    } catch (error) {
      console.warn('Failed to read arcade theme from storage:', error);
    }
    setIsHydrated(true);
  }, []);

  // Listen for storage changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && isValidTheme(e.newValue)) {
        setTheme(e.newValue as ArcadeTheme);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const saveTheme = useCallback(
    (newTheme: ArcadeTheme) => {
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
        setTheme(newTheme);
      } catch (error) {
        console.warn('Failed to save arcade theme to storage:', error);
        setTheme(newTheme);
      }
    },
    []
  );

  return { theme, saveTheme, isHydrated };
};

/**
 * Validates if a string is a valid ArcadeTheme value.
 */
function isValidTheme(value: any): value is ArcadeTheme {
  return ['neon-cyan', 'synthwave-sunset', 'matrix-green', 'high-contrast'].includes(value);
}
