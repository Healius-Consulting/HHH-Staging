import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface MotionLayoutItemProps {
  children: ReactNode;
  className?: string;
  layoutKey: string | number;
}

export default function MotionLayoutItem({ children, className = '', layoutKey }: MotionLayoutItemProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const previousRectRef = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const currentRect = element.getBoundingClientRect();
    const previousRect = previousRectRef.current;
    const reduceMotion = document.documentElement.dataset.reducedMotion === 'true'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (previousRect && !reduceMotion && currentRect.width > 0 && currentRect.height > 0) {
      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        element.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
      }
    }

    previousRectRef.current = currentRect;
  }, [layoutKey]);

  return <div ref={elementRef} className={`motion-layout-item ${className}`.trim()}>{children}</div>;
}
