import { Building2, ShieldCheck } from 'lucide-react';
import { localPortalPreview } from './localPortalPreview';

export default function LocalPortalSwitcher() {
  const open = (portal: 'pharmacy' | 'admin') => {
    window.location.assign(`${window.location.pathname}?devPortal=${portal}`);
  };

  return (
    <aside className="local-preview-switcher" aria-label="Local portal preview tools">
      <span>Local preview</span>
      <button type="button" aria-pressed={localPortalPreview === 'pharmacy'} className={localPortalPreview === 'pharmacy' ? 'active' : ''} onClick={() => open('pharmacy')}>
        <Building2 size={13} /> Pharmacy
      </button>
      <button type="button" aria-pressed={localPortalPreview === 'admin'} className={localPortalPreview === 'admin' ? 'active' : ''} onClick={() => open('admin')}>
        <ShieldCheck size={13} /> HHH admin
      </button>
    </aside>
  );
}
