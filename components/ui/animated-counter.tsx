'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

export interface AnimatedCounterProps {
  value: number | string | null | undefined;
  formatter?: (val: number) => string;
  duration?: number;
  fallback?: ReactNode;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function AnimatedCounter({
  value,
  formatter = (val) => new Intl.NumberFormat('rw-RW', { maximumFractionDigits: 0 }).format(Math.round(val)),
  duration = 450,
  fallback = '…',
  prefix = '',
  suffix = '',
  className,
}: AnimatedCounterProps) {
  const reduceMotion = useReducedMotion();
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))
        ? Number(value)
        : null;

  // Render authoritative formatted string on SSR and first client hydration pass to avoid hydration mismatches
  const initialDisplay: ReactNode =
    numericValue !== null
      ? formatter(numericValue)
      : value != null && value !== ''
        ? String(value)
        : fallback;

  const [display, setDisplay] = useState<ReactNode>(initialDisplay);
  const currentNumericRef = useRef<number>(numericValue ?? 0);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (numericValue === null) {
      setDisplay(value != null && value !== '' ? String(value) : fallback);
      return;
    }

    if (reduceMotion) {
      currentNumericRef.current = numericValue;
      setDisplay(formatter(numericValue));
      return;
    }

    const startVal = mountedRef.current ? currentNumericRef.current : 0;
    const endVal = numericValue;
    mountedRef.current = true;

    if (startVal === endVal) {
      setDisplay(formatter(endVal));
      return;
    }

    const startTime = performance.now();
    let animId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic curve: 1 - (1 - progress)^3
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (endVal - startVal) * ease;
      currentNumericRef.current = current;
      setDisplay(formatter(current));

      if (progress < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        currentNumericRef.current = endVal;
        setDisplay(formatter(endVal));
      }
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [numericValue, duration, reduceMotion, formatter, value, fallback]);

  return (
    <span className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
