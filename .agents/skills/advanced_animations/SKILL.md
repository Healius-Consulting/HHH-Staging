---
name: Advanced Motion & FLIP Animations
description: Core patterns for implementing layout-independent transitions (FLIP), spring physics in CSS, staggered delays, and accessible motion in React + Vanilla CSS.
---

# Advanced Motion & FLIP Animations Guide

This guide describes advanced motion patterns in React and Vanilla CSS, focusing on high-performance layout transitions, organic physics, and accessible choreography.

---

## 1. The FLIP Technique (First, Last, Invert, Play)
When elements transition across different DOM parents or layout flow positions (e.g., card moving from a "Pending" list to an "Active" list), standard CSS transitions do not work because the starting position is lost. The FLIP pattern resolves this.

### Implementation Pattern in React:

```tsx
import React, { useLayoutEffect, useRef } from 'react';

interface FlipItemProps {
  id: string;
  layoutId: string;
  children: React.ReactNode;
}

export const FlipItem: React.FC<FlipItemProps> = ({ id, layoutId, children }) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);

  // 1. FIRST: Capture the bounding box before the DOM updates
  useLayoutEffect(() => {
    if (elementRef.current) {
      rectRef.current = elementRef.current.getBoundingClientRect();
    }
  });

  // 2. LAST, INVERT, PLAY: Execute after DOM updates are painted
  useLayoutEffect(() => {
    if (!elementRef.current || !rectRef.current) return;

    // Get the new (last) bounding box
    const lastRect = elementRef.current.getBoundingClientRect();
    const firstRect = rectRef.current;

    // Calculate delta changes (Invert phase)
    const deltaX = firstRect.left - lastRect.left;
    const deltaY = firstRect.top - lastRect.top;
    const deltaW = firstRect.width / lastRect.width;
    const deltaH = firstRect.height / lastRect.height;

    // Apply the inverted transform immediately without transition
    elementRef.current.style.transition = 'none';
    elementRef.current.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${deltaW}, ${deltaH})`;
    elementRef.current.style.transformOrigin = 'top left';

    // Force reflow/layout flush
    void elementRef.current.offsetHeight;

    // PLAY: Trigger the actual transition to final location
    elementRef.current.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    elementRef.current.style.transform = 'none';
  }, [layoutId]);

  return (
    <div ref={elementRef} className="flip-wrapper">
      {children}
    </div>
  );
};
```

---

## 2. Spring Physics Approximation in CSS
Linear and standard ease curves can look mechanical. Spring physics simulate weight and tension using overshooting cubic-bezier curves.

### Recommended Bezier Curves:
- **Soft Spring (Smooth overshoot)**: `cubic-bezier(0.175, 0.885, 0.32, 1.275)`
- **Swift/Snappy Spring (Fast start, bounce back)**: `cubic-bezier(0.43, 1.83, 0.57, 0.8)`
- **Heavy Deceleration (High friction)**: `cubic-bezier(0.16, 1, 0.3, 1)`

### CSS Example:
```css
.card-spring-hover {
  transition: transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.card-spring-hover:hover {
  transform: translateY(-8px) scale(1.02);
}
```

---

## 3. Staggered Animations
To animate lists or grids of items gracefully, stagger their entry/exit transitions. Instead of generating distinct CSS classes for each delay, orchestrate them using CSS Custom Properties.

### React Render:
```tsx
interface ListProps {
  items: { id: string; name: string }[];
}

export const StaggeredList: React.FC<ListProps> = ({ items }) => {
  return (
    <div className="staggered-list">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="staggered-item"
          style={{ '--stagger-index': index } as React.CSSProperties}
        >
          {item.name}
        </div>
      ))}
    </div>
  );
};
```

### CSS Rules:
```css
.staggered-item {
  opacity: 0;
  transform: translateY(20px);
  animation: slideInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  /* Calculate custom animation delay dynamically */
  animation-delay: calc(var(--stagger-index) * 0.05s);
}

@keyframes slideInUp {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

## 4. Accessible Motion (Reduced Motion Support)
Always ensure animations are accessible to users with vestibular disorders or motion sensitivity.

### Global CSS Rules:
```css
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-delay: -1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    background-attachment: initial !important;
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
  
  /* Fallback animations for transitions that are critical for layout visibility */
  .fade-in-on-reduced {
    opacity: 1 !important;
    transform: none !important;
  }
}
```
