import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { splitMedicineLabel } from '../utils/medicineLabel';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.getAttribute('data-reduced-motion') === 'true'
  );
}

function PendulumText({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const text = textRef.current;
    if (!frame || !text) return;

    const measure = () => {
      if (prefersReducedMotion()) {
        setShift(0);
        return;
      }
      const overflow = text.scrollWidth - frame.clientWidth;
      setShift(overflow > 6 ? overflow : 0);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(text);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span
      ref={frameRef}
      className={['pendulum-text', className].filter(Boolean).join(' ')}
      data-overflow={shift > 0 ? 'true' : undefined}
      style={shift > 0 ? { '--pendulum-shift': `-${shift}px` } as CSSProperties : undefined}
      title={title}
    >
      <span ref={textRef} className="pendulum-text__inner">{children}</span>
    </span>
  );
}

export default function MedicineLabel({ name }: { name: string }) {
  const { title, strength } = splitMedicineLabel(name);
  return (
    <>
      <strong>
        <PendulumText title={title}>{title}</PendulumText>
      </strong>
      {strength ? (
        <span className="medicine-label__strength">
          <PendulumText title={strength}>{strength}</PendulumText>
        </span>
      ) : null}
    </>
  );
}
