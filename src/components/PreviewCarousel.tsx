import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type UIEventHandler, type WheelEventHandler } from 'react';
import type { MediaPreviewDialogSelection, PreviewCard } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { CtaBonusNote } from './CtaBonusNote';
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from './icons';
import { MediaPreviewDialog } from './MediaPreviewDialog';
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
  onOwnerClick?: (item: PreviewCard) => void;
  videoCardAspect?: 'auto' | 'wide' | 'portrait';
  initialScrollIndex?: number;
  desktopInitialScrollIndex?: number;
  scrollAlign?: 'start' | 'center';
  desktopScrollAlign?: 'start' | 'center';
  variant?: 'wide' | 'portrait';
  sectionClassName?: string;
  preloadAdjacentVideoCards?: number;
  ctaTitle?: string;
  ctaDescription?: string;
  ctaScrollTargetId?: string;
  showOwnerBadge?: boolean;
  showCtaCard?: boolean;
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
  onOwnerClick,
  videoCardAspect = 'auto',
  initialScrollIndex = 0,
  desktopInitialScrollIndex,
  scrollAlign = 'start',
  desktopScrollAlign,
  variant = 'wide',
  sectionClassName,
  preloadAdjacentVideoCards = 0,
  ctaTitle = 'Entrar no Grupo',
  ctaDescription = 'Entre no grupo VIP e tenha acesso a conteúdos exclusivos de diversas modelos do Privacy, OnlyFans, XvideosRED, CloseFans e Telegram VIP. Tudo organizado em categorias para facilitar sua experiência.',
  ctaScrollTargetId = 'cta-final',
  showOwnerBadge = true,
  showCtaCard = true,
}: PreviewCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<MediaPreviewDialogSelection | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const hasVideoItems = items.some((item) => item.type === 'video');
  const usePortraitCards =
    variant === 'portrait' ||
    videoCardAspect === 'portrait' ||
    (videoCardAspect === 'auto' && hasVideoItems);
  const getResolvedInitialIndex = () => {
    if (
      typeof window !== 'undefined' &&
      desktopInitialScrollIndex !== undefined &&
      window.matchMedia('(min-width: 768px)').matches
    ) {
      return desktopInitialScrollIndex;
    }

    return initialScrollIndex;
  };
  const getResolvedScrollAlign = () => {
    if (
      typeof window !== 'undefined' &&
      desktopScrollAlign &&
      window.matchMedia('(min-width: 768px)').matches
    ) {
      return desktopScrollAlign;
    }

    return scrollAlign;
  };
  const resolvedScrollAlign = getResolvedScrollAlign();
  const scrollCardAlignmentClassName =
    resolvedScrollAlign === 'center' ? 'snap-center' : 'snap-start';
  const centeredPeekPadding = usePortraitCards
    ? 'max(0.25rem, calc((100% - min(54vw, 250px)) / 2))'
    : 'max(0.25rem, calc((100% - min(88vw, 600px)) / 2))';

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
        container.querySelectorAll<HTMLElement>('[data-scroll-card]'),
      );
      const resolvedInitialIndex = getResolvedInitialIndex();
      const targetIndex = Math.min(
        Math.max(0, resolvedInitialIndex),
        Math.max(0, cards.length - 1),
      );
      const targetCard = cards[targetIndex];
      const targetLeft = targetCard ? getTargetScrollLeft(container, targetCard) : 0;

      container.scrollTo({ left: targetLeft, behavior: 'auto' });
      container.scrollLeft = targetLeft;
      setActiveIndex(targetIndex);
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
  }, [
    desktopInitialScrollIndex,
    desktopScrollAlign,
    initialScrollIndex,
    items.length,
    scrollAlign,
    variant,
  ]);

  useEffect(() => {
    return () => {
      if (scrollSyncFrameRef.current) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
      }
    };
  }, []);

  const cardClassName =
    usePortraitCards
      ? `relative self-start w-[54vw] max-w-[250px] shrink-0 ${scrollCardAlignmentClassName} overflow-hidden rounded-[26px] border border-white/10 bg-black md:w-[268px] md:max-w-[268px] lg:w-[292px] lg:max-w-[292px]`
      : `relative self-start w-[88vw] max-w-[600px] shrink-0 ${scrollCardAlignmentClassName} overflow-hidden rounded-[28px] border border-white/10 bg-black md:w-[720px] md:max-w-[720px] lg:w-[820px] lg:max-w-[820px]`;

  const aspectClassName =
    usePortraitCards
      ? 'relative aspect-[9/16] h-full overflow-hidden rounded-[inherit] bg-black'
      : 'relative aspect-[4/3] h-full overflow-hidden rounded-[inherit] bg-black';
  const ctaCardClassName =
    usePortraitCards
      ? `relative self-start aspect-[9/16] w-[54vw] max-w-[250px] shrink-0 ${scrollCardAlignmentClassName} overflow-hidden rounded-[26px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.05] to-transparent md:w-[268px] md:max-w-[268px] lg:w-[292px] lg:max-w-[292px]`
      : `relative self-start aspect-[4/3] w-[88vw] max-w-[600px] shrink-0 ${scrollCardAlignmentClassName} overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.09] via-white/[0.05] to-transparent md:w-[720px] md:max-w-[720px] lg:w-[820px] lg:max-w-[820px]`;

  const ctaContentClassName =
    usePortraitCards
      ? 'absolute inset-0 flex h-full w-full min-h-0 flex-col justify-between gap-3 p-4 sm:p-5'
      : 'absolute inset-0 flex h-full w-full min-h-0 flex-col justify-between gap-2 p-3 sm:gap-3 sm:p-4 md:p-5 lg:p-6';

  const ctaTextBlockClassName =
    usePortraitCards
      ? 'flex flex-1 flex-col justify-center text-center'
      : 'flex flex-1 flex-col justify-center text-center md:text-left';

  const ctaTitleClassName =
    usePortraitCards
      ? 'font-display text-xl font-semibold tracking-tight text-white sm:text-2xl'
      : 'font-display text-xl font-semibold tracking-tight text-white sm:text-2xl md:text-[1.7rem] lg:text-[2rem]';

  const ctaDescriptionClassName =
    usePortraitCards
      ? 'mt-2 text-[13px] leading-5 text-zinc-300 sm:text-sm sm:leading-6'
      : 'mt-2 text-[13px] leading-5 text-zinc-300 sm:text-sm sm:leading-6 md:text-[15px] md:leading-6 lg:text-base';

  const ctaButtonClassName =
    usePortraitCards
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

  const syncActiveIndex = () => {
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
    const nextIndex = cards.reduce((closestIndex, card, index) => {
      const closestCard = cards[closestIndex];
      const currentDistance = Math.abs(getTargetScrollLeft(container, card) - currentLeft);
      const closestDistance = Math.abs(
        getTargetScrollLeft(container, closestCard) - currentLeft,
      );

      return currentDistance < closestDistance ? index : closestIndex;
    }, 0);

    setActiveIndex(nextIndex);
  };

  const handleScroll: UIEventHandler<HTMLDivElement> = () => {
    if (scrollSyncFrameRef.current) {
      window.cancelAnimationFrame(scrollSyncFrameRef.current);
    }

    scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      syncActiveIndex();
      scrollSyncFrameRef.current = null;
    });
  };

  const buildDialogSelection = (
    item: PreviewCard,
    element: HTMLElement,
  ): MediaPreviewDialogSelection => {
    if (item.type !== 'video') {
      return { item };
    }

    const video = element.querySelector('video');

    if (!video) {
      return { item };
    }

    let handoffPoster = '';

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');

        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          handoffPoster = canvas.toDataURL('image/jpeg', 0.76);
        }
      } catch {
        handoffPoster = '';
      }
    }

    return {
      item,
      initialPlaybackTime:
        Number.isFinite(video.currentTime) && video.currentTime > 0
          ? video.currentTime
          : undefined,
      handoffPoster: handoffPoster || undefined,
    };
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
            className={`hide-scrollbar overflow-x-auto overflow-y-hidden pb-2 snap-x ${
              resolvedScrollAlign === 'center' ? 'snap-mandatory' : 'snap-proximity'
            }`}
            onScroll={handleScroll}
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
                    data-scroll-card
                    className={cardClassName}
                  >
                  <div className={aspectClassName}>
                    {showOwnerBadge ? (
                      <div className="absolute inset-x-3 top-3 z-10">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onOwnerClick?.(item);
                          }}
                          className="inline-flex rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75 backdrop-blur-md transition hover:bg-black/65 hover:text-white disabled:cursor-default disabled:hover:bg-black/45 disabled:hover:text-white/75"
                          disabled={!onOwnerClick}
                        >
                          {item.owner}
                        </button>
                      </div>
                    ) : null}
                    <div
                      className="h-full w-full cursor-pointer"
                      onClick={(event) =>
                        setSelectedItem(buildDialogSelection(item, event.currentTarget))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedItem(buildDialogSelection(item, event.currentTarget));
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Abrir visualização de ${item.title}`}
                    >
                      {item.type === 'video' && item.disableAutoplay ? (
                        <>
                          <img
                            src={item.thumbnail}
                            alt={item.title}
                            className="h-full w-full object-cover object-center"
                            loading="lazy"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,3,5,0.08),rgba(3,3,5,0.2),rgba(3,3,5,0.42))]" />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/12 bg-black/48 text-white shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-md md:h-[4.5rem] md:w-[4.5rem]">
                              <PlayIcon className="ml-1 h-7 w-7 md:h-8 md:w-8" />
                            </span>
                          </div>
                        </>
                      ) : (
                        <AutoplayMedia
                          type={item.type}
                          src={item.src}
                          poster={item.thumbnail}
                          alt={item.title}
                          className="h-full w-full"
                          fitMode={item.type === 'video' && variant === 'wide' ? 'contain' : 'cover'}
                          showVolumeToggle
                          forceActivateVideo={
                            item.type === 'video' &&
                            preloadAdjacentVideoCards > 0 &&
                            Math.abs(index - activeIndex) <= preloadAdjacentVideoCards
                          }
                        />
                      )}
                    </div>
                    </div>
                  </article>
              ))}

              {showCtaCard ? (
                <div data-scroll-card className={ctaCardClassName}>
                  <div className={ctaContentClassName}>
                    <div className={ctaTextBlockClassName}>
                      <h3 className={ctaTitleClassName}>{ctaTitle}</h3>
                      <p className={ctaDescriptionClassName}>{ctaDescription}</p>
                    </div>

                    <div className="grid gap-1.5 sm:gap-2">
                      <TelegramCTA
                        href={ctaHref}
                        label={ctaLabel}
                        className={ctaButtonClassName}
                        scrollTargetId={ctaScrollTargetId}
                      />
                      <CtaBonusNote
                        className="text-[10px] font-medium tracking-[0.16em] text-white/45 sm:text-[11px] sm:tracking-[0.18em]"
                        logoClassName="-translate-y-[0.06em] h-[2.3em] w-auto object-contain brightness-110"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
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

      <MediaPreviewDialog selection={selectedItem} onClose={() => setSelectedItem(null)} />
    </motion.section>
  );
}
