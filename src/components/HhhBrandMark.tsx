interface HhhBrandMarkProps {
  className?: string;
  labelled?: boolean;
}

export default function HhhBrandMark({ className = '', labelled = false }: HhhBrandMarkProps) {
  return (
    <span
      className={`hhh-brand-mark${className ? ` ${className}` : ''}`}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? 'Holistic Health Hub' : undefined}
      aria-hidden={labelled ? undefined : true}
    />
  );
}
