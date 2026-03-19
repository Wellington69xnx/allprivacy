import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, type WheelEventHandler } from 'react';
import type { PreviewCard } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { SectionHeader } from './SectionHeader';
import { TelegramCTA } from './TelegramCTA';

interface PreviewCarouselProps {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  items: PreviewCard[];
  emptyMessage: string;
  ctaHref: string;
  ctaLabel: string;
  variant?: 'wide' | 'portrait';
}

export function PreviewCarousel({
  id,
  eyebrow,
  title,
  description,
  items,
  emptyMessage,
  ctaHref,
  ctaLabel,
  variant = 'wide',
}: PreviewCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const resetCarouselScroll = () => {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      container.scrollTo({ left: 0, behavior: 'auto' });
      container.scrollLeft = 0;
    };

    const scheduleReset = () => {
      resetCarouselScroll();
      const frameA = window.requestAnimationFrame(resetCarouselScroll);
      const frameB = window.requestAnimationFrame(resetCarouselScroll);
      const timeoutA = window.setTimeout(resetCarouselScroll, 80);
      const timeoutB = window.setTimeout(resetCarouselScroll, 220);
      const timeoutC = window.setTimeout(resetCarouselScroll, 480);

      return () => {
        window.cancelAnimationFrame(frameA);
        window.cancelAnimationFrame(frameB);
        window.clearTimeout(timeoutA);
        window.clearTimeout(timeoutB);
        window.clearTimeout(timeoutC);
      };
    };

    const cleanupScheduledResets = scheduleReset();
    const handleWindowLoad = () => {
      resetCarouselScroll();
    };
    const handlePageShow = () => {
      resetCarouselScroll();
    };

    window.addEventListener('load', handleWindowLoad);
    window.addEventListener('pageshow', handlePageShow);

    const resizeObserver = new ResizeObserver(() => {
      resetCarouselScroll();
    });

    if (containerRef.current?.firstElementChild) {
      resizeObserver.observe(containerRef.current.firstElementChild);
    }

    return () => {
      cleanupScheduledResets();
      resizeObserver.disconnect();
      window.removeEventListener('load', handleWindowLoad);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [items.length, variant]);

  useEffect(() => {
    const links = items
      .filter((item) => item.type === 'video' && item.src)
      .map((item) => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'video';
        link.href = item.src as string;
        document.head.appendChild(link);
        return link;
      });

    return () => {
      links.forEach((link) => {
        link.remove();
      });
    };
  }, [items]);

  const cardClassName =
    variant === 'portrait'
      ? 'relative self-start w-[54vw] max-w-[250px] shrink-0 snap-start overflow-hidden rounded-[26px] border border-white/10 bg-black md:w-[240px] lg:w-[260px]'
      : 'relative self-start w-[88vw] max-w-[600px] shrink-0 snap-start overflow-hidden rounded-[28px] border border-white/10 bg-black md:w-[670px] lg:w-[760px]';

  const aspectClassName =
    variant === 'portrait'
      ? 'relative aspect-[9/16] h-full overflow-hidden rounded-[inherit] bg-black'
      : 'relative aspect-[4/3] h-full overflow-hidden rounded-[inherit] bg-black';
  const ctaCardClassName =
    variant === 'portrait'
      ? 'w-[54vw] max-w-[250px] shrink-0 snap-start overflow-hidden rounded-[26px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.05] to-transparent p-5 md:w-[240px] lg:w-[260px]'
      : 'w-[88vw] max-w-[560px] shrink-0 snap-start overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.05] to-transparent p-6 md:w-[620px] lg:w-[720px]';

  const scrollByCard = (direction: 'left' | 'right') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('[data-scroll-card]'),
    );

    if (cards.length === 0) {
      return;
    }

    const currentLeft = container.scrollLeft;
    const maxLeft = container.scrollWidth - container.clientWidth;
    const tolerance = 24;

    if (direction === 'right') {
      const nextCard = cards.find((card) => card.offsetLeft > currentLeft + tolerance);
      container.scrollTo({
        left: nextCard ? Math.min(nextCard.offsetLeft, maxLeft) : maxLeft,
        behavior: 'smooth',
      });
      return;
    }

    const previousCards = [...cards].reverse();
    const previousCard = previousCards.find(
      (card) => card.offsetLeft < currentLeft - tolerance,
    );

    container.scrollTo({
      left: previousCard ? Math.max(previousCard.offsetLeft, 0) : 0,
      behavior: 'smooth',
    });
  };

  const handleWheelScroll: WheelEventHandler<HTMLDivElement> = (event) => {
    const container = containerRef.current;

    if (!container || Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();
    container.scrollLeft += event.deltaY;
  };

  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pt-10"
    >
      <SectionHeader eyebrow={eyebrow} title={title} description={description} />

      {items.length === 0 ? (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-300">
          {emptyMessage}
        </div>
      ) : (
        <div className="relative mt-6">
          <div
            ref={containerRef}
            className="hide-scrollbar overflow-x-auto overflow-y-hidden pb-2 snap-x snap-proximity"
            onWheel={handleWheelScroll}
            style={{ overflowAnchor: 'none' }}
          >
            <div className="flex w-max items-start gap-4 px-1 md:gap-5">
              {items.map((item) => (
                <article key={item.id} data-scroll-card className={cardClassName}>
                  <div className={aspectClassName}>
                      <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
                        <span className="inline-flex rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75 backdrop-blur-md">
                          {item.owner}
                        </span>
                      </div>
                      <AutoplayMedia
                        type={item.type}
                        src={item.src}
                        poster={item.thumbnail}
                        alt={item.title}
                        className="h-full w-full"
                        preloadStrategy={item.type === 'video' ? 'auto' : 'metadata'}
                        fitMode={item.type === 'video' && variant === 'wide' ? 'contain' : 'cover'}
                      />
                  </div>
                </article>
              ))}

              <div data-scroll-card className={ctaCardClassName}>
                <div className="flex h-full min-h-[220px] flex-col justify-between gap-5 md:min-h-[260px]">
                  <div>
                    <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">
                      CTA
                    </span>
                    <h3 className="mt-4 font-display text-2xl font-semibold tracking-tight text-white">
                      Entrar no Grupo
                    </h3>
                    <p className="mt-3 max-w-[28ch] text-sm leading-6 text-zinc-300">
                      Depois das previas, o CTA continua no proprio fluxo do carrossel para
                      o usuario seguir deslizando como quiser.
                    </p>
                  </div>

                  <TelegramCTA
                    href={ctaHref}
                    label={ctaLabel}
                    className="w-full"
                    scrollTargetId="cta-final"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-2">
            <button
              type="button"
              onClick={() => scrollByCard('left')}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/75 sm:h-10 sm:w-10 md:h-12 md:w-12"
            >
              <ChevronLeftIcon className="h-4 w-4 md:h-5 md:w-5" />
            </button>
            <button
              type="button"
              onClick={() => scrollByCard('right')}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/75 sm:h-10 sm:w-10 md:h-12 md:w-12"
            >
              <ChevronRightIcon className="h-4 w-4 md:h-5 md:w-5" />
            </button>
          </div>
        </div>
      )}
    </motion.section>
  );
}
