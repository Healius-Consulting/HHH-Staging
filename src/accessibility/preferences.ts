import { useEffect, useState } from 'react';

export type AccessibilityTheme =
  | 'clinical-light'
  | 'clinical-dark'
  | 'high-contrast'
  | 'warm-low-glare';

export type TextScale = 'default' | 'large' | 'larger';

export interface AccessibilityPreferences {
  theme: AccessibilityTheme;
  textScale: TextScale;
  reduceMotion: boolean;
  enhancedFocus: boolean;
  underlineLinks: boolean;
}

export type AccessibilitySyncHandler = (
  preferences: AccessibilityPreferences,
) => void | Promise<void>;

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  theme: 'clinical-light',
  textScale: 'default',
  reduceMotion: false,
  enhancedFocus: false,
  underlineLinks: false,
};

const STORAGE_KEY = 'hhh:accessibility-preferences:v1';
const CHANGE_EVENT = 'hhh:accessibility-preferences-change';
const THEMES: AccessibilityTheme[] = [
  'clinical-light',
  'clinical-dark',
  'high-contrast',
  'warm-low-glare',
];
const TEXT_SCALES: TextScale[] = ['default', 'large', 'larger'];

let syncHandler: AccessibilitySyncHandler | null = null;

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function parsePreferences(value: unknown): AccessibilityPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_ACCESSIBILITY_PREFERENCES;
  const candidate = value as Partial<AccessibilityPreferences>;

  return {
    theme: candidate.theme && THEMES.includes(candidate.theme)
      ? candidate.theme
      : DEFAULT_ACCESSIBILITY_PREFERENCES.theme,
    textScale: candidate.textScale && TEXT_SCALES.includes(candidate.textScale)
      ? candidate.textScale
      : DEFAULT_ACCESSIBILITY_PREFERENCES.textScale,
    reduceMotion: isBoolean(candidate.reduceMotion)
      ? candidate.reduceMotion
      : DEFAULT_ACCESSIBILITY_PREFERENCES.reduceMotion,
    enhancedFocus: isBoolean(candidate.enhancedFocus)
      ? candidate.enhancedFocus
      : DEFAULT_ACCESSIBILITY_PREFERENCES.enhancedFocus,
    underlineLinks: isBoolean(candidate.underlineLinks)
      ? candidate.underlineLinks
      : DEFAULT_ACCESSIBILITY_PREFERENCES.underlineLinks,
  };
}

export function readAccessibilityPreferences(): AccessibilityPreferences {
  if (typeof window === 'undefined') return DEFAULT_ACCESSIBILITY_PREFERENCES;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? parsePreferences(JSON.parse(stored)) : DEFAULT_ACCESSIBILITY_PREFERENCES;
  } catch {
    return DEFAULT_ACCESSIBILITY_PREFERENCES;
  }
}

export function applyAccessibilityPreferences(preferences: AccessibilityPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.textScale = preferences.textScale;
  root.dataset.reducedMotion = String(preferences.reduceMotion);
  root.dataset.enhancedFocus = String(preferences.enhancedFocus);
  root.dataset.underlineLinks = String(preferences.underlineLinks);
  root.style.colorScheme = preferences.theme === 'clinical-dark' || preferences.theme === 'high-contrast'
    ? 'dark'
    : 'light';
}

if (typeof window !== 'undefined') {
  applyAccessibilityPreferences(readAccessibilityPreferences());
}

export function configureAccessibilitySync(handler: AccessibilitySyncHandler | null) {
  syncHandler = handler;
}

export function saveAccessibilityPreferences(preferences: AccessibilityPreferences) {
  const validated = parsePreferences(preferences);
  applyAccessibilityPreferences(validated);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    } catch {
      // Preferences still apply for this session when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent<AccessibilityPreferences>(CHANGE_EVENT, { detail: validated }));
  }

  void syncHandler?.(validated);
}

export function useAccessibilityPreferences() {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(() => readAccessibilityPreferences());

  useEffect(() => {
    applyAccessibilityPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const handleChange = (event: Event) => {
      setPreferences(parsePreferences((event as CustomEvent<AccessibilityPreferences>).detail));
    };
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, []);

  const updatePreferences = (updates: Partial<AccessibilityPreferences>) => {
    const next = parsePreferences({ ...preferences, ...updates });
    setPreferences(next);
    saveAccessibilityPreferences(next);
  };

  const resetPreferences = () => {
    setPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
    saveAccessibilityPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
  };

  return { preferences, updatePreferences, resetPreferences };
}
