import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { scrollToTarget } from '../lib/scrollToTarget';
import { BrandMark } from './BrandMark';
import { CtaBonusNote } from './CtaBonusNote';
import { HeaderQuickAccessMenu } from './HeaderQuickAccessMenu';
import { ChevronDownIcon } from './icons';
import { TelegramCTA } from './TelegramCTA';

interface HeroSectionProps {
  ctaHref: string;
  backgroundSrc: string | null;
  onBackgroundReady?: (src: string) => void;
}

export function HeroSection({ ctaHref, backgroundSrc, onBackgroundReady }: HeroSectionProps) {
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [displayedBackgroundSrc, setDisplayedBackgroundSrc] = useState<string | null>(null);
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);
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

  useEffect(() => {
    if (!backgroundSrc) {
      setDisplayedBackgroundSrc(null);
      setIsBackgroundReady(false);
      return;
    }

    if (displayedBackgroundSrc === backgroundSrc) {
      setIsBackgroundReady(true);
      onBackgroundReady?.(backgroundSrc);
      return;
    }

    let isCancelled = false;
    const preloadImage = new Image();
    preloadImage.decoding = 'async';

    const applyBackground = () => {
      if (isCancelled) {
        return;
      }

      setDisplayedBackgroundSrc(backgroundSrc);
      setIsBackgroundReady(true);
      onBackgroundReady?.(backgroundSrc);
    };

    setIsBackgroundReady(false);
    preloadImage.src = backgroundSrc;

    if (preloadImage.complete) {
      applyBackground();
      return () => {
        isCancelled = true;
      };
    }

    preloadImage.onload = applyBackground;
    preloadImage.onerror = applyBackground;

    return () => {
      isCancelled = true;
      preloadImage.onload = null;
      preloadImage.onerror = null;
    };
  }, [backgroundSrc, displayedBackgroundSrc, onBackgroundReady]);

  return (
    <section
      className="relative min-h-screen overflow-hidden"
      style={heroViewportStyle}
    >
      <div className="absolute inset-0">
        <AnimatePresence initial={false}>
          {displayedBackgroundSrc ? (
            <motion.img
              key={displayedBackgroundSrc}
              src={displayedBackgroundSrc}
              alt=""
              loading="eager"
              fetchPriority="high"
              initial={{ opacity: 0, scale: 1.015, filter: 'brightness(0.08)' }}
              animate={{ opacity: 1, scale: 1.015, filter: 'brightness(0.35)' }}
              exit={{ opacity: 0, scale: 1.015, filter: 'brightness(0.06)' }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="absolute inset-0 h-full w-full object-cover object-center opacity-35 md:opacity-24"
            />
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {displayedBackgroundSrc ? (
            <motion.div
              key={`${displayedBackgroundSrc}-veil`}
              initial={{ opacity: 0.04 }}
              animate={{ opacity: [0.04, 0.2, 0.34, 0.18, 0] }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 1.2,
                ease: 'easeInOut',
                times: [0, 0.2, 0.46, 0.74, 1],
              }}
              className="absolute inset-0 bg-black"
            />
          ) : null}
        </AnimatePresence>
        <div className="absolute inset-0 bg-black/50 md:bg-black/70" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.28),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.1),transparent_34%)] md:bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.22),transparent_24%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.07),transparent_30%)]" />
        {!displayedBackgroundSrc && !isBackgroundReady ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#050507]">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/35 px-5 py-3 text-sm text-zinc-300 backdrop-blur-md">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
              <span>Carregando...</span>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="absolute inset-x-0 top-0 z-10 flex justify-center px-4 py-5"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1.25rem)' }}
      >
        <BrandMark />
        <HeaderQuickAccessMenu className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-5" />
      </div>

      <div
        className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-3 pb-36 pt-12 text-center sm:px-5"
        style={heroViewportStyle}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="w-full space-y-6"
        >
          <h1 className="mx-auto font-display text-[2.28rem] font-semibold leading-[0.94] tracking-[-0.035em] text-white sm:text-5xl sm:leading-tight sm:tracking-tight">
            <span>AllPrivacy</span>
            <span className="text-rose-400">VIP</span>
            <span>{' + '}</span>
            <span className="inline-flex -translate-y-[0.06em] align-middle">
              <img
                src="/uploads/_legacy-root/xv.png"
                alt="XVideosRED"
                className="inline-block h-[2.16em] w-auto object-contain align-middle brightness-110"
                loading="eager"
              />
            </span>
            <span>{'  no Telegram.'}</span>
          </h1>
          <p className="mx-auto max-w-[22rem] pt-2 text-[17px] leading-7 text-zinc-200 sm:max-w-2xl sm:text-[1.08rem] sm:leading-8">
            {'Entre em nosso GrupoVIP e tenha acesso a conteúdos exclusivos e ainda receba créditos grátis para aproveitar no Xvideos RED Download.'}
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
        <CtaBonusNote
          className="text-[12px] font-medium tracking-[0.22em] text-white/55 sm:text-[13px]"
          logoClassName="-translate-y-[0.08em] h-[2.72em] w-auto object-contain brightness-110"
        />
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
