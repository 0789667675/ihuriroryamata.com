'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

export interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  direction?: 'up' | 'down' | 'none';
  threshold?: number;
}

export function ScrollReveal({
  children,
  className = '',
  delayMs = 0,
  direction = 'up',
  threshold = 0.1,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      setRevealed(true);
      return;
    }

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          if (delayMs > 0) {
            const timer = setTimeout(() => setRevealed(true), delayMs);
            observer.unobserve(node);
            return () => clearTimeout(timer);
          } else {
            setRevealed(true);
            observer.unobserve(node);
          }
        }
      },
      { threshold, rootMargin: '0px 0px -20px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [delayMs, reduceMotion, threshold]);

  const dirClass = direction === 'up' ? 'reveal-up' : direction === 'down' ? 'reveal-down' : 'reveal-fade';

  return (
    <div
      ref={ref}
      className={`scroll-reveal ${dirClass} ${revealed ? 'is-revealed' : ''} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
