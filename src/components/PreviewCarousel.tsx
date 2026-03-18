import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type WheelEventHandler } from 'react';
import type { PreviewCard } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { SectionHeader } from './SectionHeader';

interface PreviewCarouselProps {
  items: PreviewCard[];
}

export function PreviewCarousel({ items }: PreviewCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pauseTimeoutRef = useRef<number | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const loopItems = [...items, ...items];

  useEffect(() => {
    const container = containerRef.current;

    if (!container || isInteracting) {
      return;
    }

    let frameId = 0;
    let lastTimestamp = performance.now();

    const tick = (timestamp: number) => {
      const elapsed = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      container.scrollLeft += elapsed * 0.008;

      if (container.scrollLeft >= container.scrollWidth / 2) {
        container.scrollLeft -= container.scrollWidth / 2;
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isInteracting]);

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) {
        window.clearTimeout(pauseTimeoutRef.current);
      }
    };
  }, []);

  const pauseAutoscroll = () => {
    setIsInteracting(true);

    if (pauseTimeoutRef.current) {
      window.clearTimeout(pauseTimeoutRef.current);
    }

    pauseTimeoutRef.current = window.setTimeout(() => {
      setIsInteracting(false);
    }, 1800);
  };

  const handleArrowScroll = (direction: 'left' | 'right') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    pauseAutoscroll();

    container.scrollBy({
      left: direction === 'right' ? 520 : -520,
      behavior: 'smooth',
    });
  };

  const handleWheelScroll: WheelEventHandler<HTMLDivElement> = (event) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
      return;
    }

    pauseAutoscroll();
    event.preventDefault();
    container.scrollLeft += event.deltaY;
  };

  return (
    <motion.section
      id="previas"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pt-10"
    >
      <SectionHeader
        eyebrow="Previas Exclusivas"
        title="Mais clima +18, menos ruido visual em cima das midias."
        description="O carrossel ficou mais lento, com setas discretas em qualquer tela e rolagem manual funcionando melhor no desktop."
      />

      <div className="relative mt-6">
        <div
          ref={containerRef}
          className="hide-scrollbar overflow-x-auto pb-2 snap-x snap-mandatory"
          onWheel={handleWheelScroll}
          onMouseEnter={() => setIsInteracting(true)}
          onMouseLeave={() => setIsInteracting(false)}
          onTouchStart={() => setIsInteracting(true)}
          onTouchEnd={() => setIsInteracting(false)}
        >
          <div className="flex w-max gap-5 px-1">
            {loopItems.map((item, index) => (
              <article
                key={`${item.id}-${index}`}
                className="w-[88vw] max-w-[540px] shrink-0 snap-start overflow-hidden rounded-[28px] bg-black md:w-[560px] lg:w-[680px]"
              >
                <div className="aspect-[16/10]">
                  <AutoplayMedia
                    type={item.type}
                    src={item.src}
                    poster={item.thumbnail}
                    alt={item.title}
                    className="h-full w-full"
                  />
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => handleArrowScroll('left')}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/75 sm:h-10 sm:w-10 md:h-12 md:w-12"
          >
            <ChevronLeftIcon className="h-4 w-4 md:h-5 md:w-5" />
          </button>
          <button
            type="button"
            onClick={() => handleArrowScroll('right')}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/85 backdrop-blur-md transition hover:bg-black/75 sm:h-10 sm:w-10 md:h-12 md:w-12"
          >
            <ChevronRightIcon className="h-4 w-4 md:h-5 md:w-5" />
          </button>
        </div>
      </div>
    </motion.section>
  );
}
