import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSiteContent } from '../data/models';
import type {
  GroupProofItem,
  HeroBackgroundItem,
  HeroBackgroundTarget,
  MediaType,
  ModelProfile,
  SiteContent,
  UploadAssetOptions,
  UploadAssetProgress,
  UploadAssetResult,
} from '../types';

const SITE_CONTENT_ENDPOINT = '/api/site-content';
const UPLOAD_ENDPOINT = '/api/upload';
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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Falha ao processar a requisicao.');
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
      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== input.modelId) {
            return model;
          }

          return {
            ...model,
            gallery: [...model.gallery, buildMediaItem(input)],
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

      await updateSiteContent((current) => ({
        ...current,
        models: current.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }

          return {
            ...model,
            gallery: [
              ...model.gallery,
              ...items.map((item) => buildMediaItem({ ...item, modelId })),
            ],
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
  };
}
