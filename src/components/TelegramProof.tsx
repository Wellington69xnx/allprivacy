import { motion } from 'framer-motion';
import { useLayoutEffect, useRef, type WheelEventHandler } from 'react';
import type { GroupProofItem } from '../types';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { SectionHeader } from './SectionHeader';

interface TelegramProofProps {
  items: GroupProofItem[];
}

export function TelegramProof({ items }: TelegramProofProps) {
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

    resetCarouselScroll();
    const frameA = window.requestAnimationFrame(resetCarouselScroll);
    const frameB = window.requestAnimationFrame(resetCarouselScroll);

    window.addEventListener('pageshow', resetCarouselScroll);

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
      window.removeEventListener('pageshow', resetCarouselScroll);
    };
  }, []);

  const scrollByCard = (direction: 'left' | 'right') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const firstCard = container.querySelector<HTMLElement>('[data-proof-card]');
    const distance = firstCard ? firstCard.offsetWidth + 16 : 280;

    container.scrollBy({
      left: direction === 'right' ? distance : -distance,
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
      className="pt-14"
    >
      <SectionHeader
        eyebrow="Grupo por Dentro"
        title="Faixa horizontal para prints reais do grupo."
        description="Os prints ficam em formato vertical, como capturas do proprio aparelho, com setas discretas e deslizamento manual."
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
            className="hide-scrollbar overflow-x-auto pb-2 snap-x snap-mandatory"
            onWheel={handleWheelScroll}
          >
            <div className="flex w-max gap-4 px-1">
              {items.map((item, index) => (
                <motion.article
                  key={item.id}
                  data-proof-card
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                  className="w-[56vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-[26px] md:w-[280px] lg:w-[320px]"
                >
                  <div className="aspect-[9/16]">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </motion.article>
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
