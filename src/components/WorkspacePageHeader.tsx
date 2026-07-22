import { ChevronRight, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import AccessibilityPanel from '../accessibility/AccessibilityPanel';
import { openCommandPalette } from './commandPaletteEvents';

interface WorkspacePageHeaderProps {
  section: string;
  context: string;
  title: string;
  subtitle: string;
  contextControl?: ReactNode;
  commandLabel?: string;
}

export default function WorkspacePageHeader({ section, context, title, subtitle, contextControl, commandLabel = 'Quick find' }: WorkspacePageHeaderProps) {
  return (
    <header className="app-header workspace-page-header">
      <div className="brand-text">
        <div className="app-header__eyebrow"><span>{section}</span><ChevronRight size={12} />{context}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="app-header__actions">
        <button className="header-command-launcher" onClick={openCommandPalette} aria-label="Open command menu"><Search size={14} /><span>{commandLabel}</span><kbd>⌘K</kbd></button>
        {contextControl}
        <AccessibilityPanel />
      </div>
    </header>
  );
}
