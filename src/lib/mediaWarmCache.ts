const WARM_VIDEO_STORAGE_KEY = 'allprivacy:warm-videos';
const MAX_WARM_VIDEOS = 18;

const warmedVideoSrcs = new Set<string>();
const warmedVideoOrder: string[] = [];
const videoPreloaders = new Map<string, HTMLVideoElement>();
let hasHydrated = false;

function normalizeSrc(src?: string | null) {
  return typeof src === 'string' ? src.trim() : '';
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function persistWarmVideos() {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      WARM_VIDEO_STORAGE_KEY,
      JSON.stringify(warmedVideoOrder),
    );
  } catch {}
}

function releaseVideoPreloader(src: string) {
  const preloader = videoPreloaders.get(src);

  if (!preloader) {
    return;
  }

  preloader.pause();
  preloader.removeAttribute('src');
  preloader.load();
  videoPreloaders.delete(src);
}

function trimWarmVideoCache() {
  while (warmedVideoOrder.length > MAX_WARM_VIDEOS) {
    const oldestSrc = warmedVideoOrder.shift();

    if (!oldestSrc) {
      continue;
    }

    warmedVideoSrcs.delete(oldestSrc);
    releaseVideoPreloader(oldestSrc);
  }
}

function registerWarmVideo(src: string) {
  if (warmedVideoSrcs.has(src)) {
    const existingIndex = warmedVideoOrder.indexOf(src);

    if (existingIndex >= 0) {
      warmedVideoOrder.splice(existingIndex, 1);
      warmedVideoOrder.push(src);
      persistWarmVideos();
    }

    return;
  }

  warmedVideoSrcs.add(src);
  warmedVideoOrder.push(src);
  trimWarmVideoCache();
  persistWarmVideos();
}

function hydrateWarmVideos() {
  if (hasHydrated || !canUseSessionStorage()) {
    return;
  }

  hasHydrated = true;

  try {
    const rawValue = window.sessionStorage.getItem(WARM_VIDEO_STORAGE_KEY);

    if (!rawValue) {
      return;
    }

    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return;
    }

    parsed
      .map((value) => normalizeSrc(typeof value === 'string' ? value : ''))
      .filter(Boolean)
      .forEach((src) => registerWarmVideo(src));
  } catch {}
}

export function hasWarmVideo(src?: string | null) {
  hydrateWarmVideos();
  return warmedVideoSrcs.has(normalizeSrc(src));
}

export function primeWarmVideo(src?: string | null) {
  const normalizedSrc = normalizeSrc(src);

  if (!normalizedSrc || typeof document === 'undefined') {
    return;
  }

  if (videoPreloaders.has(normalizedSrc)) {
    return;
  }

  const preloader = document.createElement('video');
  preloader.preload = 'auto';
  preloader.muted = true;
  preloader.playsInline = true;
  preloader.src = normalizedSrc;
  preloader.load();
  videoPreloaders.set(normalizedSrc, preloader);
}

export function rememberWarmVideo(src?: string | null) {
  const normalizedSrc = normalizeSrc(src);

  if (!normalizedSrc) {
    return;
  }

  hydrateWarmVideos();
  registerWarmVideo(normalizedSrc);
  primeWarmVideo(normalizedSrc);
}

export function primeKnownWarmVideos(srcs: Array<string | undefined | null>) {
  srcs.forEach((src) => {
    if (hasWarmVideo(src)) {
      primeWarmVideo(src);
    }
  });
}
