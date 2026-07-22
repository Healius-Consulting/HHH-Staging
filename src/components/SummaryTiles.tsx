import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SummaryTileItem {
  label: string;
  value: ReactNode;
  detail: string;
  onClick?: () => void;
}

interface SummaryTilesProps {
  items: SummaryTileItem[];
  label: string;
  className?: string;
}

export default function SummaryTiles({ items, label, className = '' }: SummaryTilesProps) {
  return (
    <div className={`summary-tiles ${className}`.trim()} aria-label={label}>
      {items.map((item) => {
        const content = (
          <>
            <span className="summary-tile__label">{item.label}</span>
            <strong className="summary-tile__value">{item.value}</strong>
            <small className="summary-tile__detail">{item.detail}</small>
            {item.onClick && <ArrowRight className="summary-tile__arrow" size={14} aria-hidden="true" />}
          </>
        );

        return item.onClick ? (
          <button type="button" className="summary-tile summary-tile--action" key={item.label} onClick={item.onClick}>
            {content}
          </button>
        ) : (
          <div className="summary-tile" key={item.label}>{content}</div>
        );
      })}
    </div>
  );
}
