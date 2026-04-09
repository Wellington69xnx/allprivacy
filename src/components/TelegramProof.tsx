import { motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState, type WheelEventHandler } from 'react';
import type { GroupProofItem } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { GroupProofDialog } from './GroupProofDialog';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { SectionHeader } from './SectionHeader';

interface TelegramProofProps {
  items: GroupProofItem[];
}

export function TelegramProof({ items }: TelegramProofProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const centeredPeekPadding = 'max(0.25rem, calc((100% - min(54vw, 250px)) / 2))';
  const getResolvedInitialIndex = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return 1;
    }

    return 0;
  };
  const getResolvedScrollAlign = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return 'center' as const;
    }

    return 'start' as const;
  };
  const resolvedScrollAlign = getResolvedScrollAlign();
  const scrollCardAlignmentClassName =
    resolvedScrollAlign === 'center' ? 'snap-center' : 'snap-start';
  const cardClassName = `relative self-start w-[54vw] max-w-[250px] shrink-0 ${scrollCardAlignmentClassName} overflow-hidden rounded-[26px] border border-white/10 bg-black md:w-[268px] md:max-w-[268px] lg:w-[292px] lg:max-w-[292px]`;
  const aspectClassName =
    'relative aspect-[9/16] h-full overflow-hidden rounded-[inherit] bg-black';

  const getTargetScrollLeft = (container: HTMLDivElement, card: HTMLElement) => {
    if (resolvedScrollAlign === 'center') {
      return Math.max(
        0,
        card.offsetLeft - (container.clientWidth - card.clientWidth) / 2,
      );
    }

    return card.offsetLeft;
  };

  useLayoutEffect(() => {
    const resetCarouselScroll = () => {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      const cards = Array.from(
        container.querySelectorAll<HTMLElement>('[data-proof-card]'),
      );
      const targetIndex = Math.min(
        Math.max(0, getResolvedInitialIndex()),
        Math.max(0, cards.length - 1),
      );
      const targetCard = cards[targetIndex];
      const targetLeft = targetCard ? getTargetScrollLeft(container, targetCard) : 0;

      container.scrollTo({ left: targetLeft, behavior: 'auto' });
      container.scrollLeft = targetLeft;
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
  }, [items.length]);

  const scrollByCard = (direction: 'left' | 'right') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('[data-proof-card]'),
    );

    if (cards.length === 0) {
      return;
    }

    const currentLeft = container.scrollLeft;
    const maxLeft = container.scrollWidth - container.clientWidth;
    const activeIndex = cards.reduce((closestIndex, card, index) => {
      const closestCard = cards[closestIndex];
      const currentDistance = Math.abs(getTargetScrollLeft(container, card) - currentLeft);
      const closestDistance = Math.abs(
        getTargetScrollLeft(container, closestCard) - currentLeft,
      );

      return currentDistance < closestDistance ? index : closestIndex;
    }, 0);

    const nextIndex =
      direction === 'right'
        ? Math.min(cards.length - 1, activeIndex + 1)
        : Math.max(0, activeIndex - 1);
    const nextCard = cards[nextIndex];
    const nextLeft = nextCard ? getTargetScrollLeft(container, nextCard) : currentLeft;

    container.scrollTo({
      left: Math.min(Math.max(0, nextLeft), maxLeft),
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
      className="pt-14 sm:pt-16"
    >
      <SectionHeader
        eyebrow="AllPrivacy.site"
        title={'Por dentro do grupo'}
        description={
          'Todo conteúdo organizado por tópicos para melhorar sua experiência'
        }
      />

      {items.length === 0 ? (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 text-sm text-zinc-300">
          Nenhum print do grupo cadastrado ainda. Use o painel admin para preencher esta
          faixa com capturas reais.
        </div>
      ) : (
        <div className="relative mt-6">
          <div
            ref={containerRef}
            className={`hide-scrollbar overflow-x-auto overflow-y-hidden pb-2 snap-x ${
              resolvedScrollAlign === 'center' ? 'snap-mandatory' : 'snap-proximity'
            }`}
            onWheel={handleWheelScroll}
            style={{
              overflowAnchor: 'none',
              scrollPaddingInline:
                resolvedScrollAlign === 'center' ? centeredPeekPadding : undefined,
            }}
          >
            <div
              className="flex w-max items-start gap-4 md:gap-5"
              style={{
                paddingInline:
                  resolvedScrollAlign === 'center' ? centeredPeekPadding : '0.25rem',
              }}
            >
              {items.map((item, index) => (
                <article
                  key={item.id}
                  data-proof-card
                  className={cardClassName}
                >
                  <div className={aspectClassName}>
                    <div
                      className="h-full w-full cursor-pointer"
                      onClick={() => setSelectedIndex(index)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedIndex(index);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Abrir ${item.title}`}
                    >
                      <AutoplayMedia
                        type="image"
                        poster={item.image}
                        alt={item.title}
                        className="h-full w-full"
                        fitMode="cover"
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-20 flex items-center justify-between px-2">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                scrollByCard('left');
              }}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/75 sm:h-10 sm:w-10 md:h-12 md:w-12"
            >
              <ChevronLeftIcon className="h-4 w-4 md:h-5 md:w-5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                scrollByCard('right');
              }}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/75 sm:h-10 sm:w-10 md:h-12 md:w-12"
            >
              <ChevronRightIcon className="h-4 w-4 md:h-5 md:w-5" />
            </button>
          </div>
        </div>
      )}

      <GroupProofDialog
        items={items}
        selectedIndex={selectedIndex}
        onClose={() => setSelectedIndex(null)}
        onSelect={setSelectedIndex}
      />
    </motion.section>
  );
}
