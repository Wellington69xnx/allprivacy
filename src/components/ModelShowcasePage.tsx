import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getPreviewCardsForModelByType } from '../data/models';
import { getHomePath } from '../lib/modelRoute';
import type { GroupProofItem, ModelProfile } from '../types';
import { BrandMark } from './BrandMark';
import { FinalGroupCtaCard } from './FinalGroupCtaCard';
import { VerifiedBadgeIcon } from './icons';
import { MediaPreviewRail } from './MediaPreviewRail';
import { SiteFooter } from './SiteFooter';
import { TelegramProof } from './TelegramProof';
import { TelegramCTA } from './TelegramCTA';

interface ModelShowcasePageProps {
  model: ModelProfile | null;
  ctaHref: string;
  groupProofItems: GroupProofItem[];
  isLoading?: boolean;
}

export function ModelShowcasePage({
  model,
  ctaHref,
  groupProofItems,
  isLoading = false,
}: ModelShowcasePageProps) {
  const finalCtaButtonRef = useRef<HTMLDivElement>(null);
  const [isFinalCtaVisible, setIsFinalCtaVisible] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const videoPreviewCards = useMemo(
    () => (model ? getPreviewCardsForModelByType(model, 'video', 7) : []),
    [model],
  );
  const imagePreviewCards = useMemo(
    () => (model ? getPreviewCardsForModelByType(model, 'image', 10) : []),
    [model],
  );

  useEffect(() => {
    if (!model) {
      return;
    }

    const criticalImages = [model.coverImage, model.profileImage].filter(Boolean);
    const preloaders = criticalImages.map((src) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
      return image;
    });

    return () => {
      preloaders.forEach((image) => {
        image.src = '';
      });
    };
  }, [model]);

  useEffect(() => {
    if (!model || typeof window === 'undefined' || !finalCtaButtonRef.current) {
      setIsFinalCtaVisible(false);
      setIsMobileViewport(false);
      return;
    }

    const finalTarget = finalCtaButtonRef.current;
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    let finalObserver: IntersectionObserver | null = null;

    const setupObserver = () => {
      finalObserver?.disconnect();
      setIsMobileViewport(mediaQuery.matches);

      if (!mediaQuery.matches) {
        setIsFinalCtaVisible(false);
        return;
      }

      finalObserver = new IntersectionObserver(
        ([entry]) => {
          setIsFinalCtaVisible(entry.isIntersecting);
        },
        {
          threshold: 0.2,
        },
      );

      finalObserver.observe(finalTarget);
    };

    setupObserver();

    if ('addEventListener' in mediaQuery) {
      mediaQuery.addEventListener('change', setupObserver);
    } else {
      legacyMediaQuery.addListener?.(setupObserver);
    }

    return () => {
      finalObserver?.disconnect();

      if ('removeEventListener' in mediaQuery) {
        mediaQuery.removeEventListener('change', setupObserver);
      } else {
        legacyMediaQuery.removeListener?.(setupObserver);
      }
    };
  }, [model]);

  const showFloatingCta = isMobileViewport && !isFinalCtaVisible;

  if (isLoading && !model) {
    return (
      <div className="min-h-screen bg-ink text-white">
        <div className="fixed inset-0 bg-black" />
        <div className="relative mx-auto flex min-h-screen max-w-[1440px] flex-col items-center justify-center px-4 text-center">
          <BrandMark />
          <div className="mt-8 h-11 w-11 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="min-h-screen bg-ink px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <a
            href={getHomePath()}
            className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50"
          >
            {'Voltar para a home'}
          </a>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {'Modelo n\u00e3o encontrada'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300 sm:text-base">
            {
              'Essa rota n\u00e3o encontrou uma modelo v\u00e1lida. Volte para a home ou confira a URL divulgada.'
            }
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="fixed inset-0">
        <img
          src={model.coverImage}
          alt={model.name}
          className="h-full w-full object-cover object-center"
          loading="eager"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-black/90" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.2),transparent_24%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_34%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/35" />
      </div>

      <div className="relative">
        <div className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
          <div
            className="relative flex items-center justify-center px-4 py-5"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 1.25rem)' }}
          >
            <a
              href={getHomePath()}
              className="absolute -left-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/50 transition hover:text-white/75 sm:hidden"
            >
              <span aria-hidden="true">{'\u2039'}</span>
              <span>{'P\u00e1gina inicial'}</span>
            </a>
            <a
              href={getHomePath()}
              className="absolute left-4 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 transition hover:text-white/75 sm:inline-flex md:text-[13px]"
            >
              <span aria-hidden="true">{'\u2039'}</span>
              <span>{'P\u00e1gina inicial'}</span>
            </a>
            <div className="sm:hidden">
              <BrandMark
                href={getHomePath()}
                className="text-[1.08rem] tracking-[0.1em] max-[380px]:text-[0.98rem]"
              />
            </div>
            <div className="hidden sm:block">
              <BrandMark href={getHomePath()} />
            </div>
          </div>

          <header className="pt-24 sm:pt-8">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="w-full pt-12 pb-4 sm:py-14"
            >
              <div className="mt-0 flex items-start justify-between gap-4 sm:mt-5 sm:gap-5">
                <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/40 sm:h-20 sm:w-20">
                    <img
                      src={model.profileImage}
                      alt={model.name}
                      className="h-full w-full object-cover"
                      loading="eager"
                    />
                  </div>
                    <div className="min-w-0 self-center">
                      <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full border border-[#5ea8ff]/35 bg-[#5ea8ff]/16 px-3 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-white/88 shadow-[0_10px_24px_rgba(0,0,0,0.18)] sm:mb-3 sm:text-xs">
                        <VerifiedBadgeIcon className="h-4 w-4 shrink-0 text-[#4da3ff]" />
                        <span className="truncate">{'Conteúdo completo no GrupoVIP'}</span>
                      </div>
                      <h1 className="font-display text-4xl font-semibold leading-[0.94] tracking-tight text-white sm:text-6xl">
                        {model.name}
                      </h1>
                      {model.handle ? (
                        <p className="-mt-0.5 text-sm leading-none text-zinc-300 sm:-mt-1 sm:text-base">
                          {model.handle}
                        </p>
                      ) : null}
                    </div>
                  <div className="ml-auto hidden shrink-0 sm:inline-grid sm:gap-2">
                    <TelegramCTA
                      href={ctaHref}
                      label="Entrar no Grupo VIP"
                      className="min-h-16 w-auto min-w-[400px] px-8 py-4 text-[1.22rem]"
                      scrollTargetId="cta-final"
                    />
                    <span className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                      {'Acesso imediato'}
                    </span>
                  </div>
                </div>
              </div>
              {model.tagline ? (
                <p className="mt-5 max-w-[44ch] text-sm leading-6 text-zinc-200 sm:text-base">
                  {model.tagline}
                </p>
              ) : null}
            </motion.div>
          </header>

          <div className="space-y-4">
            <MediaPreviewRail
              eyebrow={'Pr\u00e9vias'}
              title={`Vídeos`}
              description="Entre no GrupoVIP e tenha acesso a todo conteúdo."
              items={videoPreviewCards}
              emptyMessage={'Ainda n\u00e3o existem v\u00eddeos liberados para essa modelo.'}
            />

            <MediaPreviewRail
              eyebrow={'Mais pr\u00e9vias'}
              title={`Imagens`}
              description={
                'Entre no GrupoVIP e tenha acesso a todo conteúdo.'
              }
              items={imagePreviewCards}
              emptyMessage={'Ainda n\u00e3o existem imagens liberadas para essa modelo.'}
              variant="portrait"
            />

            <TelegramProof items={groupProofItems} />

            <div id="cta-final" className="pt-6">
              <FinalGroupCtaCard ctaHref={ctaHref} buttonRef={finalCtaButtonRef} />
            </div>
          </div>
        </div>

        <SiteFooter />
      </div>

      {showFloatingCta ? (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#09090c] via-[#09090c]/95 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-6 sm:hidden">
          <div className="mx-auto max-w-[1440px]">
            <TelegramCTA
              href={ctaHref}
              label="Entrar no Grupo VIP"
              className="min-h-12 w-full px-5 py-3 text-sm"
              scrollTargetId="cta-final"
            />
            <span className="mt-1 block text-center text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              {'Acesso imediato'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
