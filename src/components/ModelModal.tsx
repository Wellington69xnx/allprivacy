import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hasWarmVideo, primeKnownWarmVideos } from '../lib/mediaWarmCache';
import type { ModelProfile } from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { CloseIcon } from './icons';
import { TelegramCTA } from './TelegramCTA';

interface ModelModalProps {
  model: ModelProfile | null;
  models: ModelProfile[];
  onClose: () => void;
  ctaHref: string;
}

interface GhostPreviewCard {
  id: string;
  image: string;
  aspectClassName: string;
}

function buildGhostPreviewCards(model: ModelProfile | null, models: ModelProfile[]) {
  if (!model) {
    return [] as GhostPreviewCard[];
  }

  const sourceModels = models.filter((entry) => entry.id !== model.id);
  const galleryPool = sourceModels.flatMap((entry) =>
    entry.gallery
      .filter((item) => item.type === 'image' && item.thumbnail)
      .map((item) => ({
        image: item.thumbnail,
        aspectClassName: 'aspect-[4/5]',
        sourceKey: `${entry.id}-${item.id}`,
      })),
  );
  const fallbackPool = sourceModels.flatMap((entry) => [
    {
      image: entry.coverImage,
      aspectClassName: 'aspect-[4/5]',
      sourceKey: `${entry.id}-cover`,
    },
    {
      image: entry.profileImage,
      aspectClassName: 'aspect-[4/5]',
      sourceKey: `${entry.id}-profile`,
    },
  ]);
  const imagePool = [...galleryPool, ...fallbackPool]
    .filter((item) => item.image)
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.image === item.image) === index,
    );

  if (imagePool.length === 0) {
    return [] as GhostPreviewCard[];
  }

  const ghostCount = Math.min(12, imagePool.length);

  return Array.from({ length: ghostCount }, (_, index) => {
    const source = imagePool[index % imagePool.length];

    return {
      id: `ghost-preview-${model.id}-${index}-${source.sourceKey}`,
      image: source.image,
      aspectClassName: source.aspectClassName,
    };
  });
}

export function ModelModal({ model, models, onClose, ctaHref }: ModelModalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreTimeoutRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [ghostRevealCount, setGhostRevealCount] = useState(2);
  const [ghostRevealClicks, setGhostRevealClicks] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const syncViewport = () => {
      setIsDesktopViewport(mediaQuery.matches);
    };

    syncViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport);
      return () => {
        mediaQuery.removeEventListener('change', syncViewport);
      };
    }

    mediaQuery.addListener(syncViewport);
    return () => {
      mediaQuery.removeListener(syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!model) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [model, onClose]);

  useEffect(() => {
    if (!model) {
      setVisibleCount(0);
      setIsLoadingMore(false);
      setGhostRevealCount(2);
      setGhostRevealClicks(0);
      return;
    }

    const initialCount =
      typeof window !== 'undefined'
        ? window.matchMedia('(min-width: 1280px)').matches
          ? 8
          : window.matchMedia('(min-width: 768px)').matches
            ? 6
            : 4
        : 4;

    setVisibleCount(Math.min(model.gallery.length, initialCount));
    setIsLoadingMore(false);
    setGhostRevealCount(typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches ? 3 : 2);
    setGhostRevealClicks(0);

    if (loadMoreTimeoutRef.current) {
      window.clearTimeout(loadMoreTimeoutRef.current);
      loadMoreTimeoutRef.current = null;
    }
  }, [model]);

  useEffect(() => {
    if (!model) {
      return;
    }

    primeKnownWarmVideos(
      model.gallery
        .filter((item) => item.type === 'video')
        .map((item) => item.src),
    );
  }, [model]);

  useEffect(() => {
    return () => {
      if (loadMoreTimeoutRef.current) {
        window.clearTimeout(loadMoreTimeoutRef.current);
      }
    };
  }, []);

  const visibleGallery = useMemo(
    () => (model ? model.gallery.slice(0, visibleCount) : []),
    [model, visibleCount],
  );
  const ghostPreviewCards = useMemo(() => buildGhostPreviewCards(model, models), [model, models]);

  const skeletonCount =
    model && isLoadingMore && visibleCount < model.gallery.length
      ? Math.min(4, model.gallery.length - visibleCount)
      : 0;
  const showGhostPreviewCards =
    Boolean(model) && visibleCount >= (model?.gallery.length ?? 0) && ghostPreviewCards.length > 0;
  const ghostRevealStep = isDesktopViewport ? 3 : 2;
  const visibleGhostCards = useMemo(
    () => ghostPreviewCards.slice(0, Math.min(ghostPreviewCards.length, ghostRevealCount)),
    [ghostPreviewCards, ghostRevealCount],
  );
  const canRevealMoreGhostCards =
    ghostRevealClicks < 5 && visibleGhostCards.length < ghostPreviewCards.length;

  const loadMore = () => {
    if (!model || isLoadingMore || visibleCount >= model.gallery.length) {
      return;
    }

    setIsLoadingMore(true);
    loadMoreTimeoutRef.current = window.setTimeout(() => {
      setVisibleCount((current) => Math.min(current + 4, model.gallery.length));
      setIsLoadingMore(false);
      loadMoreTimeoutRef.current = null;
    }, 260);
  };

  const checkShouldLoadMore = () => {
    const container = scrollContainerRef.current;

    if (!container || !model || visibleCount >= model.gallery.length) {
      return;
    }

    const remaining = container.scrollHeight - (container.scrollTop + container.clientHeight);

    if (remaining <= 260) {
      loadMore();
    }
  };

  return (
    <AnimatePresence>
      {model ? (
        <motion.div
          key={model.id}
          className="fixed inset-0 z-50 overflow-hidden bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="flex min-h-full items-end justify-center overflow-hidden px-0 md:items-center md:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`Conteúdo de ${model.name}`}
              className="relative h-[min(95dvh,900px)] w-screen max-w-full overflow-hidden rounded-t-[32px] border border-white/10 bg-[#09090c]/95 shadow-2xl md:h-[min(82vh,780px)] md:w-[min(1180px,95vw)] md:rounded-[32px]"
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.98 }}
              transition={{ type: 'spring', damping: 30, stiffness: 240 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md"
              >
                <CloseIcon className="h-5 w-5" />
              </button>

              <div
                ref={scrollContainerRef}
                className="hide-scrollbar h-full w-full overflow-x-hidden overflow-y-auto"
                onScroll={checkShouldLoadMore}
              >
                <div className="relative h-[260px] overflow-hidden border-b border-white/10 md:h-[300px] lg:h-[340px]">
                  <img
                    src={model.coverImage}
                    alt={model.name}
                    className="h-full w-full object-cover object-center md:object-[center_22%]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#09090c] via-black/20 to-black/10" />

                  <div className="absolute inset-x-5 bottom-5 md:inset-x-8 md:bottom-8">
                    <div className="flex items-end justify-between gap-4">
                      <div className="max-w-3xl">
                        <h3 className="font-display text-3xl font-semibold text-white md:text-5xl">
                          {model.name}
                        </h3>
                        {model.handle ? (
                          <p className="mt-2 text-sm text-zinc-200 md:text-base">{model.handle}</p>
                        ) : null}
                        {model.tagline ? (
                          <p className="mt-4 max-w-[42ch] text-sm leading-6 text-zinc-200/90 md:text-base">
                            {model.tagline}
                          </p>
                        ) : null}
                      </div>

                      <div className="hidden shrink-0 md:block">
                        <TelegramCTA
                          href={ctaHref}
                          label="Entrar no GrupoVIP"
                          className="min-h-12 w-auto px-6 py-3 text-base"
                        />
                        <span className="mt-1.5 block text-center text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                          {'Acesso imediato'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-5 pb-32 md:p-8">
                  {model.gallery.length === 0 ? (
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-300">
                      {'Essa modelo ainda não tem prévias cadastradas no painel admin.'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      {visibleGallery.map((item) => (
                        <article
                          key={item.id}
                          className="overflow-hidden rounded-[24px] bg-black"
                        >
                          <div
                            className={`bg-zinc-950 ${
                              item.type === 'video' ? 'aspect-[9/16]' : 'aspect-[4/5]'
                            }`}
                          >
                            <AutoplayMedia
                              type={item.type}
                              src={item.src}
                              poster={item.thumbnail}
                              alt={item.title}
                              className="h-full w-full"
                              preloadStrategy={
                                item.type === 'video' && hasWarmVideo(item.src)
                                  ? 'auto'
                                  : 'metadata'
                              }
                              showVolumeToggle
                              showLoadingSkeleton
                            />
                          </div>
                        </article>
                      ))}

                      {Array.from({ length: skeletonCount }).map((_, index) => (
                        <article
                          key={`model-modal-skeleton-${model.id}-${visibleCount}-${index}`}
                          className="overflow-hidden rounded-[24px] bg-black"
                          aria-hidden="true"
                        >
                          <div className="skeleton-shimmer aspect-[4/5] bg-zinc-950">
                            <div className="absolute inset-x-4 bottom-4 space-y-2">
                              <div className="h-3 w-2/3 rounded-full bg-white/10" />
                              <div className="h-3 w-1/2 rounded-full bg-white/10" />
                            </div>
                          </div>
                        </article>
                      ))}

                      {showGhostPreviewCards ? (
                        <div className="relative col-span-full">
                          <div className={`grid gap-3 ${isDesktopViewport ? 'grid-cols-3' : 'grid-cols-2'}`}>
                            {visibleGhostCards.map((item, index) => {
                              const isTailCard =
                                index >= Math.max(0, visibleGhostCards.length - (isDesktopViewport ? 3 : 2));

                              return (
                                <article
                                  key={`${item.id}-${isDesktopViewport ? 'desktop' : 'mobile'}`}
                                  aria-hidden="true"
                                  className={`relative overflow-hidden rounded-[24px] bg-black/90 blur-[1.4px] saturate-75 ${
                                    isTailCard ? 'opacity-52' : 'opacity-72'
                                  }`}
                                >
                                  <div className={`relative overflow-hidden bg-zinc-950 ${item.aspectClassName}`}>
                                    <img
                                      src={item.image}
                                      alt=""
                                      className="h-full w-full scale-110 object-cover blur-[10px]"
                                      loading="lazy"
                                    />
                                    <div
                                      className={`absolute inset-0 ${
                                        isTailCard ? 'bg-black/54' : 'bg-black/34'
                                      }`}
                                    />
                                    <div className="absolute inset-x-4 bottom-4 space-y-2">
                                      <div className="h-2.5 w-2/3 rounded-full bg-white/12" />
                                      <div className="h-2.5 w-1/2 rounded-full bg-white/10" />
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>

                          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (!canRevealMoreGhostCards) {
                                  if (typeof window !== 'undefined') {
                                    window.location.href = ctaHref;
                                  }
                                  return;
                                }

                                setGhostRevealClicks((current) => current + 1);
                                setGhostRevealCount((current) =>
                                  Math.min(ghostPreviewCards.length, current + ghostRevealStep),
                                );
                              }}
                              className="pointer-events-auto inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-[0_14px_36px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-white/[0.1]"
                            >
                              {'Ver mais ↓'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#09090c] via-[#09090c]/95 to-transparent px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-6 md:hidden">
                <TelegramCTA
                  href={ctaHref}
                  label="Entrar no GrupoVIP"
                  className="min-h-12 w-full px-5 py-3 text-sm"
                />
                <span className="mt-1 block text-center text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                  {'Acesso imediato'}
                </span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
