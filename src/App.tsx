import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useState } from 'react';
import { AdminLogin } from './components/AdminLogin';
import { AdminPanel } from './components/AdminPanel';
import { HeroSection } from './components/HeroSection';
import { ModelModal } from './components/ModelModal';
import { ModelShowcasePage } from './components/ModelShowcasePage';
import { ModelsStories } from './components/ModelsStories';
import { PreviewCarousel } from './components/PreviewCarousel';
import { SiteFooter } from './components/SiteFooter';
import { StaticInfoPage } from './components/StaticInfoPage';
import { TelegramCTA } from './components/TelegramCTA';
import { TelegramProof } from './components/TelegramProof';
import { getRandomPreviewCardsByType, heroBackdrop } from './data/models';
import { useAdminAuth } from './hooks/useAdminAuth';
import { useSiteContent } from './hooks/useSiteContent';
import {
  findModelByRouteSlug,
  getAboutPath,
  getAdminPath,
  getHomePath,
  getSupportPath,
} from './lib/modelRoute';
import { subscriptionPlans } from './lib/subscriptionPlans';
import {
  getHomeTelegramPayload,
  getModelTelegramPayload,
  getTelegramEntryUrl,
} from './lib/telegramEntry';
import type { PreviewCard } from './types';

const TELEGRAM_GROUP_URL =
  import.meta.env.VITE_TELEGRAM_GROUP_URL || 'https://t.me/seu_grupo_vip';
const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';

const perks = [
  'Privacy',
  'OnlyFans',
  'XvideosRED',
  'CloseFriends',
  'TelegramVIP',
  'Anal',
  'Amador',
  'Em Publico',
  'Novinha +18',
  'Vazados',
  'Corno/HotWife',
  'Camera Escondida',
  'Gozada na Boca',
  'GangBang',
  'Agressivo',
];

type CurrentView =
  | { type: 'site' }
  | { type: 'admin' }
  | { type: 'about' }
  | { type: 'support' }
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

  if (normalizedPathname === getAboutPath()) {
    return { type: 'about' };
  }

  if (normalizedPathname === getSupportPath()) {
    return { type: 'support' };
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
  const buildEntryHref = (payload: string) =>
    TELEGRAM_BOT_USERNAME
      ? getTelegramEntryUrl(TELEGRAM_BOT_USERNAME, payload)
      : TELEGRAM_GROUP_URL;
  const homeEntryHref = buildEntryHref(getHomeTelegramPayload());
  const selectedModelPlanOptions = selectedModel
    ? subscriptionPlans.map((plan) => ({
        ...plan,
        href: buildEntryHref(getModelTelegramPayload(selectedModel, plan.id)),
      }))
    : [];

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
    const showcaseEntryHref = showcaseModel
      ? buildEntryHref(getModelTelegramPayload(showcaseModel))
      : TELEGRAM_GROUP_URL;
    const showcasePlanOptions = showcaseModel
      ? subscriptionPlans.map((plan) => ({
          ...plan,
          href: buildEntryHref(getModelTelegramPayload(showcaseModel, plan.id)),
        }))
      : [];

    return (
      <ModelShowcasePage
        model={showcaseModel}
        ctaHref={showcaseEntryHref}
        planOptions={showcasePlanOptions}
        isLoading={isSiteLoading}
      />
    );
  }

  if (currentView.type === 'about') {
    return (
      <StaticInfoPage
        title="Sobre"
        description="AllPrivacy.net reune em um so lugar o acesso ao bot, as previas do site e a entrada organizada no grupo VIP."
        sections={[
          {
            title: 'Navegacao discreta',
            body: 'A home e as paginas das modelos mostram previas e organizam o caminho ate o bot sem deixar o fluxo confuso ou poluido.',
          },
          {
            title: 'Bot integrado',
            body: 'O bot cuida dos planos, do Pix, da confirmacao do pagamento e da liberacao do acesso no grupo privado.',
          },
          {
            title: 'Tudo em um so lugar',
            body: 'Modelos, categorias, previas e acesso ficam conectados em uma experiencia unica, pensada primeiro para mobile.',
          },
        ]}
      />
    );
  }

  if (currentView.type === 'support') {
    return (
      <StaticInfoPage
        title="Suporte"
        description="Se voce tiver qualquer problema com pagamento, acesso ou liberacao no grupo, use o suporte do bot para continuar o atendimento."
        sections={[
          {
            title: 'Pagamento',
            body: 'Se o Pix ainda estiver pendente, finalize o pagamento dentro do prazo e use a verificacao no proprio bot para atualizar o status.',
          },
          {
            title: 'Meu acesso',
            body: 'Depois da aprovacao, consulte sua assinatura no menu do bot para confirmar validade, liberacao e status atual.',
          },
          {
            title: 'Acesso ao grupo',
            body: 'Se a entrada ainda nao tiver sido liberada, volte ao bot, use a verificacao do pagamento e tente novamente pela opcao Meu acesso.',
          },
        ]}
      />
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.3),transparent_55%)] blur-3xl" />

      <main className="relative">
        <HeroSection ctaHref={homeEntryHref} backgroundSrc={heroBackgroundSrc} />

        <div className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
          <PreviewCarousel
            id="previas"
            eyebrow="AllPrivacy.site"
            title="Videos (Previas)"
            description=""
            items={videoPreviewCards}
            emptyMessage="Nenhum video cadastrado ainda. Adicione videos pelo painel admin para preencher esta faixa."
            ctaHref={homeEntryHref}
            ctaLabel="Entrar no Grupo"
          />

          <PreviewCarousel
            eyebrow="AllPrivacy.site"
            title="Imagens"
            description=""
            items={imagePreviewCards}
            emptyMessage="Nenhuma imagem cadastrada ainda. Adicione imagens pelo painel admin para preencher esta faixa."
            ctaHref={homeEntryHref}
            ctaLabel="Entrar no Grupo"
            variant="portrait"
            sectionClassName="pt-9 sm:pt-8"
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
            className="pt-14 sm:pt-14"
          >
            <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent p-6 shadow-neon">
              <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Entrar no grupo VIP
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                O bot informa tudo sobre o acesso e libera sua entrada em poucos passos.
              </p>

              <div className="mt-5 flex flex-wrap gap-1.5 sm:gap-2">
                {perks.map((perk) => (
                  <span
                    key={perk}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white/75 sm:px-3 sm:py-2 sm:text-xs"
                  >
                    {perk}
                  </span>
                ))}
              </div>

              <div className="mt-6 grid w-full gap-2 sm:inline-grid">
                <TelegramCTA href={homeEntryHref} label="Entrar no Grupo" className="w-full sm:w-auto" />
                <span className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                  Acesso imediato
                </span>
              </div>
            </div>
          </motion.section>
        </div>
      </main>

      <SiteFooter />

      <ModelModal
        model={selectedModel}
        onClose={() => setSelectedModelId(null)}
        planOptions={selectedModelPlanOptions}
      />
    </div>
  );
}
