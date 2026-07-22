import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Building2, Clock, FilePlus, Home, Package, QrCode, Search, Settings, Tags, UserSearch, Users, X } from 'lucide-react';
import { useApp, type Screen } from '../context/AppContext';
import { OPEN_COMMAND_PALETTE_EVENT } from './commandPaletteEvents';

export interface CommandDefinition {
  label: string;
  detail: string;
  icon: ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  commands?: CommandDefinition[];
  contextLabel?: string;
  placeholder?: string;
  emptyLabel?: string;
}

export default function CommandPalette({ commands: suppliedCommands, contextLabel = 'Pharmacy operations', placeholder = 'Go to a patient, workflow or action…', emptyLabel = 'No matching command' }: CommandPaletteProps = {}) {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const navigate = (screen: Screen) => {
    dispatch({ type: 'SET_SCREEN', screen });
    setOpen(false);
  };

  const defaultCommands: CommandDefinition[] = [
    { label: 'Open overview', detail: 'Today’s position and priority queue', icon: <Home size={16} />, run: () => navigate('home') },
    { label: 'Start a prescription', detail: 'Create a new draft session', icon: <FilePlus size={16} />, run: () => { dispatch({ type: 'NEW_ORDER' }); navigate('create'); } },
    { label: 'Find a patient', detail: 'Search the pharmacy patient directory', icon: <UserSearch size={16} />, run: () => navigate('patients') },
    { label: 'Review patient onboarding', detail: 'See HHH decisions and attributed enquiries', icon: <Users size={16} />, run: () => navigate('referrals') },
    { label: 'Open payments', detail: 'Review active and cleared payment requests', icon: <Clock size={16} />, run: () => navigate('review') },
    { label: 'Track supplier orders', detail: 'Open Curaleaf fulfilment activity', icon: <Package size={16} />, run: () => navigate('orders') },
    { label: 'Set formulary prices', detail: 'Review Curaleaf WX and pharmacy PX', icon: <Tags size={16} />, run: () => navigate('formulary') },
    { label: 'Copy forms and resources', detail: 'Eligibility link, QR and content pack', icon: <QrCode size={16} />, run: () => navigate('resources') },
    { label: 'Organisation settings', detail: 'Setup, services and pharmacy identity', icon: <Settings size={16} />, run: () => navigate('settings') },
  ];
  const commands = suppliedCommands ?? defaultCommands;

  const results = commands.filter(command => `${command.label} ${command.detail}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const show = () => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
      setQuery('');
      setActiveIndex(0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        show();
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, show);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, show);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    returnFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !paletteRef.current) return;
      const focusable = Array.from(paletteRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" onMouseDown={() => setOpen(false)}>
      <section ref={paletteRef} className="command-palette" role="dialog" aria-modal="true" aria-label={`${contextLabel} commands`} aria-describedby="command-palette-help" onMouseDown={event => event.stopPropagation()}>
        <div className="command-palette__search">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, results.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)); }
              if (event.key === 'Enter' && results[activeIndex]) results[activeIndex].run();
            }}
            placeholder={placeholder}
            aria-label={`Search ${contextLabel.toLowerCase()} commands`}
          />
          <button onClick={() => setOpen(false)} aria-label="Close command palette"><X size={15} /></button>
        </div>
        <div id="command-palette-help" className="command-palette__meta"><span>{contextLabel}</span><kbd>↑↓</kbd><small>navigate</small><kbd>↵</kbd><small>open</small></div>
        <div className="command-palette__results" aria-live="polite">
          {results.map((command, index) => (
            <button
              key={command.label}
              className={activeIndex === index ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={command.run}
              aria-current={activeIndex === index ? 'true' : undefined}
            >
              <span>{command.icon}</span>
              <span><strong>{command.label}</strong><small>{command.detail}</small></span>
              <kbd>{index + 1}</kbd>
            </button>
          ))}
          {results.length === 0 && <div className="command-palette__empty"><Building2 size={18} /><span>{emptyLabel}</span></div>}
        </div>
      </section>
    </div>
  );
}
