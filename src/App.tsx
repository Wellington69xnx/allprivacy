import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useState } from 'react';
import { AdminLogin } from './components/AdminLogin';
import { AdminPanel } from './components/AdminPanel';
import { HeroSection } from './components/HeroSection';
import { ModelModal } from './components/ModelModal';
import { ModelShowcasePage } from './components/ModelShowcasePage';
import { ModelsStories } from './components/ModelsStories';
import { PreviewCarousel } from './components/PreviewCarousel';
import { TelegramCTA } from './components/TelegramCTA';
import { TelegramProof } from './components/TelegramProof';
import { getRandomPreviewCardsByType, heroBackdrop } from './data/models';
import { useAdminAuth } from './hooks/useAdminAuth';
import { useSiteContent } from './hooks/useSiteContent';
import { findModelByRouteSlug, getAdminPath, getHomePath } from './lib/modelRoute';
import type { PreviewCard } from './types';

const TELEGRAM_GROUP_URL = 'https://t.me/seu_grupo_vip';

const perks = [
  'Entrada em um toque',
  'Atmosfera premium mobile-first',
  'Modal individual por modelo',
];

type CurrentView =
  | { type: 'site' }
  | { type: 'admin' }
  | { type: 'model'; modelSlug: string };

function buildHeroBackgroundPool(
  mobileBackgrounds: { image: string }[],
  desktopBackgrounds: { image: string }[],
  isMobile: boolean,
) {
  const primaryPool = isMobile ? mobileBackgrounds : desktopBackgrounds;
  const fallbackPool = isMobile ? desktopBackgrounds : mobileBackgrounds;
  const pool = primaryPool.length > 0 ? primaryPool : fallbackPool;

  if (pool.length === 0) {
    return [heroBackdrop];
  }

  return pool
    .map((item) => item.image)
    .filter(Boolean)
    .filter((image, index, images) => images.indexOf(image) === index);
}

function pickRandomHeroBackground(pool: string[], currentBackground?: string | null) {
  if (pool.length === 0) {
    return heroBackdrop;
  }

  if (pool.length === 1) {
    return pool[0] || heroBackdrop;
  }

  const filteredPool = currentBackground
    ? pool.filter((item) => item !== currentBackground)
    : pool;
  const nextPool = filteredPool.length > 0 ? filteredPool : pool;
  const randomIndex = Math.floor(Math.random() * nextPool.length);
  return nextPool[randomIndex] || pool[0] || heroBackdrop;
}

function getCurrentView(): CurrentView {
  if (typeof window === 'undefined') {
    return { type: 'site' };
  }

  const pathname = window.location.pathname || '/';
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;

  if (normalizedPathname === getAdminPath()) {
    return { type: 'admin' };
  }

  if (normalizedPathname.startsWith('/atriz/')) {
    return {
      type: 'model',
      modelSlug: decodeURIComponent(normalizedPathname.replace(/^\/atriz\//, '')),
    };
  }

  if (normalizedPathname !== getHomePath()) {
    return {
      type: 'model',
      modelSlug: decodeURIComponent(normalizedPathname.slice(1)),
    };
  }

  return { type: 'site' };
}

export default function App() {
  const [currentView, setCurrentView] = useState(getCurrentView);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [videoPreviewCards, setVideoPreviewCards] = useState<PreviewCard[]>([]);
  const [imagePreviewCards, setImagePreviewCards] = useState<PreviewCard[]>([]);
  const [heroBackgroundPool, setHeroBackgroundPool] = useState<string[]>([]);
  const [heroBackgroundSrc, setHeroBackgroundSrc] = useState<string | null>(null);
  const { siteContent, isLoading: isSiteLoading, ...actions } = useSiteContent();
  const adminAuth = useAdminAuth();

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || currentView.type === 'admin') {
      return;
    }

    const previousScrollRestoration =
      'scrollRestoration' in window.history ? window.history.scrollRestoration : undefined;

    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const resetWindowScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetWindowScroll();
    const frameA = window.requestAnimationFrame(() => {
      resetWindowScroll();
    });
    const frameB = window.requestAnimationFrame(() => {
      resetWindowScroll();
    });

    window.addEventListener('pageshow', resetWindowScroll);

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
      window.removeEventListener('pageshow', resetWindowScroll);

      if (previousScrollRestoration) {
        window.history.scrollRestoration = previousScrollRestoration;
      }
    };
  }, [currentView.type, currentView.type === 'model' ? currentView.modelSlug : '']);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const migrateLegacyHashRoute = () => {
      const hash = window.location.hash;
      const pathname = window.location.pathname || '/';
      const normalizedPathname =
        pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;

      if (normalizedPathname.startsWith('/atriz/')) {
        window.history.replaceState(
          null,
          '',
          `/${decodeURIComponent(normalizedPathname.replace(/^\/atriz\//, ''))}`,
        );
      }

      if (hash === '#/' || hash === '#') {
        if (window.location.pathname !== getHomePath()) {
          window.history.replaceState(null, '', getHomePath());
        }
        return;
      }

      if (!hash) {
        return;
      }

      if (hash === '#/admin') {
        window.history.replaceState(null, '', getAdminPath());
        return;
      }

      const legacyModelMatch = hash.match(/^#\/atriz\/(.+)$/);

      if (legacyModelMatch?.[1]) {
        window.history.replaceState(null, '', `/${decodeURIComponent(legacyModelMatch[1])}`);
      }
    };

    const onLocationChange = () => {
      setCurrentView(getCurrentView());
    };

    migrateLegacyHashRoute();
    onLocationChange();
    window.addEventListener('popstate', onLocationChange);

    return () => {
      window.removeEventListener('popstate', onLocationChange);
    };
  }, []);

  useEffect(() => {
    setVideoPreviewCards(getRandomPreviewCardsByType(siteContent.models, 'video', 7));
    setImagePreviewCards(getRandomPreviewCardsByType(siteContent.models, 'image', 10));
  }, [siteContent.models]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (isSiteLoading) {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };

    const syncBackgroundPool = () => {
      const nextPool = buildHeroBackgroundPool(
        siteContent.heroBackgrounds.mobile,
        siteContent.heroBackgrounds.desktop,
        mediaQuery.matches,
      );
      setHeroBackgroundPool(nextPool);
      setHeroBackgroundSrc((current) => {
        if (current && nextPool.includes(current)) {
          return current;
        }

        return pickRandomHeroBackground(nextPool);
      });
    };

    syncBackgroundPool();
    if ('addEventListener' in mediaQuery) {
      mediaQuery.addEventListener('change', syncBackgroundPool);
    } else if (legacyMediaQuery.addListener) {
      legacyMediaQuery.addListener(syncBackgroundPool);
    }

    return () => {
      if ('removeEventListener' in mediaQuery) {
        mediaQuery.removeEventListener('change', syncBackgroundPool);
      } else if (legacyMediaQuery.removeListener) {
        legacyMediaQuery.removeListener(syncBackgroundPool);
      }
    };
  }, [isSiteLoading, siteContent.heroBackgrounds.desktop, siteContent.heroBackgrounds.mobile]);

  useEffect(() => {
    if (typeof window === 'undefined' || !heroBackgroundSrc || heroBackgroundPool.length <= 1) {
      return;
    }

    let cancelled = false;
    const nextBackground = pickRandomHeroBackground(heroBackgroundPool, heroBackgroundSrc);
    const image = new Image();
    image.decoding = 'async';
    image.src = nextBackground;

    const applyBackground = () => {
      if (!cancelled) {
        setHeroBackgroundSrc(nextBackground);
      }
    };

    const timeoutId = window.setTimeout(() => {
      if (image.complete) {
        applyBackground();
        return;
      }

      image.onload = applyBackground;
      image.onerror = applyBackground;
    }, 5000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [heroBackgroundPool, heroBackgroundSrc]);

  const selectedModel =
    siteContent.models.find((model) => model.id === selectedModelId) ?? null;

  if (currentView.type === 'admin') {
    if (adminAuth.isChecking) {
      return <AdminLogin isChecking error={null} onLogin={adminAuth.login} />;
    }

    if (!adminAuth.isAuthenticated) {
      return (
        <AdminLogin
          isChecking={false}
          error={adminAuth.error}
          onLogin={adminAuth.login}
        />
      );
    }

    return (
      <AdminPanel
        siteContent={siteContent}
        isLoading={isSiteLoading}
        onLogout={async () => {
          await adminAuth.logout();
        }}
        {...actions}
      />
    );
  }

  if (currentView.type === 'model') {
    const showcaseModel = findModelByRouteSlug(siteContent.models, currentView.modelSlug);

    return (
      <ModelShowcasePage
        model={showcaseModel}
        ctaHref={TELEGRAM_GROUP_URL}
        isLoading={isSiteLoading}
      />
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.3),transparent_55%)] blur-3xl" />

      <main className="relative">
        <HeroSection ctaHref={TELEGRAM_GROUP_URL} backgroundSrc={heroBackgroundSrc} />

        <div className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
          <PreviewCarousel
            id="previas"
            eyebrow="Previas Exclusivas"
            title="Videos selecionados"
            description="A faixa mostra ate 7 videos e segue ate o CTA final."
            items={videoPreviewCards}
            emptyMessage="Nenhum video cadastrado ainda. Adicione videos pelo painel admin para preencher esta faixa."
            ctaHref={TELEGRAM_GROUP_URL}
            ctaLabel="Entrar no Grupo"
          />

          <PreviewCarousel
            eyebrow="Previas Exclusivas"
            title="Imagens selecionadas"
            description="A segunda faixa mostra ate 10 imagens e termina no mesmo fluxo de entrada."
            items={imagePreviewCards}
            emptyMessage="Nenhuma imagem cadastrada ainda. Adicione imagens pelo painel admin para preencher esta faixa."
            ctaHref={TELEGRAM_GROUP_URL}
            ctaLabel="Entrar no Grupo"
            variant="portrait"
          />

          <ModelsStories
            models={siteContent.models}
            onSelect={(model) => setSelectedModelId(model.id)}
            ctaTargetId="cta-final"
          />
          <TelegramProof items={siteContent.groupProofItems} />

          <motion.section
            id="cta-final"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="pt-14"
          >
            <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent p-6 shadow-neon">
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-white/60">
                CTA Final
              </span>
              <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Tudo pronto para converter com foco total no polegar e na urgencia.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                A pagina entrega prova visual, ritmo de scroll e pontos de clique
                estrategicos para transformar curiosidade em entrada no grupo.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {perks.map((perk) => (
                  <span
                    key={perk}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/75"
                  >
                    {perk}
                  </span>
                ))}
              </div>

              <TelegramCTA
                href={TELEGRAM_GROUP_URL}
                label="Entrar no Grupo VIP"
                className="mt-6 w-full sm:w-auto"
              />
            </div>
          </motion.section>
        </div>
      </main>

      <ModelModal
        model={selectedModel}
        onClose={() => setSelectedModelId(null)}
        ctaHref={TELEGRAM_GROUP_URL}
      />
    </div>
  );
}
