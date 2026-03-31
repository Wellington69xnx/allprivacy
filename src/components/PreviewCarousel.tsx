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
  sectionClassName?: string;
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
  sectionClassName,
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
      ? 'relative self-start aspect-[9/16] w-[54vw] max-w-[250px] shrink-0 snap-start overflow-hidden rounded-[26px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.05] to-transparent md:w-[240px] lg:w-[260px]'
      : 'relative self-start aspect-[4/3] w-[88vw] max-w-[600px] shrink-0 snap-start overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.05] to-transparent md:w-[670px] lg:w-[760px]';

  const ctaContentClassName =
    variant === 'portrait'
      ? 'absolute inset-0 flex h-full w-full min-h-0 flex-col justify-between gap-3 p-4 sm:p-5'
      : 'absolute inset-0 flex h-full w-full min-h-0 flex-col justify-between gap-2 p-3 sm:gap-3 sm:p-4 md:p-5 lg:p-6';

  const ctaTextBlockClassName =
    variant === 'portrait'
      ? 'flex flex-1 flex-col justify-center text-center'
      : 'flex flex-1 flex-col justify-center text-center md:text-left';

  const ctaTitleClassName =
    variant === 'portrait'
      ? 'font-display text-xl font-semibold tracking-tight text-white sm:text-2xl'
      : 'font-display text-xl font-semibold tracking-tight text-white sm:text-2xl md:text-[1.7rem] lg:text-[2rem]';

  const ctaDescriptionClassName =
    variant === 'portrait'
      ? 'mt-2 text-[13px] leading-5 text-zinc-300 sm:text-sm sm:leading-6'
      : 'mt-2 text-[13px] leading-5 text-zinc-300 sm:text-sm sm:leading-6 md:text-[15px] md:leading-6 lg:text-base';

  const ctaButtonClassName =
    variant === 'portrait'
      ? 'w-full min-h-12 px-4 py-3 text-sm sm:text-base'
      : 'w-full min-h-12 px-4 py-3 text-sm md:min-h-12 md:px-5 md:py-3 md:text-base lg:min-h-14 lg:text-base';

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
      className={sectionClassName ?? 'pt-12 sm:pt-10'}
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
                      showVolumeToggle
                    />
                  </div>
                </article>
              ))}

              <div data-scroll-card className={ctaCardClassName}>
                <div className={ctaContentClassName}>
                  <div className={ctaTextBlockClassName}>
                    <h3 className={ctaTitleClassName}>Entrar no Grupo</h3>
                    <p className={ctaDescriptionClassName}>
                      {
                        'Entre no grupo VIP e tenha acesso a conte\u00fados exclusivos de diversas modelos do Privacy, OnlyFans, XvideosRED, Close Friends e Telegram VIP.'
                      }
                      <br />
                      <br />
                      {'Tudo organizado em categorias para facilitar sua experi\u00eancia.'}
                    </p>
                  </div>

                  <div className="grid gap-1.5 sm:gap-2">
                    <TelegramCTA
                      href={ctaHref}
                      label={ctaLabel}
                      className={ctaButtonClassName}
                      scrollTargetId="cta-final"
                    />
                    <span className="text-center text-[10px] font-medium uppercase tracking-[0.16em] text-white/45 sm:text-[11px] sm:tracking-[0.18em]">
                      {'Aprova\u00e7\u00e3o Imediata'}
                    </span>
                  </div>
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
