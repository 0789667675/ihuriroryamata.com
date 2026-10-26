'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';

export interface TypingDisplayProps {
  /** Array of phrases to cycle through */
  phrases: string[];
  /** Optional className for styling */
  className?: string;
  /** Pause duration in ms after a phrase is fully typed (default: 3200) */
  pauseDuration?: number;
  /** Typing speed in ms per character (default: 42) */
  typingSpeed?: number;
  /** Erasing speed in ms per character (default: 22) */
  eraseSpeed?: number;
  /** Optional badge/label displayed above the typed text */
  badge?: ReactNode;
  /** Optional prefix text to display before the typing area */
  prefix?: string;
  /** Optional suffix text to display after the typing area */
  suffix?: string;
}

type Phase = 'typing' | 'holding' | 'erasing' | 'waiting';

/**
 * A refined, production-grade typewriter component.
 * Cycles through provided phrases with natural cadence and comfortable reading pauses.
 * Fully responsive without layout shifts and honors prefers-reduced-motion.
 */
export function TypingDisplay({
  phrases,
  className = '',
  pauseDuration = 3200,
  typingSpeed = 42,
  eraseSpeed = 22,
  badge,
  prefix,
  suffix,
}: TypingDisplayProps) {
  const reduceMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing');

  // Guard against empty phrases
  const safePhrases = phrases && phrases.length > 0 ? phrases : [''];
  const currentPhrase = safePhrases[currentIndex] || '';

  useEffect(() => {
    // If reduced motion is preferred, display the active phrase statically
    if (reduceMotion) {
      setCharIndex(currentPhrase.length);
      setPhase('holding');
      return;
    }

    let timer: NodeJS.Timeout;

    if (phase === 'typing') {
      if (charIndex < currentPhrase.length) {
        timer = setTimeout(() => {
          setCharIndex((prev) => prev + 1);
        }, typingSpeed);
      } else {
        // Reached end of phrase, hold so user can read
        setPhase('holding');
      }
    } else if (phase === 'holding') {
      timer = setTimeout(() => {
        setPhase('erasing');
      }, pauseDuration);
    } else if (phase === 'erasing') {
      if (charIndex > 0) {
        timer = setTimeout(() => {
          setCharIndex((prev) => prev - 1);
        }, eraseSpeed);
      } else {
        // Fully erased, brief pause before typing next
        setPhase('waiting');
      }
    } else if (phase === 'waiting') {
      timer = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % safePhrases.length);
        setPhase('typing');
      }, 350);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [phase, charIndex, currentPhrase, pauseDuration, typingSpeed, eraseSpeed, safePhrases.length, reduceMotion]);

  // Adjust immediately if current phrase changes (e.g. language toggle)
  useEffect(() => {
    if (reduceMotion) {
      setCharIndex(currentPhrase.length);
      setPhase('holding');
    }
  }, [currentPhrase, reduceMotion]);

  const displayedText = reduceMotion ? currentPhrase : currentPhrase.slice(0, charIndex);

  return (
    <div
      className={`typing-container ${className}`.trim()}
      aria-live="polite"
      aria-atomic="true"
    >
      {badge ? <div className="typing-badge">{badge}</div> : null}
      <div className="typing-text-wrapper">
        {prefix && <span className="typing-prefix">{prefix} </span>}
        <span className="typed-text">{displayedText}</span>
        {!reduceMotion && <span className="typing-cursor" aria-hidden="true" />}
        {suffix && <span className="typing-suffix"> {suffix}</span>}
      </div>
    </div>
  );
}