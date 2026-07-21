import { useEffect, useRef, useState } from 'react';
import {
  Accessibility,
  Check,
  Contrast,
  Eye,
  Link as LinkIcon,
  Moon,
  RotateCcw,
  SunMedium,
  X,
} from 'lucide-react';
import {
  type AccessibilityTheme,
  type TextScale,
  useAccessibilityPreferences,
} from './preferences';

const THEME_OPTIONS: Array<{
  value: AccessibilityTheme;
  label: string;
  description: string;
  icon: typeof SunMedium;
}> = [
  { value: 'clinical-light', label: 'Clinical Light', description: 'Clear, neutral workspace', icon: SunMedium },
  { value: 'clinical-dark', label: 'Clinical Dark', description: 'Dark surfaces with clear status colours', icon: Moon },
  { value: 'high-contrast', label: 'High Contrast', description: 'Maximum separation and stronger outlines', icon: Contrast },
  { value: 'warm-low-glare', label: 'Warm Low-Glare', description: 'Warm neutrals with reduced blue-white glare', icon: Eye },
];

const TEXT_SCALE_OPTIONS: Array<{ value: TextScale; label: string }> = [
  { value: 'default', label: '100%' },
  { value: 'large', label: '112%' },
  { value: 'larger', label: '125%' },
];

interface PreferenceToggleProps {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function PreferenceToggle({ checked, description, label, onChange }: PreferenceToggleProps) {
  return (
    <label className="accessibility-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="accessibility-switch" aria-hidden="true"><span /></span>
    </label>
  );
}

export default function AccessibilityPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { preferences, updatePreferences, resetPreferences } = useAccessibilityPreferences();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen]);

  return (
    <div className="accessibility-control">
      <button
        ref={triggerRef}
        type="button"
        className="header-icon-button"
        aria-label="Open accessibility preferences"
        aria-expanded={isOpen}
        aria-controls="accessibility-preferences"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Accessibility size={18} aria-hidden="true" />
        <span>Accessibility</span>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          id="accessibility-preferences"
          className="accessibility-panel"
          role="dialog"
          aria-labelledby="accessibility-panel-title"
        >
          <div className="accessibility-panel__header">
            <div>
              <p className="section-label">Display preferences</p>
              <h2 id="accessibility-panel-title">Accessibility</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="icon-button"
              aria-label="Close accessibility preferences"
              onClick={() => {
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <fieldset className="accessibility-fieldset">
            <legend>Colour theme</legend>
            <div className="theme-option-grid">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = preferences.theme === option.value;
                return (
                  <label key={option.value} className={`theme-option theme-option--${option.value} ${selected ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="accessibility-theme"
                      value={option.value}
                      checked={selected}
                      onChange={() => updatePreferences({ theme: option.value })}
                    />
                    <span className="theme-option__icon"><Icon size={16} aria-hidden="true" /></span>
                    <span className="theme-option__copy">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {selected && <Check className="theme-option__check" size={15} aria-hidden="true" />}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="accessibility-fieldset accessibility-fieldset--compact">
            <legend>Text size</legend>
            <div className="text-scale-options">
              {TEXT_SCALE_OPTIONS.map((option) => (
                <label key={option.value} className={preferences.textScale === option.value ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="text-scale"
                    value={option.value}
                    checked={preferences.textScale === option.value}
                    onChange={() => updatePreferences({ textScale: option.value })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="accessibility-toggle-list">
            <PreferenceToggle
              label="Reduce motion"
              description="Minimise transitions and movement"
              checked={preferences.reduceMotion}
              onChange={(reduceMotion) => updatePreferences({ reduceMotion })}
            />
            <PreferenceToggle
              label="Enhanced focus"
              description="Use a thicker keyboard focus indicator"
              checked={preferences.enhancedFocus}
              onChange={(enhancedFocus) => updatePreferences({ enhancedFocus })}
            />
            <PreferenceToggle
              label="Underline links"
              description="Make text links easier to identify"
              checked={preferences.underlineLinks}
              onChange={(underlineLinks) => updatePreferences({ underlineLinks })}
            />
          </div>

          <button type="button" className="btn btn-sm accessibility-reset" onClick={resetPreferences}>
            <RotateCcw size={14} aria-hidden="true" /> Reset preferences
          </button>
          <p className="accessibility-panel__note"><LinkIcon size={12} aria-hidden="true" /> Saved on this device. Account syncing can be enabled after authentication.</p>
        </div>
      )}
    </div>
  );
}
