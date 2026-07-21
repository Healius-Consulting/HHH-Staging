---
name: Web Animations Guide
description: Guidelines and code patterns for implementing fluid UI transitions, exit animations, micro-interactions, and premium visual effects in React and Vanilla CSS.
---

# Web Animations & Transitions Guide

This guide outlines the core patterns for implementing premium, hardware-accelerated animations and exit transitions in React + Vanilla CSS applications.

---

## 1. Hardware-Accelerated Properties
To ensure silky-smooth 60fps animations on mobile and desktop, always prioritize animating the following hardware-accelerated CSS properties:
- `transform` (scale, translate, rotate)
- `opacity`
- `filter` (blur, brightness, etc.)

Avoid animating properties that trigger document reflows (such as `width`, `height`, `margin`, `padding`, `top`, `left`) during continuous transitions. If you must animate them (e.g., for exit collapses), pair them with `opacity` and `transform` to mask layout shifts.

---

## 2. React Exit Transitions (The Timeout Pattern)
Since React immediately removes unmounted elements from the DOM, standard CSS transitions do not run when an item is removed. Use the local state transition pattern instead:

### React Logic:
```tsx
const [exitingId, setExitingId] = useState<number | null>(null);

const handleRemove = (id: number) => {
  setExitingId(id);
  setTimeout(() => {
    // Dispatch actual state deletion after animation completes
    dispatch({ type: 'REMOVE_ITEM', id });
    setExitingId(null);
  }, 400); // Must match CSS animation duration
};
```

### React Render:
```tsx
const isExiting = exitingId === item.id;
return (
  <div className={`list-item ${isExiting ? 'item-exit' : ''}`}>
    {item.name}
    <button onClick={() => handleRemove(item.id)}>Remove</button>
  </div>
);
```

### CSS Animation:
```css
.item-exit {
  animation: collapseFadeOut 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  pointer-events: none;
}

@keyframes collapseFadeOut {
  0% {
    opacity: 1;
    transform: scale(1) translateY(0);
    max-height: 500px;
    margin-bottom: 12px;
    padding: 12px;
  }
  100% {
    opacity: 0;
    transform: scale(0.9) translateY(-10px);
    max-height: 0;
    margin-bottom: 0;
    padding-top: 0;
    padding-bottom: 0;
    border-width: 0;
    overflow: hidden;
  }
}
```

---

## 3. Micro-Interactions & Hover Effects
Create dynamic, tactile responses to cursor movements:
- **Buttons**: Scale up slightly on hover and compress on click.
  ```css
  .btn-premium {
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
  }
  .btn-premium:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
  .btn-premium:active {
    transform: translateY(0) scale(0.98);
  }
  ```
- **Wiggles/Alerts**: Shake elements slightly on status changes or errors to draw immediate attention.
  ```css
  @keyframes alertWiggle {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
  .animate-wiggle {
    animation: alertWiggle 0.3s ease-in-out;
  }
  ```

---

## 4. Custom Component Effects
- **Laser Scanners**: Moving gradient overlay simulating optical scanning.
- **Glassmorphic Glows**: Translucent card backgrounds paired with thin, glowing borders.
- **Timeline Progress**: Transitioning the width or height of filled track elements to indicate status completions.
