import { motion } from 'framer-motion';
import { useLayoutEffect, useRef, type WheelEventHandler } from 'react';
import type { PreviewCard } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { SectionHeader } from './SectionHeader';

interface MediaPreviewRailProps {
  eyebrow: string;
  title: string;
  description: string;
  items: PreviewCard[];
  emptyMessage: string;
  variant?: 'wide' | 'portrait';
}

export function MediaPreviewRail({
  eyebrow,
  title,
  description,
  items,
  emptyMessage,
  variant = 'wide',
}: MediaPreviewRailProps) {
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

  const cardClassName =
    variant === 'portrait'
      ? 'relative self-start w-[50vw] max-w-[235px] shrink-0 snap-start overflow-hidden rounded-[26px] border border-white/10 bg-black md:w-[230px] lg:w-[250px]'
      : 'relative self-start w-[84vw] max-w-[580px] shrink-0 snap-start overflow-hidden rounded-[28px] border border-white/10 bg-black md:w-[620px] lg:w-[700px]';

  const aspectClassName =
    variant === 'portrait'
      ? 'relative aspect-[9/16] h-full overflow-hidden rounded-[inherit] bg-black'
      : 'relative aspect-[4/3] h-full overflow-hidden rounded-[inherit] bg-black';

  const scrollByCard = (direction: 'left' | 'right') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('[data-showcase-card]'),
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

    const previousCard = [...cards]
      .reverse()
      .find((card) => card.offsetLeft < currentLeft - tolerance);

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
                <article key={item.id} data-showcase-card className={cardClassName}>
                  <div className={aspectClassName}>
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
