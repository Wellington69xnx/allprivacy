import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { scrollToTargetWhenReady } from '../lib/scrollToTarget';
import { TelegramIcon } from './icons';

interface TelegramCTAProps {
  href: string;
  label: string;
  className?: string;
  pulse?: boolean;
  scrollTargetId?: string;
}

export function TelegramCTA({
  href,
  label,
  className = '',
  pulse = false,
  scrollTargetId,
}: TelegramCTAProps) {
  const [isPreparingScroll, setIsPreparingScroll] = useState(false);
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!scrollTargetId) {
      return;
    }

    event.preventDefault();
    if (isPreparingScroll) {
      return;
    }

    if (!document.getElementById(scrollTargetId)) {
      return;
    }

    setIsPreparingScroll(true);

    scrollToTargetWhenReady(scrollTargetId)
      .finally(() => {
        resetTimeoutRef.current = window.setTimeout(() => {
          setIsPreparingScroll(false);
        }, 1100);
      });
  };

  return (
    <motion.a
      href={scrollTargetId ? `#${scrollTargetId}` : href}
      target={scrollTargetId ? undefined : '_blank'}
      rel={scrollTargetId ? undefined : 'noreferrer'}
      onClick={handleClick}
      className={`inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-white/10 bg-gradient-to-r from-rose-600 via-rose-500 to-violet-600 px-6 py-4 text-center font-display text-base font-semibold text-white shadow-glow transition-transform duration-300 hover:scale-[1.01] active:scale-[0.99] ${
        isPreparingScroll ? 'pointer-events-none opacity-90' : ''
      } ${className}`}
      aria-busy={isPreparingScroll}
      animate={
        pulse
          ? {
              scale: [1, 1.025, 1],
              boxShadow: [
                '0 0 0 rgba(239,68,68,0)',
                '0 0 34px rgba(239,68,68,0.28)',
                '0 0 0 rgba(139,92,246,0)',
              ],
            }
          : undefined
      }
      transition={
        pulse
          ? {
              duration: 2.6,
              repeat: Number.POSITIVE_INFINITY,
              ease: 'easeInOut',
            }
          : undefined
      }
    >
      <TelegramIcon className="h-5 w-5 shrink-0" />
      <span>{isPreparingScroll ? 'Preparando...' : label}</span>
    </motion.a>
  );
}
