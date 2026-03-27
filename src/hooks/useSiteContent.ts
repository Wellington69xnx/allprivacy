import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSiteContent } from '../data/models';
import type {
  GroupProofItem,
  HeroBackgroundItem,
  HeroBackgroundTarget,
  MediaType,
  ModelProfile,
  SiteContent,
  TelegramCacheSingleItemResponse,
  TelegramCacheWarmStatus,
  UploadAssetOptions,
  UploadAssetProgress,
  UploadAssetResult,
} from '../types';

const SITE_CONTENT_ENDPOINT = '/api/site-content';
const UPLOAD_ENDPOINT = '/api/upload';
const TELEGRAM_CACHE_WARM_ENDPOINT = '/api/admin/telegram-cache/warm-all';
const TELEGRAM_CACHE_SINGLE_ENDPOINT = '/api/admin/telegram-cache/warm-one';
const SITE_CONTENT_CACHE_KEY = 'allprivacy-site-content-cache-v1';

interface ModelInput {
  id?: string;
  name: string;
  handle: string;
  tagline: string;
  profileImage: string;
  coverImage: string;
  accentFrom?: string;
  accentTo?: string;
}

interface MediaInput {
  modelId: string;
  type: MediaType;
  title: string;
  subtitle: string;
  thumbnail: string;
  src?: string;
}

interface HeroBackgroundInput {
  title: string;
  image: string;
  target: HeroBackgroundTarget;
}

interface GroupProofInput {
  title: string;
  image: string;
}

interface SiteContentResponse {
  siteContent: SiteContent;
}

interface TelegramCacheWarmStatusResponse {
  status: TelegramCacheWarmStatus;
}

type TelegramCacheJobMode = 'check' | 'warm';

function wait(durationMs: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

const accentPairs = [
  ['#ff2056', '#8b5cf6'],
  ['#ef4444', '#7c3aed'],
  ['#f43f5e', '#9333ea'],
  ['#dc2626', '#7e22ce'],
  ['#fb7185', '#6d28d9'],
];

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneDefaultContent(): SiteContent {
  return JSON.parse(JSON.stringify(defaultSiteContent)) as SiteContent;
}

function readCachedSiteContent() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SITE_CONTENT_CACHE_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as SiteContent;
  } catch {
    return null;
  }
}

function writeCachedSiteContent(content: SiteContent) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(SITE_CONTENT_CACHE_KEY, JSON.stringify(content));
  } catch {
    // Falha de cache local nao deve quebrar o fluxo principal.
  }
}

function buildMediaItem(input: MediaInput) {
  const nextThumbnail =
    input.type === 'video'
      ? input.thumbnail.trim() || input.src?.trim() || ''
      : input.thumbnail.trim();

  return {
    id: createId('media'),
    type: input.type,
    title: input.title.trim() || 'Previa',
    subtitle: input.subtitle.trim(),
    thumbnail: nextThumbnail,
    src: input.type === 'video' ? input.src?.trim() || '' : undefined,
  };
}

function getMediaAssetKey(item: {
  type: MediaType;
  thumbnail?: string;
  src?: string;
}) {
  const assetUrl =
    item.type === 'video'
      ? item.src?.trim() || item.thumbnail?.trim() || ''
      : item.thumbnail?.trim() || item.src?.trim() || '';

  return assetUrl ? `${item.type}:${assetUrl}` : '';
}

function appendUniqueMediaItems<T extends { type: MediaType; thumbnail?: string; src?: string }>(
  currentItems: T[],
  nextItems: T[],
) {
  const seenKeys = new Set(
    currentItems
      .map((item) => getMediaAssetKey(item))
      .filter(Boolean),
  );
  const mergedItems = [...currentItems];

  for (const item of nextItems) {
    const assetKey = getMediaAssetKey(item);

    if (assetKey && seenKeys.has(assetKey)) {
      continue;
    }

    if (assetKey) {
      seenKeys.add(assetKey);
    }

    mergedItems.push(item);
  }

  return mergedItems;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const rawMessage = await response.text();
    let nextMessage = rawMessage || 'Falha ao processar a requisicao.';

    try {
      const parsed = JSON.parse(rawMessage) as { message?: string };
      nextMessage = parsed.message || nextMessage;
    } catch {
      // Se nao vier JSON, mantemos o texto bruto retornado pelo servidor.
    }

    throw new Error(nextMessage);
  }

  return (await response.json()) as T;
}

export function useSiteContent() {
  const [siteContent, setSiteContent] = useState<SiteContent>(
    () => readCachedSiteContent() ?? cloneDefaultContent(),
  );
  const [isLoading, setIsLoading] = useState(() => readCachedSiteContent() === null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteContentRef = useRef(siteContent);

  useEffect(() => {
    siteContentRef.current = siteContent;
  }, [siteContent]);

  const loadSiteContent = useCallback(async () => {
    if (
      siteContentRef.current.models.length === 0 &&
      siteContentRef.current.groupProofItems.length === 0 &&
      siteContentRef.current.heroBackgrounds.mobile.length === 0 &&
      siteContentRef.current.heroBackgrounds.desktop.length === 0
    ) {
      setIsLoading(true);
    }

    try {
      const response = await fetch(SITE_CONTENT_ENDPOINT);
      const data = await parseJsonResponse<SiteContentResponse>(response);
      siteContentRef.current = data.siteContent;
      setSiteContent(data.siteContent);
      writeCachedSiteContent(data.siteContent);
      setError(null);
    } catch {
      const cached = readCachedSiteContent();

      if (cached) {
        siteContentRef.current = cached;
        setSiteContent(cached);
        setError(null);
      } else {
        const fallback = cloneDefaultContent();
        siteContentRef.current = fallback;
        setSiteContent(fallback);
        setError('Nao foi possivel carregar o conteudo salvo em disco.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSiteContent();
  }, [loadSiteContent]);

  const persistSiteContent = useCallback(async (nextContent: SiteContent) => {
    setIsSaving(true);

    try {
      const response = await fetch(SITE_CONTENT_ENDPOINT, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify(nextContent),
      });

      const data = await parseJsonResponse<SiteContentResponse>(response);
      siteContentRef.current = data.siteContent;
      setSiteContent(data.siteContent);
      writeCachedSiteContent(data.siteContent);
      setError(null);

      return data.siteContent;
    } catch {
      setError('Nao foi possivel salvar o conteudo no projeto.');
      throw new Error('save_failed');
    } finally {
      setIsSaving(false);
    }
  }, []);

  const updateSiteContent = useCallback(
    async (updater: (current: SiteContent) => SiteContent) => {
      const nextContent = updater(siteContentRef.current);
      return persistSiteContent(nextContent);
    },
    [persistSiteContent],
  );

  const uploadAsset = useCallback(
    (
      file: File,
      options: UploadAssetOptions = {},
      onProgress?: (progress: UploadAssetProgress) => void,
    ) =>
      new Promise<UploadAssetResult>((resolve, reject) => {
        try {
          const formData = new FormData();
          const endpointUrl = new URL(UPLOAD_ENDPOINT, window.location.origin);

          if (options.bucket) {
            endpointUrl.searchParams.set('bucket', options.bucket);
            formData.append('bucket', options.bucket);
          }

          if (options.modelName?.trim()) {
            endpointUrl.searchParams.set('modelName', options.modelName.trim());
            formData.append('modelName', options.modelName.trim());
          }

          if (options.target) {
            endpointUrl.searchParams.set('target', options.target);
            formData.append('target', options.target);
          }

          if (options.mediaType) {
            endpointUrl.searchParams.set('mediaType', options.mediaType);
            formData.append('mediaType', options.mediaType);
          }

          formData.append('file', file);

          const request = new XMLHttpRequest();
          request.open('POST', `${endpointUrl.pathname}${endpointUrl.search}`);
          request.withCredentials = true;

          request.upload.onprogress = (event) => {
            if (!event.lengthComputable) {
              return;
            }

            onProgress?.({
              loaded: event.loaded,
              total: event.total,
              percent: Math.round((event.loaded / event.total) * 100),
            });
          };

          request.onerror = () => {
            setError('Nao foi possivel enviar o arquivo para o projeto.');
            reject(new Error('upload_failed'));
          };

          request.onload = () => {
            if (request.status < 200 || request.status >= 300) {
              setError('Nao foi possivel enviar o arquivo para o projeto.');
              reject(new Error(request.responseText || 'upload_failed'));
              return;
            }

            try {
              const parsed = JSON.parse(request.responseText) as UploadAssetResult;
              setError(null);
              resolve(parsed);
            } catch {
              setError('Nao foi possivel enviar o arquivo para o projeto.');
              reject(new Error('upload_failed'));
            }
          };

          request.send(formData);
        } catch {
          setError('Nao foi possivel enviar o arquivo para o projeto.');
          reject(new Error('upload_failed'));
        }
      }),
    [],
  );

  const addModel = useCallback(
    async (input: ModelInput) => {
      const [accentFrom, accentTo] =
        accentPairs[Math.floor(Math.random() * accentPairs.length)] ?? accentPairs[0];

      const nextModel: ModelProfile = {
        id: createId('model'),
        name: input.name.trim(),
        handle: input.handle.trim(),
        tagline: input.tagline.trim(),
        profileImage: input.profileImage.trim(),
        coverImage: input.coverImage.trim(),
        accentFrom: input.accentFrom?.trim() || accentFrom,
        accentTo: input.accentTo?.trim() || accentTo,
        gallery: [],
      };

      await updateSiteContent((current) => ({
        ...current,
        models: [...current.models, nextModel],
      }));
    },
    [updateSiteContent],
  );

  const updateModel = useCallback(
    async (input: ModelInput) => {
      if (!input.id) {
        throw new Error('missing_model_id');
      }

      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== input.id) {
            return model;
          }

          return {
            ...model,
            name: input.name.trim(),
            handle: input.handle.trim(),
            tagline: input.tagline.trim(),
            profileImage: input.profileImage.trim(),
            coverImage: input.coverImage.trim(),
            accentFrom: input.accentFrom?.trim() || model.accentFrom,
            accentTo: input.accentTo?.trim() || model.accentTo,
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const removeModel = useCallback(
    async (modelId: string) => {
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.filter((model) => model.id !== modelId),
      }));
    },
    [updateSiteContent],
  );

  const addMediaToModel = useCallback(
    async (input: MediaInput) => {
      const nextItem = buildMediaItem(input);
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== input.modelId) {
            return model;
          }

          return {
            ...model,
            gallery: appendUniqueMediaItems(model.gallery, [nextItem]),
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const addMediaBatchToModel = useCallback(
    async (modelId: string, items: MediaInput[]) => {
      if (items.length === 0) {
        return;
      }

      const nextItems = items.map((item) => buildMediaItem({ ...item, modelId }));

      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            gallery: appendUniqueMediaItems(model.gallery, nextItems),
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const removeMediaFromModel = useCallback(
    async (modelId: string, mediaId: string) => {
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            gallery: model.gallery.filter((item) => item.id !== mediaId),
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const addGroupProofItem = useCallback(
    async (input: GroupProofInput) => {
      const nextItem: GroupProofItem = {
        id: createId('group'),
        title: input.title.trim() || 'Print do grupo',
        image: input.image.trim(),
      };

      await updateSiteContent((current) => ({
        ...current,
        groupProofItems: [...current.groupProofItems, nextItem],
      }));
    },
    [updateSiteContent],
  );

  const addHeroBackground = useCallback(
    async (input: HeroBackgroundInput) => {
      const nextItem: HeroBackgroundItem = {
        id: createId('hero'),
        title: input.title.trim(),
        image: input.image.trim(),
        target: input.target,
      };

      await updateSiteContent((current) => ({
        ...current,
        heroBackgrounds: {
          ...current.heroBackgrounds,
          [input.target]: [...current.heroBackgrounds[input.target], nextItem],
        },
      }));
    },
    [updateSiteContent],
  );

  const removeHeroBackground = useCallback(
    async (target: HeroBackgroundTarget, itemId: string) => {
      await updateSiteContent((current) => ({
        ...current,
        heroBackgrounds: {
          ...current.heroBackgrounds,
          [target]: current.heroBackgrounds[target].filter((item) => item.id !== itemId),
        },
      }));
    },
    [updateSiteContent],
  );

  const removeGroupProofItem = useCallback(
    async (itemId: string) => {
      await updateSiteContent((current) => ({
        ...current,
        groupProofItems: current.groupProofItems.filter((item) => item.id !== itemId),
      }));
    },
    [updateSiteContent],
  );

  const clearSiteContent = useCallback(async () => {
    await persistSiteContent(cloneDefaultContent());
  }, [persistSiteContent]);

  const runTelegramMediaCacheJob = useCallback(async (
    mode: TelegramCacheJobMode,
    onStatus?: (status: TelegramCacheWarmStatus) => void,
  ) => {
    const response = await fetch(TELEGRAM_CACHE_WARM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ mode }),
    });
    const data = await parseJsonResponse<TelegramCacheWarmStatusResponse>(response);
    setError(null);
    let currentStatus = data.status;
    onStatus?.(currentStatus);

    while (currentStatus.state === 'running') {
      await wait(700);

      const statusResponse = await fetch(
        `${TELEGRAM_CACHE_WARM_ENDPOINT}?jobId=${encodeURIComponent(currentStatus.jobId)}`,
        {
          credentials: 'same-origin',
        },
      );
      const statusData = await parseJsonResponse<TelegramCacheWarmStatusResponse>(statusResponse);
      currentStatus = statusData.status;
      onStatus?.(currentStatus);
    }

    if (currentStatus.state === 'failed') {
      throw new Error(currentStatus.message || 'Falha ao enviar as midias para cache do Telegram.');
    }

    return currentStatus;
  }, []);

  const warmTelegramMediaCache = useCallback(
    (onStatus?: (status: TelegramCacheWarmStatus) => void) =>
      runTelegramMediaCacheJob('warm', onStatus),
    [runTelegramMediaCacheJob],
  );

  const checkTelegramMediaCache = useCallback(
    (onStatus?: (status: TelegramCacheWarmStatus) => void) =>
      runTelegramMediaCacheJob('check', onStatus),
    [runTelegramMediaCacheJob],
  );

  const warmSingleTelegramMediaCache = useCallback(
    async (assetUrl: string, mediaType: MediaType) => {
      const response = await fetch(TELEGRAM_CACHE_SINGLE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          assetUrl,
          mediaType,
        }),
      });

      return parseJsonResponse<TelegramCacheSingleItemResponse>(response);
    },
    [],
  );

  return {
    siteContent,
    isLoading,
    isSaving,
    error,
    uploadAsset,
    loadSiteContent,
    addModel,
    updateModel,
    removeModel,
    addMediaToModel,
    addMediaBatchToModel,
    removeMediaFromModel,
    addGroupProofItem,
    removeGroupProofItem,
    addHeroBackground,
    removeHeroBackground,
    clearSiteContent,
    warmTelegramMediaCache,
    checkTelegramMediaCache,
    warmSingleTelegramMediaCache,
  };
}
