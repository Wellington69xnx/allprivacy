import { motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { getPreviewCardsForModelByType } from '../data/models';
import type { SubscriptionPlanLink } from '../lib/subscriptionPlans';
import { getHomePath } from '../lib/modelRoute';
import type { ModelProfile } from '../types';
import { BrandMark } from './BrandMark';
import { MediaPreviewRail } from './MediaPreviewRail';
import { PlanOptions } from './PlanOptions';
import { SiteFooter } from './SiteFooter';
import { TelegramCTA } from './TelegramCTA';

interface ModelShowcasePageProps {
  model: ModelProfile | null;
  ctaHref: string;
  planOptions: SubscriptionPlanLink[];
  isLoading?: boolean;
}

export function ModelShowcasePage({
  model,
  ctaHref,
  planOptions,
  isLoading = false,
}: ModelShowcasePageProps) {
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
            Voltar para a home
          </a>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Modelo nao encontrada
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300 sm:text-base">
            Essa rota nao encontrou uma modelo valida. Volte para a home ou confira a URL
            divulgada.
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
              <span aria-hidden="true">‹</span>
              <span>Pagina inicial</span>
            </a>
            <a
              href={getHomePath()}
              className="absolute left-4 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 transition hover:text-white/75 sm:inline-flex md:text-[13px]"
            >
              <span aria-hidden="true">‹</span>
              <span>Pagina inicial</span>
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

          <header className="pt-28 sm:pt-8">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="max-w-3xl py-12 sm:py-14"
            >
              <div className="mt-0 flex items-center gap-4 sm:mt-5 sm:gap-5">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/40 sm:h-20 sm:w-20">
                  <img
                    src={model.profileImage}
                    alt={model.name}
                    className="h-full w-full object-cover"
                    loading="eager"
                  />
                </div>
                <div className="min-w-0 self-center">
                  <h1 className="font-display text-4xl font-semibold leading-[0.94] tracking-tight text-white sm:text-6xl">
                    {model.name}
                  </h1>
                  {model.handle ? (
                    <p className="-mt-0.5 text-sm leading-none text-zinc-300 sm:-mt-1 sm:text-base">
                      {model.handle}
                    </p>
                  ) : null}
                </div>
              </div>
              {model.tagline ? (
                <p className="mt-5 max-w-[44ch] text-sm leading-6 text-zinc-200 sm:text-base">
                  {model.tagline}
                </p>
              ) : null}

              <TelegramCTA
                href={ctaHref}
                label="Entrar no Grupo VIP"
                className="mt-6 w-full sm:w-auto"
                scrollTargetId="cta-final"
              />
            </motion.div>
          </header>

          <div className="space-y-4 rounded-[36px] border border-white/10 bg-black/25 p-4 backdrop-blur-xl sm:p-6 lg:p-8">
            <MediaPreviewRail
              eyebrow="Previas"
              title={`Videos de ${model.name.split(' ')[0]}`}
              description="Uma faixa independente para divulgar a modelo com os mesmos cards fluidos da home."
              items={videoPreviewCards}
              emptyMessage="Ainda nao existem videos liberados para essa modelo."
            />

            <MediaPreviewRail
              eyebrow="Mais previas"
              title={`Imagens de ${model.name.split(' ')[0]}`}
              description="A galeria continua com imagens aleatorias do mesmo cadastro do painel admin."
              items={imagePreviewCards}
              emptyMessage="Ainda nao existem imagens liberadas para essa modelo."
              variant="portrait"
            />

            <div id="cta-final" className="pt-6">
              <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent p-5 shadow-neon sm:p-6">
                <h2 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Entrar no grupo para ver mais de {model.name.split(' ')[0]}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                  Escolha abaixo entre o acesso de 7 dias por R$ 9,99 ou 30 dias por
                  R$ 19,99 para continuar no bot com a cobranca correta.
                </p>
                <PlanOptions plans={planOptions} className="mt-5" />
              </div>
            </div>
          </div>
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
