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
const DELETE_ASSETS_ENDPOINT = '/api/admin/assets/delete';
const TRIM_EXISTING_VIDEO_ENDPOINT = '/api/admin/video/trim-existing';
const TELEGRAM_CACHE_WARM_ENDPOINT = '/api/admin/telegram-cache/warm-all';
const TELEGRAM_CACHE_SINGLE_ENDPOINT = '/api/admin/telegram-cache/warm-one';
const SITE_CONTENT_CACHE_KEY = 'allprivacy-site-content-cache-v2';
const LEGACY_SITE_CONTENT_CACHE_KEYS = [
  'allprivacy-site-content-cache-v1',
  SITE_CONTENT_CACHE_KEY,
];

interface ModelInput {
  id?: string;
  name: string;
  handle: string;
  tagline: string;
  profileImage: string;
  coverImage: string;
  hiddenOnHome?: boolean;
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
  favorite?: boolean;
}

interface FullContentVideoInput {
  modelId: string;
  videoUrl: string;
  routeToken?: string;
  title?: string;
}

interface FullContentCommentRemoveInput {
  modelId: string;
  contentId: string;
  commentId: string;
}

interface MoveModelContentInput {
  sourceModelId: string;
  targetModelId: string;
  moveGallery: boolean;
  moveFullContent: boolean;
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

function createRouteToken() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toLowerCase();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 12);
}

function cloneDefaultContent(): SiteContent {
  return JSON.parse(JSON.stringify(defaultSiteContent)) as SiteContent;
}

function collectModelAssetUrls(model: ModelProfile) {
  const assetUrls = new Set<string>();
  const pushUrl = (value?: string) => {
    const nextValue = String(value || '').trim();

    if (!nextValue) {
      return;
    }

    assetUrls.add(nextValue);
  };

  pushUrl(model.profileImage);
  pushUrl(model.coverImage);

  for (const item of model.gallery) {
    pushUrl(item.thumbnail);
    pushUrl(item.src);
  }

  for (const item of model.fullContentVideos || []) {
    pushUrl(item.videoUrl);
  }

  return Array.from(assetUrls);
}

function collectSiteContentAssetUrls(siteContent: SiteContent) {
  const assetUrls = new Set<string>();
  const pushUrl = (value?: string) => {
    const nextValue = String(value || '').trim();

    if (!nextValue) {
      return;
    }

    assetUrls.add(nextValue);
  };

  for (const model of siteContent.models) {
    for (const assetUrl of collectModelAssetUrls(model)) {
      pushUrl(assetUrl);
    }
  }

  for (const item of siteContent.groupProofItems) {
    pushUrl(item.image);
  }

  for (const item of siteContent.heroBackgrounds.mobile) {
    pushUrl(item.image);
  }

  for (const item of siteContent.heroBackgrounds.desktop) {
    pushUrl(item.image);
  }

  return Array.from(assetUrls);
}

function readCachedSiteContent() {
  if (typeof window === 'undefined') {
    return null;
  }

  for (const cacheKey of LEGACY_SITE_CONTENT_CACHE_KEYS) {
    try {
      window.localStorage.removeItem(cacheKey);
    } catch {
      // O conteudo do site precisa vir da API para nao prender modelo antigo no navegador.
    }
  }

  return null;
}

function writeCachedSiteContent(content: SiteContent) {
  void content;

  if (typeof window === 'undefined') {
    return;
  }

  for (const cacheKey of LEGACY_SITE_CONTENT_CACHE_KEYS) {
    try {
      window.localStorage.removeItem(cacheKey);
    } catch {
      // Falha ao limpar cache local nao deve quebrar o fluxo principal.
    }
  }
}

function buildUncachedSiteContentEndpoint() {
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${SITE_CONTENT_ENDPOINT}?_=${encodeURIComponent(version)}`;
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
    favorite: Boolean(input.favorite),
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
  let nextMessage = rawMessage || 'Falha ao processar a requisição.';

    try {
      const parsed = JSON.parse(rawMessage) as { message?: string };
      nextMessage = parsed.message || nextMessage;
    } catch (error) {
      // Se nao vier JSON, mantemos o texto bruto retornado pelo servidor.
    }

    throw new Error(nextMessage);
  }

  return (await response.json()) as T;
}

function parseXhrErrorMessage(
  request: XMLHttpRequest,
  fallbackMessage: string,
) {
  if (request.status === 401) {
    return 'Sua sessão do admin expirou. Entre novamente e tente de novo.';
  }

  if (request.status === 413) {
    return 'O arquivo ficou acima do limite aceito pelo servidor da VPS.';
  }

  const rawMessage = String(request.responseText || '').trim();

  if (!rawMessage) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(rawMessage) as { message?: string };
    if (parsed?.message) {
      return parsed.message;
    }
  } catch {
    const withoutTags = rawMessage.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (withoutTags) {
      return withoutTags;
    }
  }

  return rawMessage;
}

export function useSiteContent() {
  const [siteContent, setSiteContent] = useState<SiteContent>(
    () => cloneDefaultContent(),
  );
  const [isLoading, setIsLoading] = useState(true);
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
      const response = await fetch(buildUncachedSiteContentEndpoint(), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
      const data = await parseJsonResponse<SiteContentResponse>(response);
      siteContentRef.current = data.siteContent;
      setSiteContent(data.siteContent);
      writeCachedSiteContent(data.siteContent);
      setError(null);
    } catch (error) {
      const cached = readCachedSiteContent();

      if (cached) {
        siteContentRef.current = cached;
        setSiteContent(cached);
        setError(null);
      } else {
        const fallback = cloneDefaultContent();
        siteContentRef.current = fallback;
        setSiteContent(fallback);
        setError('Não foi possível carregar o conteúdo salvo em disco.');
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
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
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
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Nao foi possivel salvar o conteudo no projeto.';
      setError(message);
      throw new Error(message);
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

          if (Number.isFinite(options.trimStartSeconds)) {
            const trimStart = String(Math.max(0, Number(options.trimStartSeconds) || 0));
            endpointUrl.searchParams.set('trimStartSeconds', trimStart);
            formData.append('trimStartSeconds', trimStart);
          }

          if (Number.isFinite(options.trimEndSeconds)) {
            const trimEnd = String(Math.max(0, Number(options.trimEndSeconds) || 0));
            endpointUrl.searchParams.set('trimEndSeconds', trimEnd);
            formData.append('trimEndSeconds', trimEnd);
          }

          formData.append('file', file);

          const request = new XMLHttpRequest();
          request.open('POST', `${endpointUrl.pathname}${endpointUrl.search}`);
          request.withCredentials = true;
          request.timeout = 10 * 60 * 1000;

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
            const message =
              'Não foi possível enviar o arquivo para o servidor. Confira a conexão e tente novamente.';
            setError(message);
            reject(new Error(message));
          };

          request.ontimeout = () => {
            const message =
              'O envio demorou demais para responder. Tente um arquivo menor ou aguarde o servidor terminar o processamento.';
            setError(message);
            reject(new Error(message));
          };

          request.onload = () => {
            if (request.status < 200 || request.status >= 300) {
              const message = parseXhrErrorMessage(
                request,
                'Não foi possível enviar o arquivo para o projeto.',
              );
              setError(message);
              reject(new Error(message));
              return;
            }

            try {
              const parsed = JSON.parse(request.responseText) as UploadAssetResult;
              setError(null);
              resolve(parsed);
            } catch {
              const message = 'O servidor respondeu ao upload, mas em um formato inválido.';
              setError(message);
              reject(new Error(message));
            }
          };

          request.send(formData);
        } catch {
          const message = 'Não foi possível preparar o envio do arquivo.';
          setError(message);
          reject(new Error(message));
        }
      }),
    [],
  );

  const removeUploadedAssets = useCallback(async (assetUrls: string[]) => {
    const uniqueAssetUrls = Array.from(
      new Set(
        assetUrls
          .map((assetUrl) => String(assetUrl || '').trim())
          .filter(Boolean),
      ),
    );

    if (uniqueAssetUrls.length === 0) {
      return;
    }

    const response = await fetch(DELETE_ASSETS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        assetUrls: uniqueAssetUrls,
      }),
    });

    await parseJsonResponse<{ ok: boolean }>(response);
  }, []);

  const trimExistingVideo = useCallback(
    async (assetUrl: string, startSeconds: number, endSeconds: number) => {
      const response = await fetch(TRIM_EXISTING_VIDEO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          assetUrl,
          trimStartSeconds: startSeconds,
          trimEndSeconds: endSeconds,
        }),
      });

      return parseJsonResponse<{ ok: boolean; assetUrl: string; thumbnailUrl?: string }>(response);
    },
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
        hiddenOnHome: Boolean(input.hiddenOnHome),
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
            hiddenOnHome: Boolean(input.hiddenOnHome ?? model.hiddenOnHome),
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

  const toggleModelHomeVisibility = useCallback(
    async (modelId: string) => {
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            hiddenOnHome: !Boolean(model.hiddenOnHome),
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const removeModel = useCallback(
    async (modelId: string, options?: { deleteAssetFiles?: boolean }) => {
      const targetModel = siteContent.models.find((model) => model.id === modelId);

      if (!targetModel) {
        return;
      }

      if (options?.deleteAssetFiles) {
        await removeUploadedAssets(collectModelAssetUrls(targetModel));
      }

      await updateSiteContent((current) => ({
        ...current,
        models: current.models.filter((model) => model.id !== modelId),
      }));
    },
    [removeUploadedAssets, siteContent.models, updateSiteContent],
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
    async (modelId: string, mediaId: string, options?: { deleteAssetFiles?: boolean }) => {
      const targetModel = siteContent.models.find((model) => model.id === modelId);
      const targetItem = targetModel?.gallery.find((item) => item.id === mediaId);

      if (!targetItem) {
        return;
      }

      if (options?.deleteAssetFiles) {
        await removeUploadedAssets([targetItem.thumbnail, targetItem.src || '']);
      }

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
    [removeUploadedAssets, siteContent.models, updateSiteContent],
  );

  const toggleModelMediaFavorite = useCallback(
    async (modelId: string, mediaId: string) => {
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            gallery: model.gallery.map((item) =>
              item.id === mediaId
                ? {
                    ...item,
                    favorite: !Boolean(item.favorite),
                  }
                : item,
            ),
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const addModelFullContentVideo = useCallback(
    async (input: FullContentVideoInput) => {
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== input.modelId) {
            return model;
          }

          const nextVideoUrl = input.videoUrl.trim();

          if (!nextVideoUrl) {
            return model;
          }

          const nextIndex = (model.fullContentVideos?.length || 0) + 1;

          return {
            ...model,
            fullContentVideos: [
              ...(model.fullContentVideos || []),
              {
                id: createId('full-content'),
                title: input.title?.trim() || `Conteudo completo ${nextIndex}`,
                routeToken: input.routeToken?.trim() || createRouteToken(),
                videoUrl: nextVideoUrl,
                views: 0,
              },
            ],
          };
        }),
      }));
    },
    [updateSiteContent],
  );

  const removeModelFullContentVideo = useCallback(
    async (modelId: string, contentId: string, options?: { deleteAssetFiles?: boolean }) => {
      const targetModel = siteContent.models.find((model) => model.id === modelId);
      const targetItem = (targetModel?.fullContentVideos || []).find((item) => item.id === contentId);

      if (!targetItem) {
        return;
      }

      if (options?.deleteAssetFiles) {
        await removeUploadedAssets([targetItem.videoUrl]);
      }

      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            fullContentVideos: (model.fullContentVideos || []).filter(
              (item) => item.id !== contentId,
            ),
          };
        }),
      }));
    },
    [removeUploadedAssets, siteContent.models, updateSiteContent],
  );

  const moveModelContent = useCallback(
    async ({
      sourceModelId,
      targetModelId,
      moveGallery,
      moveFullContent,
    }: MoveModelContentInput) => {
      if (!sourceModelId || !targetModelId || sourceModelId === targetModelId) {
        throw new Error('Selecione modelos diferentes para mover o conteudo.');
      }

      if (!moveGallery && !moveFullContent) {
        throw new Error('Escolha pelo menos um tipo de conteudo para mover.');
      }

      await updateSiteContent((current) => {
        const sourceModel = current.models.find((model) => model.id === sourceModelId);
        const targetModel = current.models.find((model) => model.id === targetModelId);

        if (!sourceModel || !targetModel) {
          throw new Error('Modelo de origem ou destino nao encontrada.');
        }

        const galleryToMove = moveGallery ? sourceModel.gallery : [];
        const fullContentToMove = moveFullContent ? sourceModel.fullContentVideos || [] : [];

        if (galleryToMove.length === 0 && fullContentToMove.length === 0) {
          throw new Error('A modelo de origem nao tem conteudo desse tipo para mover.');
        }

        return {
          ...current,
          models: current.models.map((model) => {
            if (model.id === sourceModelId) {
              return {
                ...model,
                gallery: moveGallery ? [] : model.gallery,
                fullContentVideos: moveFullContent ? [] : model.fullContentVideos || [],
              };
            }

            if (model.id === targetModelId) {
              return {
                ...model,
                gallery: moveGallery ? [...model.gallery, ...galleryToMove] : model.gallery,
                fullContentVideos: moveFullContent
                  ? [...(model.fullContentVideos || []), ...fullContentToMove]
                  : model.fullContentVideos || [],
              };
            }

            return model;
          }),
        };
      });
    },
    [updateSiteContent],
  );

  const removeModelFullContentComment = useCallback(
    async ({ modelId, contentId, commentId }: FullContentCommentRemoveInput) => {
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            fullContentVideos: (model.fullContentVideos || []).map((item) => {
              if (item.id !== contentId) {
                return item;
              }

              return {
                ...item,
                comments: (item.comments || []).filter((comment) => comment.id !== commentId),
              };
            }),
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
    async (target: HeroBackgroundTarget, itemId: string, options?: { deleteAssetFiles?: boolean }) => {
      const targetItem = siteContent.heroBackgrounds[target].find((item) => item.id === itemId);

      if (!targetItem) {
        return;
      }

      if (options?.deleteAssetFiles) {
        await removeUploadedAssets([targetItem.image]);
      }

      await updateSiteContent((current) => ({
        ...current,
        heroBackgrounds: {
          ...current.heroBackgrounds,
          [target]: current.heroBackgrounds[target].filter((item) => item.id !== itemId),
        },
      }));
    },
    [removeUploadedAssets, siteContent.heroBackgrounds, updateSiteContent],
  );

  const removeGroupProofItem = useCallback(
    async (itemId: string, options?: { deleteAssetFiles?: boolean }) => {
      const targetItem = siteContent.groupProofItems.find((item) => item.id === itemId);

      if (!targetItem) {
        return;
      }

      if (options?.deleteAssetFiles) {
        await removeUploadedAssets([targetItem.image]);
      }

      await updateSiteContent((current) => ({
        ...current,
        groupProofItems: current.groupProofItems.filter((item) => item.id !== itemId),
      }));
    },
    [removeUploadedAssets, siteContent.groupProofItems, updateSiteContent],
  );

  const clearSiteContent = useCallback(async (options?: { deleteAssetFiles?: boolean }) => {
    if (options?.deleteAssetFiles) {
      await removeUploadedAssets(collectSiteContentAssetUrls(siteContent));
    }

    await persistSiteContent(cloneDefaultContent());
  }, [persistSiteContent, removeUploadedAssets, siteContent]);

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
      throw new Error(
        currentStatus.message || 'Falha ao enviar as mídias para cache do Telegram.',
      );
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
    removeUploadedAssets,
    trimExistingVideo,
    loadSiteContent,
    addModel,
    updateModel,
    removeModel,
    toggleModelHomeVisibility,
    addMediaToModel,
    addMediaBatchToModel,
    removeMediaFromModel,
    toggleModelMediaFavorite,
    addModelFullContentVideo,
    removeModelFullContentVideo,
    moveModelContent,
    removeModelFullContentComment,
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

