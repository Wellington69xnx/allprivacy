import { motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AdminLogin } from './components/AdminLogin';
import { AdminCommentsPage } from './components/AdminCommentsPage';
import { AdminPanel } from './components/AdminPanel';
import { FinalGroupCtaCard } from './components/FinalGroupCtaCard';
import { HeroSection } from './components/HeroSection';
import { ModelModal } from './components/ModelModal';
import { ModelShowcasePage } from './components/ModelShowcasePage';
import { ModelVideoPage } from './components/ModelVideoPage';
import { ModelsStories } from './components/ModelsStories';
import { PreviewCarousel } from './components/PreviewCarousel';
import { SiteFooter } from './components/SiteFooter';
import { StaticInfoModal } from './components/StaticInfoModal';
import { StaticInfoPage } from './components/StaticInfoPage';
import { TelegramProof } from './components/TelegramProof';
import { getRandomPreviewCardsByType, heroBackdrop } from './data/models';
import { useAdminAuth } from './hooks/useAdminAuth';
import { useSiteContent } from './hooks/useSiteContent';
import {
  findModelByVideoRoute,
  findModelByRouteSlug,
  getAboutPath,
  getAdminCommentsPath,
  getAdminPath,
  getHomePath,
  getSupportPath,
} from './lib/modelRoute';
import { STATIC_INFO_CONTENT, type StaticInfoKey } from './lib/staticInfo';
import {
  getHomeTelegramPayload,
  getModelTelegramPayload,
  getTelegramEntryUrl,
} from './lib/telegramEntry';
import type { PreviewCard } from './types';

const TELEGRAM_GROUP_URL =
  import.meta.env.VITE_TELEGRAM_GROUP_URL || 'https://t.me/seu_grupo_vip';
const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';
const XV_DOWNLOAD_BOT_URL = 'https://t.me/xv_download_bot';

type CurrentView =
  | { type: 'site' }
  | { type: 'admin' }
  | { type: 'admin-comments' }
  | { type: 'about' }
  | { type: 'support' }
  | { type: 'model'; modelSlug: string }
  | { type: 'model-video'; modelSlug: string; routeToken: string };

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

function pickRandomHeroBackground(
  pool: string[],
  recentBackgrounds: string[] = [],
  currentBackground?: string | null,
) {
  if (pool.length === 0) {
    return heroBackdrop;
  }

  if (pool.length === 1) {
    return pool[0] || heroBackdrop;
  }

  const maxRecentEntries = Math.max(0, Math.min(5, pool.length - 1));
  const recentSet = new Set(recentBackgrounds.slice(-maxRecentEntries));
  const nonRecentPool = pool.filter((item) => !recentSet.has(item));
  const filteredPool = (nonRecentPool.length > 0 ? nonRecentPool : pool).filter(
    (item) => item !== currentBackground,
  );
  const nextPool = filteredPool.length > 0 ? filteredPool : nonRecentPool.length > 0 ? nonRecentPool : pool;
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

  if (normalizedPathname === getAdminCommentsPath()) {
    return { type: 'admin-comments' };
  }

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

  const pathSegments = normalizedPathname.split('/').filter(Boolean);

  if (pathSegments.length === 2) {
    return {
      type: 'model-video',
      modelSlug: decodeURIComponent(pathSegments[0] || ''),
      routeToken: decodeURIComponent(pathSegments[1] || ''),
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
  const [selectedStaticInfo, setSelectedStaticInfo] = useState<StaticInfoKey | null>(null);
  const [heroBackgroundPool, setHeroBackgroundPool] = useState<string[]>([]);
  const [heroBackgroundSrc, setHeroBackgroundSrc] = useState<string | null>(null);
  const [isHomeHeroReady, setIsHomeHeroReady] = useState(false);
  const heroBackgroundCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const heroBackgroundHistoryRef = useRef<string[]>([]);
  const { siteContent, isLoading: isSiteLoading, ...actions } = useSiteContent();
  const adminAuth = useAdminAuth();
  const visibleHomeModels = useMemo(
    () => siteContent.models.filter((model) => !model.hiddenOnHome),
    [siteContent.models],
  );
  const videoPreviewCards = useMemo(
    () => getRandomPreviewCardsByType(visibleHomeModels, 'video', 12),
    [visibleHomeModels],
  );
  const imagePreviewCards = useMemo(
    () => getRandomPreviewCardsByType(visibleHomeModels, 'image', 10),
    [visibleHomeModels],
  );
  const xvideosBotPreviewCards = useMemo<PreviewCard[]>(
    () => [
      {
        id: 'xv-bot-1',
        ownerId: 'xvideosred-bot',
        owner: 'XVideosRED BOT',
        ownerHandle: '@xv_download_bot',
        ownerProfileImage: '/uploads/_legacy-root/xv-profile.png',
        ownerCoverImage: '/uploads/_legacy-root/xv.png',
        title: 'XVideosRED Bot 1',
        type: 'image',
        thumbnail: '/uploads/_legacy-root/xv1.PNG',
        accentFrom: '#991b1b',
        accentTo: '#7c3aed',
      },
      {
        id: 'xv-bot-2',
        ownerId: 'xvideosred-bot',
        owner: 'XVideosRED BOT',
        ownerHandle: '@xv_download_bot',
        ownerProfileImage: '/uploads/_legacy-root/xv-profile.png',
        ownerCoverImage: '/uploads/_legacy-root/xv.png',
        title: 'XVideosRED Bot 2',
        type: 'image',
        thumbnail: '/uploads/_legacy-root/xv2.PNG',
        accentFrom: '#991b1b',
        accentTo: '#7c3aed',
      },
      {
        id: 'xv-bot-3',
        ownerId: 'xvideosred-bot',
        owner: 'XVideosRED BOT',
        ownerHandle: '@xv_download_bot',
        ownerProfileImage: '/uploads/_legacy-root/xv-profile.png',
        ownerCoverImage: '/uploads/_legacy-root/xv.png',
        title: 'XVideosRED Bot 3',
        type: 'image',
        thumbnail: '/uploads/_legacy-root/xv3.PNG',
        accentFrom: '#991b1b',
        accentTo: '#7c3aed',
      },
      {
        id: 'xv-bot-video',
        ownerId: 'xvideosred-bot',
        owner: 'XVideosRED BOT',
        ownerHandle: '@xv_download_bot',
        ownerProfileImage: '/uploads/_legacy-root/xv-profile.png',
        ownerCoverImage: '/uploads/_legacy-root/xv.png',
        title: 'XVideosRED Bot Vídeo',
        type: 'video',
        thumbnail: '/uploads/_legacy-root/xv3.PNG',
        src: '/uploads/_legacy-root/xv.MP4',
        disableAutoplay: true,
        accentFrom: '#991b1b',
        accentTo: '#7c3aed',
      },
    ],
    [],
  );

  useLayoutEffect(() => {
    if (
      typeof window === 'undefined' ||
      currentView.type === 'admin' ||
      currentView.type === 'admin-comments'
    ) {
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

      if (hash === '#/admin/comentarios') {
        window.history.replaceState(null, '', getAdminCommentsPath());
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
    if (typeof window === 'undefined') {
      return;
    }

    const onOpenStaticInfo = (event: Event) => {
      const customEvent = event as CustomEvent<{ type?: StaticInfoKey }>;
      const nextType = customEvent.detail?.type;

      if (nextType === 'about' || nextType === 'support') {
        setSelectedStaticInfo(nextType);
      }
    };

    window.addEventListener('allprivacy:open-static-info', onOpenStaticInfo as EventListener);

    return () => {
      window.removeEventListener(
        'allprivacy:open-static-info',
        onOpenStaticInfo as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (currentView.type === 'site' && !isSiteLoading) {
      setIsHomeHeroReady(false);
      return;
    }

    if (currentView.type !== 'site') {
      setIsHomeHeroReady(false);
    }
  }, [currentView.type, isSiteLoading]);

  useEffect(() => {
    if (typeof window === 'undefined' || currentView.type !== 'site') {
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

        return pickRandomHeroBackground(nextPool, heroBackgroundHistoryRef.current, current);
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
  }, [
    currentView.type,
    isSiteLoading,
    siteContent.heroBackgrounds.desktop,
    siteContent.heroBackgrounds.mobile,
  ]);

  useEffect(() => {
    if (!heroBackgroundSrc) {
      return;
    }

    heroBackgroundHistoryRef.current = [
      ...heroBackgroundHistoryRef.current.filter((item) => item !== heroBackgroundSrc),
      heroBackgroundSrc,
    ].slice(-5);
  }, [heroBackgroundSrc]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      currentView.type !== 'site' ||
      !heroBackgroundSrc ||
      heroBackgroundPool.length <= 1
    ) {
      return;
    }

    let cancelled = false;
    const nextBackground = pickRandomHeroBackground(
      heroBackgroundPool,
      heroBackgroundHistoryRef.current,
      heroBackgroundSrc,
    );
    const cachedImage = heroBackgroundCacheRef.current.get(nextBackground);

    const ensureCachedImage = () => {
      if (cachedImage) {
        return cachedImage;
      }

      const image = new Image();
      image.decoding = 'async';
      image.src = nextBackground;
      heroBackgroundCacheRef.current.set(nextBackground, image);
      return image;
    };

    const applyBackground = () => {
      if (!cancelled) {
        setHeroBackgroundSrc(nextBackground);
      }
    };

    const image = ensureCachedImage();
    const timeoutId = window.setTimeout(() => {

      if (image.complete) {
        applyBackground();
        return;
      }

      image.onload = applyBackground;
      image.onerror = applyBackground;
    }, 7000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentView.type, heroBackgroundPool, heroBackgroundSrc]);

  const selectedModel =
    siteContent.models.find((model) => model.id === selectedModelId) ?? null;
  const handlePreviewOwnerSelect = (card: PreviewCard) => {
    const nextModelId =
      visibleHomeModels.find((model) => model.id === card.ownerId)?.id ?? null;

    setSelectedModelId(nextModelId);
  };
  const buildEntryHref = (payload: string) =>
    TELEGRAM_BOT_USERNAME
      ? getTelegramEntryUrl(TELEGRAM_BOT_USERNAME, payload)
      : TELEGRAM_GROUP_URL;
  const homeEntryHref = buildEntryHref(getHomeTelegramPayload());
  const selectedModelEntryHref = selectedModel
    ? buildEntryHref(getModelTelegramPayload(selectedModel))
    : TELEGRAM_GROUP_URL;

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

  if (currentView.type === 'admin-comments') {
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
      <AdminCommentsPage
        siteContent={siteContent}
        isLoading={isSiteLoading}
        onLogout={async () => {
          await adminAuth.logout();
        }}
        removeModelFullContentComment={actions.removeModelFullContentComment}
      />
    );
  }

  if (currentView.type === 'model') {
    const showcaseModel = findModelByRouteSlug(siteContent.models, currentView.modelSlug);
    const showcaseEntryHref = showcaseModel
      ? buildEntryHref(getModelTelegramPayload(showcaseModel))
      : TELEGRAM_GROUP_URL;

    return (
      <>
        <ModelShowcasePage
          model={showcaseModel}
          ctaHref={showcaseEntryHref}
          groupProofItems={siteContent.groupProofItems}
          isLoading={isSiteLoading}
        />
        <StaticInfoModal
          content={selectedStaticInfo ? STATIC_INFO_CONTENT[selectedStaticInfo] : null}
          onClose={() => setSelectedStaticInfo(null)}
        />
      </>
    );
  }

  if (currentView.type === 'model-video') {
    const showcaseVideoEntry = findModelByVideoRoute(
      siteContent.models,
      currentView.modelSlug,
      currentView.routeToken,
    );
    const showcaseModel = showcaseVideoEntry?.model ?? null;
    const showcaseContent = showcaseVideoEntry?.content ?? null;
    const showcaseEntryHref = showcaseModel
      ? buildEntryHref(getModelTelegramPayload(showcaseModel))
      : TELEGRAM_GROUP_URL;

    return (
      <>
        <ModelVideoPage
          model={showcaseModel}
          content={showcaseContent}
          ctaHref={showcaseEntryHref}
          isLoading={isSiteLoading}
        />
        <StaticInfoModal
          content={selectedStaticInfo ? STATIC_INFO_CONTENT[selectedStaticInfo] : null}
          onClose={() => setSelectedStaticInfo(null)}
        />
      </>
    );
  }

  if (currentView.type === 'about') {
    return (
      <>
        <StaticInfoPage {...STATIC_INFO_CONTENT.about} />
        <StaticInfoModal
          content={selectedStaticInfo ? STATIC_INFO_CONTENT[selectedStaticInfo] : null}
          onClose={() => setSelectedStaticInfo(null)}
        />
      </>
    );
  }

  if (currentView.type === 'support') {
    return (
      <>
        <StaticInfoPage {...STATIC_INFO_CONTENT.support} />
        <StaticInfoModal
          content={selectedStaticInfo ? STATIC_INFO_CONTENT[selectedStaticInfo] : null}
          onClose={() => setSelectedStaticInfo(null)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.3),transparent_55%)] blur-3xl" />
      {currentView.type === 'site' && !isHomeHeroReady ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#050507]">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/35 px-5 py-3 text-sm text-zinc-300 backdrop-blur-md">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
            <span>Carregando...</span>
          </div>
        </div>
      ) : null}

      <main className="relative">
        <HeroSection
          ctaHref={homeEntryHref}
          backgroundSrc={heroBackgroundSrc}
          onBackgroundReady={(src) => {
            if (!src || isHomeHeroReady) {
              return;
            }

            setIsHomeHeroReady(true);
          }}
        />

        <div className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
          <PreviewCarousel
            id="previas"
            eyebrow="AllPrivacy.site"
            title={'Vídeos (Prévias)'}
            description=""
            items={videoPreviewCards}
            emptyMessage={
              'Nenhum vídeo cadastrado ainda. Adicione vídeos pelo painel admin para preencher esta faixa.'
            }
            ctaHref={homeEntryHref}
            ctaLabel="Entrar no Grupo"
            onOwnerClick={handlePreviewOwnerSelect}
            initialScrollIndex={1}
            desktopInitialScrollIndex={0}
            scrollAlign="center"
            desktopScrollAlign="start"
            preloadAdjacentVideoCards={1}
          />

          <PreviewCarousel
            eyebrow="AllPrivacy.site"
            title="Imagens"
            description=""
            items={imagePreviewCards}
            emptyMessage="Nenhuma imagem cadastrada ainda. Adicione imagens pelo painel admin para preencher esta faixa."
            ctaHref={homeEntryHref}
            ctaLabel="Entrar no Grupo"
            onOwnerClick={handlePreviewOwnerSelect}
            variant="portrait"
            initialScrollIndex={1}
            desktopInitialScrollIndex={0}
            scrollAlign="center"
            desktopScrollAlign="start"
            sectionClassName="pt-11 sm:pt-10"
          />

          <TelegramProof items={siteContent.groupProofItems} />
          <PreviewCarousel
            eyebrow="AllPrivacy.site"
            title="XVideosRED BOT"
            description="Baixe vídeos do Xvideos Red usando nosso bot. Membros do nosso Grupo VIP recebem 5 créditos diários, e novos usuários começam com 2 créditos. Você também pode ganhar créditos indicando amigos."
            items={xvideosBotPreviewCards}
            emptyMessage="Nenhum card do XVideosRED BOT disponível no momento."
            ctaHref={XV_DOWNLOAD_BOT_URL}
            ctaLabel="Acessar Bot"
            ctaTitle="XVideosRED BOT"
            ctaDescription="Abra o bot de download para usar seus créditos, baixar vídeos do Xvideos Red e acompanhar as vantagens disponíveis para membros do Grupo VIP."
            ctaScrollTargetId={undefined}
            variant="portrait"
            initialScrollIndex={1}
            desktopInitialScrollIndex={0}
            scrollAlign="center"
            desktopScrollAlign="start"
            sectionClassName="pt-11 sm:pt-10"
            showOwnerBadge={false}
            showCtaCard={false}
          />
          <ModelsStories
            models={visibleHomeModels}
            onSelect={(model) => setSelectedModelId(model.id)}
            ctaTargetId="cta-final"
          />


          <motion.section
            id="cta-final"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="pt-16 sm:pt-16"
          >
            <FinalGroupCtaCard ctaHref={homeEntryHref} />
          </motion.section>
        </div>
      </main>

      <SiteFooter />

      <ModelModal
        model={selectedModel}
        models={siteContent.models}
        onClose={() => setSelectedModelId(null)}
        ctaHref={selectedModelEntryHref}
      />
      <StaticInfoModal
        content={selectedStaticInfo ? STATIC_INFO_CONTENT[selectedStaticInfo] : null}
        onClose={() => setSelectedStaticInfo(null)}
      />
    </div>
  );
}
