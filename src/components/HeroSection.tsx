import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState } from 'react';
import { scrollToTarget } from '../lib/scrollToTarget';
import { ChevronDownIcon } from './icons';
import { TelegramCTA } from './TelegramCTA';

interface HeroSectionProps {
  ctaHref: string;
  backgroundSrc: string | null;
}

export function HeroSection({ ctaHref, backgroundSrc }: HeroSectionProps) {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const viewportSnapshotRef = useRef<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncViewportHeight = (force = false) => {
      const nextSnapshot = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const previousSnapshot = viewportSnapshotRef.current;

      if (
        !force &&
        previousSnapshot &&
        previousSnapshot.width === nextSnapshot.width &&
        Math.abs(previousSnapshot.height - nextSnapshot.height) < 120
      ) {
        return;
      }

      viewportSnapshotRef.current = nextSnapshot;
      setViewportHeight(nextSnapshot.height);
    };

    const handleResize = () => {
      syncViewportHeight(false);
    };

    const handleOrientationChange = () => {
      syncViewportHeight(true);
    };

    syncViewportHeight(true);

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleOrientationChange);
    window.visualViewport?.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

  const scrollToPreviews = () => {
    scrollToTarget('previas');
  };

  const heroViewportStyle = viewportHeight
    ? { height: `${viewportHeight}px`, minHeight: `${viewportHeight}px` }
    : undefined;

  return (
    <section
      className="relative min-h-screen overflow-hidden"
      style={heroViewportStyle}
    >
      <div className="absolute inset-0">
        <AnimatePresence initial={false}>
          {backgroundSrc ? (
            <motion.img
              key={backgroundSrc}
              src={backgroundSrc}
              alt=""
              loading="eager"
              fetchPriority="high"
              initial={{ opacity: 0, scale: 1.015, filter: 'brightness(0.08)' }}
              animate={{ opacity: 1, scale: 1.015, filter: 'brightness(0.34)' }}
              exit={{ opacity: 0, scale: 1.015, filter: 'brightness(0.06)' }}
              transition={{ duration: 2.8, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 h-full w-full object-cover object-center opacity-35"
            />
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {backgroundSrc ? (
            <motion.div
              key={`${backgroundSrc}-veil`}
              initial={{ opacity: 0.04 }}
              animate={{ opacity: [0.04, 0.2, 0.34, 0.18, 0] }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 2.8,
                ease: 'easeInOut',
                times: [0, 0.2, 0.46, 0.74, 1],
              }}
              className="absolute inset-0 bg-black"
            />
          ) : null}
        </AnimatePresence>
        <div className="absolute inset-0 bg-black/84" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.28),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.1),transparent_34%)]" />
      </div>

      <div
        className="absolute inset-x-0 top-0 z-10 flex justify-center px-4 py-5"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1.25rem)' }}
      >
        <span className="font-display text-sm font-semibold uppercase tracking-[0.32em] text-white/90">
          AllPrivacy
        </span>
      </div>

      <div
        className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-5 pb-36 pt-12 text-center"
        style={heroViewportStyle}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="space-y-4"
        >
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            AllPrivacy VIP +18 no Telegram.
          </h1>
          <p className="mx-auto max-w-xl text-sm leading-6 text-zinc-300 sm:text-base">
            Entrada discreta, visual reservado e acesso imediato.
          </p>
        </motion.div>
      </div>

      <div
        className="absolute inset-x-0 bottom-20 flex flex-col items-center justify-center gap-3 px-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <TelegramCTA
          href={ctaHref}
          label="Entrar no Grupo VIP"
          className="w-full max-w-sm sm:w-auto sm:min-w-[320px]"
          scrollTargetId="cta-final"
        />
        <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-white/55">
          Entrada imediata
        </span>
      </div>

      <div
        className="absolute inset-x-0 bottom-5 flex justify-center"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0px)' }}
      >
        <motion.button
          type="button"
          onClick={scrollToPreviews}
          className="flex flex-col items-center gap-1 text-white/65"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.26em]">
            Ver mais
          </span>
          <ChevronDownIcon className="h-6 w-6" />
        </motion.button>
      </div>
    </section>
  );
}
