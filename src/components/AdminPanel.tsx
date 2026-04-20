import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getAdminCommentsPath, getHomePath, getModelVideoPath } from '../lib/modelRoute';
import type {
  HeroBackgroundTarget,
  ModelProfile,
  SiteContent,
  TelegramCacheSingleItemResponse,
  TelegramCacheWarmItem,
  TelegramCacheWarmStatus,
  UploadAssetOptions,
  UploadAssetProgress,
  UploadAssetResult,
} from '../types';
import { AutoplayMedia } from './AutoplayMedia';
import { CloseIcon, StarIcon } from './icons';

const CACHE_WARM_STATUS_STORAGE_KEY = 'allprivacy-admin-telegram-cache-status-v1';
const CACHE_WARM_FEEDBACK_STORAGE_KEY = 'allprivacy-admin-telegram-cache-feedback-v1';

interface AdminPanelProps {
  siteContent: SiteContent;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onLogout: () => Promise<void>;
  uploadAsset: (
    file: File,
    options?: UploadAssetOptions,
    onProgress?: (progress: UploadAssetProgress) => void,
  ) => Promise<UploadAssetResult>;
  addModel: (input: {
    name: string;
    handle: string;
    tagline: string;
    profileImage: string;
    coverImage: string;
    accentFrom?: string;
    accentTo?: string;
  }) => Promise<void>;
  updateModel: (input: {
    id?: string;
    name: string;
    handle: string;
    tagline: string;
    profileImage: string;
    coverImage: string;
    accentFrom?: string;
    accentTo?: string;
  }) => Promise<void>;
  removeModel: (modelId: string, options?: { deleteAssetFiles?: boolean }) => Promise<void>;
  toggleModelHomeVisibility: (modelId: string) => Promise<void>;
  addMediaToModel: (input: {
    modelId: string;
    type: 'image' | 'video';
    title: string;
    subtitle: string;
    thumbnail: string;
    src?: string;
  }) => Promise<void>;
  addMediaBatchToModel: (
    modelId: string,
    items: Array<{
      modelId: string;
      type: 'image' | 'video';
      title: string;
      subtitle: string;
      thumbnail: string;
      src?: string;
    }>,
  ) => Promise<void>;
  removeMediaFromModel: (
    modelId: string,
    mediaId: string,
    options?: { deleteAssetFiles?: boolean },
  ) => Promise<void>;
  toggleModelMediaFavorite: (modelId: string, mediaId: string) => Promise<void>;
  addModelFullContentVideo: (input: {
    modelId: string;
    videoUrl: string;
    routeToken?: string;
    title?: string;
  }) => Promise<void>;
  removeModelFullContentVideo: (
    modelId: string,
    contentId: string,
    options?: { deleteAssetFiles?: boolean },
  ) => Promise<void>;
  addGroupProofItem: (input: { title: string; image: string }) => Promise<void>;
  removeGroupProofItem: (
    itemId: string,
    options?: { deleteAssetFiles?: boolean },
  ) => Promise<void>;
  addHeroBackground: (input: {
    title: string;
    image: string;
    target: HeroBackgroundTarget;
  }) => Promise<void>;
  removeHeroBackground: (
    target: HeroBackgroundTarget,
    itemId: string,
    options?: { deleteAssetFiles?: boolean },
  ) => Promise<void>;
  clearSiteContent: (options?: { deleteAssetFiles?: boolean }) => Promise<void>;
  trimExistingVideo: (
    assetUrl: string,
    startSeconds: number,
    endSeconds: number,
  ) => Promise<{ ok: boolean; assetUrl: string; thumbnailUrl?: string }>;
  removeUploadedAssets: (assetUrls: string[]) => Promise<void>;
  warmTelegramMediaCache: (
    onStatus?: (status: TelegramCacheWarmStatus) => void,
  ) => Promise<TelegramCacheWarmStatus>;
  checkTelegramMediaCache: (
    onStatus?: (status: TelegramCacheWarmStatus) => void,
  ) => Promise<TelegramCacheWarmStatus>;
  warmSingleTelegramMediaCache: (
    assetUrl: string,
    mediaType: 'image' | 'video',
  ) => Promise<TelegramCacheSingleItemResponse>;
}

type ModelListSort = 'latest' | 'az' | 'content';

interface ModelFormState {
  name: string;
  handle: string;
  tagline: string;
  profileImage: string;
  coverImage: string;
}

interface MediaFormState {
  modelId: string;
  title: string;
  subtitle: string;
}

interface GroupProofFormState {
  title: string;
  image: string;
}

interface HeroBackgroundFormState {
  title: string;
  image: string;
  target: HeroBackgroundTarget;
}

interface ModelFileState {
  profileImage: File | null;
  coverImage: File | null;
}

interface MediaFileState {
  assets: File[];
}

interface InlineMediaDraftState {
  title: string;
  subtitle: string;
  assets: File[];
}

interface VideoTrimSelection {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

type VideoTrimDialogState =
  | {
      kind: 'draft';
      file: File;
      title: string;
    }
  | {
      kind: 'existing';
      src: string;
      previewSrc: string;
      title: string;
      taskId: string;
      successMessage: string;
    };

interface TaskProgressState {
  taskId: string;
  label: string;
  value: number;
}

type PreviewShape = 'circle' | 'landscape' | 'portrait' | 'square';
type SectionId = 'model' | 'media' | 'backgrounds' | 'proofs' | 'models';

const emptyModelForm: ModelFormState = {
  name: '',
  handle: '',
  tagline: '',
  profileImage: '',
  coverImage: '',
};

const emptyMediaForm: MediaFormState = {
  modelId: '',
  title: '',
  subtitle: '',
};

const emptyGroupProofForm: GroupProofFormState = {
  title: '',
  image: '',
};

const emptyHeroBackgroundForm: HeroBackgroundFormState = {
  title: '',
  image: '',
  target: 'mobile',
};

const emptyModelFiles: ModelFileState = {
  profileImage: null,
  coverImage: null,
};

const emptyMediaFiles: MediaFileState = {
  assets: [],
};

function createEmptyInlineMediaDraft(): InlineMediaDraftState {
  return {
    title: '',
    subtitle: '',
    assets: [],
  };
}

function createClearCaptchaChallenge() {
  const left = Math.floor(Math.random() * 8) + 2;
  const right = Math.floor(Math.random() * 8) + 2;

  return {
    left,
    right,
    answer: left + right,
  };
}

function mergeUniqueFiles(currentFiles: File[], nextFiles: File[]) {
  const knownKeys = new Set(
    currentFiles.map((file) => `${file.name}-${file.size}-${file.lastModified}`),
  );
  const uniqueNextFiles = nextFiles.filter((file) => {
    const key = `${file.name}-${file.size}-${file.lastModified}`;

    if (knownKeys.has(key)) {
      return false;
    }

    knownKeys.add(key);
    return true;
  });

  return [...currentFiles, ...uniqueNextFiles];
}

function createFileIdentity(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatTrimTime(seconds: number) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalSeconds = Math.floor(safeSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function fileMatchesAccept(file: File, accept: string) {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  return tokens.some((token) => {
    if (token === '*/*') {
      return true;
    }

    if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1);
      return mimeType.startsWith(prefix);
    }

    if (token.startsWith('.')) {
      return fileName.endsWith(token);
    }

    return mimeType === token;
  });
}

function getAcceptedClipboardFiles(
  event: ClipboardEvent<HTMLElement>,
  accept: string,
  multiple = false,
) {
  const clipboardFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    fileMatchesAccept(file, accept),
  );
  const clipboardItemFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .filter((file) => fileMatchesAccept(file, accept));
  const mergedFiles = mergeUniqueFiles(clipboardFiles, clipboardItemFiles);

  if (!multiple) {
    return mergedFiles.slice(0, 1);
  }

  return mergedFiles;
}

function inferClipboardFileExtension(type: string) {
  const normalizedType = type.toLowerCase();

  if (!normalizedType.includes('/')) {
    return 'bin';
  }

  const [, subtype] = normalizedType.split('/');
  const sanitizedSubtype = (subtype || 'bin').split(';')[0]?.trim() || 'bin';

  if (sanitizedSubtype === 'jpeg') {
    return 'jpg';
  }

  if (sanitizedSubtype === 'quicktime') {
    return 'mov';
  }

  if (sanitizedSubtype === 'x-m4v') {
    return 'm4v';
  }

  return sanitizedSubtype;
}

function createClipboardFile(blob: Blob, index: number) {
  if (blob instanceof File) {
    return blob;
  }

  const type = blob.type || 'application/octet-stream';
  const extension = inferClipboardFileExtension(type);
  const fileName = `clipboard-${Date.now()}-${index}.${extension}`;

  return new File([blob], fileName, {
    type,
    lastModified: Date.now(),
  });
}

async function readAcceptedClipboardFiles(accept: string, multiple = false) {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.read !== 'function') {
    return [];
  }

  const items = await navigator.clipboard.read();
  const files: File[] = [];

  for (const item of items) {
    for (const type of item.types) {
      let blob: Blob | null = null;

      try {
        blob = await item.getType(type);
      } catch {
        blob = null;
      }

      if (!blob) {
        continue;
      }

      const file = createClipboardFile(blob, files.length);

      if (!fileMatchesAccept(file, accept)) {
        continue;
      }

      files.push(file);

      if (!multiple) {
        return files.slice(0, 1);
      }
    }
  }

  return multiple ? mergeUniqueFiles([], files) : files.slice(0, 1);
}

function fieldClassName() {
  return 'min-h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60 md:text-[15px]';
}

function labelClassName() {
  return 'text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55';
}

function getModelContentCounts(model: ModelProfile) {
  return {
    previews: model.gallery.filter((item) => item.type === 'video').length,
    images: model.gallery.filter((item) => item.type === 'image').length,
    exclusives: model.fullContentVideos?.length ?? 0,
  };
}

function getTaskErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    const normalizedMessage = error.message.trim();

    if (normalizedMessage) {
      return normalizedMessage;
    }
  }

  return fallbackMessage;
}

function buttonClassName() {
  return 'inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-rose-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60';
}

function ghostButtonClassName() {
  return 'inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60';
}

function dangerGhostButtonClassName() {
  return 'inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-100 transition hover:bg-red-500/16 disabled:cursor-not-allowed disabled:opacity-60';
}

function previewFrameClassName(shape: PreviewShape) {
  if (shape === 'circle') {
    return 'relative mx-auto h-24 w-24 overflow-hidden rounded-full border border-white/10 bg-black';
  }

  if (shape === 'landscape') {
    return 'relative aspect-[16/10] overflow-hidden rounded-[22px] border border-white/10 bg-black';
  }

  if (shape === 'portrait') {
    return 'relative aspect-[9/16] overflow-hidden rounded-[22px] border border-white/10 bg-black';
  }

  return 'relative aspect-square overflow-hidden rounded-[22px] border border-white/10 bg-black';
}

function usePreviewSrc(file: File | null, url: string) {
  const [previewSrc, setPreviewSrc] = useState(url.trim());

  useEffect(() => {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setPreviewSrc(objectUrl);

      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }

    setPreviewSrc(url.trim());
    return undefined;
  }, [file, url]);

  return previewSrc;
}

function PreviewImage({
  file,
  url,
  alt,
  shape = 'square',
}: {
  file: File | null;
  url: string;
  alt: string;
  shape?: PreviewShape;
}) {
  const previewSrc = usePreviewSrc(file, url);

  if (!previewSrc) {
    return null;
  }

  if (shape === 'landscape') {
    return (
      <div className={previewFrameClassName(shape)}>
        <img
          src={previewSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-105 object-cover opacity-25 blur-xl"
          loading="lazy"
        />
        <img
          src={previewSrc}
          alt={alt}
          className="relative h-full w-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className={previewFrameClassName(shape)}>
      <img src={previewSrc} alt={alt} className="h-full w-full object-cover" loading="lazy" />
    </div>
  );
}

function PendingMediaPreview({
  file,
  footer,
  onRemove,
  aspectClassName = 'aspect-[4/5]',
}: {
  file: File;
  footer?: ReactNode;
  onRemove?: () => void;
  aspectClassName?: string;
}) {
  const previewSrc = usePreviewSrc(file, '');
  const isVideo = file.type.startsWith('video/');

  if (!previewSrc) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-white/10 bg-black">
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/70 text-sm font-semibold text-white transition hover:bg-red-500/80"
          aria-label={`Remover ${file.name}`}
        >
          ×
        </button>
      ) : null}
      <div className={`${aspectClassName} bg-black`}>
        <AutoplayMedia
          type={isVideo ? 'video' : 'image'}
          src={isVideo ? previewSrc : undefined}
          poster={isVideo ? undefined : previewSrc}
          alt={file.name}
          className="h-full w-full"
          playMode={isVideo ? 'hover' : 'viewport'}
          preloadStrategy={isVideo ? 'metadata' : 'auto'}
        />
      </div>
      <div className="border-t border-white/10 px-3 py-2">
        <div className="truncate text-[11px] text-white/65">{file.name}</div>
        {footer ? <div className="mt-2">{footer}</div> : null}
      </div>
    </div>
  );
}

function CacheWarmItemThumbnail({ item }: { item: TelegramCacheWarmItem }) {
  if (!item.assetUrl) {
    return (
      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/50" />
    );
  }

  if (item.mediaType === 'video') {
    return (
      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
        <video
          src={item.assetUrl}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
        />
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/80">
          video
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
      <img
        src={item.assetUrl}
        alt={item.assetLabel}
        className="h-full w-full object-cover"
        loading="lazy"
      />
      <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/80">
        img
      </span>
    </div>
  );
}

function UploadField({
  label,
  accept,
  urlValue,
  urlPlaceholder,
  file,
  onUrlChange,
  onFileChange,
  helper,
  disabled = false,
  previewShape = 'square',
  previewAlt,
}: {
  label: string;
  accept: string;
  urlValue: string;
  urlPlaceholder: string;
  file: File | null;
  onUrlChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  helper?: string;
  disabled?: boolean;
  previewShape?: PreviewShape;
  previewAlt: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [isPasteDialogOpen, setIsPasteDialogOpen] = useState(false);

  const handleKeyboardOpen = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    const pastedFiles = getAcceptedClipboardFiles(event, accept, false);

    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    onFileChange(pastedFiles[0] ?? null);
  };

  const handleClipboardImport = async () => {
    if (disabled || isReadingClipboard) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
      setIsPasteDialogOpen(true);
      return;
    }

    setIsReadingClipboard(true);

    try {
      const pastedFiles = await readAcceptedClipboardFiles(accept, false);

      if (pastedFiles.length > 0) {
        onFileChange(pastedFiles[0] ?? null);
        return;
      }

      setIsPasteDialogOpen(true);
    } catch {
      setIsPasteDialogOpen(true);
    } finally {
      setIsReadingClipboard(false);
    }
  };

  return (
    <div className="grid self-start gap-3 rounded-[24px] border border-white/10 bg-black/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={labelClassName()}>{label}</span>
        {file ? <span className="max-w-[55%] truncate text-xs text-white/45">{file.name}</span> : null}
      </div>

      {file || urlValue.trim() ? (
        <PreviewImage file={file} url={urlValue} alt={previewAlt} shape={previewShape} />
      ) : null}

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) {
            inputRef.current?.click();
          }
        }}
        onKeyDown={handleKeyboardOpen}
        onPaste={handlePaste}
        className="cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-white/15"
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          disabled={disabled}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        <div className="flex items-center justify-between gap-3">
          <span>{file ? 'Trocar arquivo local' : 'Selecionar arquivo local'}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleClipboardImport();
              }}
              disabled={disabled || isReadingClipboard}
              className="inline-flex min-h-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isReadingClipboard ? 'Colando...' : 'Colar'}
            </button>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              Ctrl+V
            </span>
          </div>
        </div>
      </div>

      <input
        value={urlValue}
        onChange={(event) => onUrlChange(event.target.value)}
        className={fieldClassName()}
        placeholder={urlPlaceholder}
        disabled={disabled}
      />

      {helper ? (
        <p className="text-xs leading-5 text-white/45">
          {helper} Toque em <strong className="text-white/70">Colar</strong> no iPhone.
        </p>
      ) : (
        <p className="text-xs leading-5 text-white/45">
          Toque em <strong className="text-white/70">Colar</strong> no iPhone.
        </p>
      )}

      <ClipboardPasteDialog
        isOpen={isPasteDialogOpen}
        title={label}
        accept={accept}
        onFiles={(pastedFiles) => onFileChange(pastedFiles[0] ?? null)}
        onClose={() => setIsPasteDialogOpen(false)}
      />
    </div>
  );
}

function MultiFileUploadField({
  label,
  accept,
  files,
  onFilesChange,
  onRemoveFile,
  renderPreviewFooter,
  helper,
  disabled = false,
}: {
  label: string;
  accept: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onRemoveFile?: (file: File, index: number) => void;
  renderPreviewFooter?: (file: File) => ReactNode;
  helper?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [isPasteDialogOpen, setIsPasteDialogOpen] = useState(false);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const appendFiles = (nextFiles: File[]) => {
    onFilesChange(mergeUniqueFiles(filesRef.current, nextFiles));
  };

  const handleKeyboardOpen = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    const pastedFiles = getAcceptedClipboardFiles(event, accept, true);

    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    appendFiles(pastedFiles);
  };

  const handleClipboardImport = async () => {
    if (disabled || isReadingClipboard) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
      setIsPasteDialogOpen(true);
      return;
    }

    setIsReadingClipboard(true);

    try {
      const pastedFiles = await readAcceptedClipboardFiles(accept, true);

      if (pastedFiles.length > 0) {
        appendFiles(pastedFiles);
        return;
      }

      setIsPasteDialogOpen(true);
    } catch {
      setIsPasteDialogOpen(true);
    } finally {
      setIsReadingClipboard(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-[24px] border border-white/10 bg-black/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={labelClassName()}>{label}</span>
        {files.length > 0 ? <span className="text-xs text-white/45">{files.length} arquivo(s)</span> : null}
      </div>

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) {
            inputRef.current?.click();
          }
        }}
        onKeyDown={handleKeyboardOpen}
        onPaste={handlePaste}
        className="cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-white/15"
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            appendFiles(Array.from(event.target.files ?? []));
            event.currentTarget.value = '';
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <span>{files.length > 0 ? 'Adicionar mais arquivos' : 'Selecionar varios arquivos'}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void handleClipboardImport();
              }}
              disabled={disabled || isReadingClipboard}
              className="inline-flex min-h-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isReadingClipboard ? 'Colando...' : 'Colar'}
            </button>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              Ctrl+V
            </span>
          </div>
        </div>
      </div>

      {files.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((file, index) => (
            <PendingMediaPreview
              key={`${file.name}-${file.lastModified}`}
              file={file}
              onRemove={
                onRemoveFile
                  ? () => {
                      onRemoveFile(file, index);
                    }
                  : undefined
              }
              footer={renderPreviewFooter?.(file)}
            />
          ))}
        </div>
      ) : null}

      {helper ? (
        <p className="text-xs leading-5 text-white/45">
          {helper} Toque em <strong className="text-white/70">Colar</strong> no iPhone.
        </p>
      ) : (
        <p className="text-xs leading-5 text-white/45">
          Toque em <strong className="text-white/70">Colar</strong> no iPhone.
        </p>
      )}

      <ClipboardPasteDialog
        isOpen={isPasteDialogOpen}
        title={label}
        accept={accept}
        multiple
        onFiles={(pastedFiles) => appendFiles(pastedFiles)}
        onClose={() => setIsPasteDialogOpen(false)}
      />
    </div>
  );
}

function ModelPicker({
  models,
  selectedId,
  onSelect,
}: {
  models: ModelProfile[];
  selectedId: string;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className={labelClassName()}>Modelo</span>
      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
        {models.map((model) => {
          const isActive = selectedId === model.id;

          return (
            <button
              key={model.id}
              type="button"
              onClick={() => onSelect(model.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
                isActive
                  ? 'border-rose-400/40 bg-gradient-to-r from-rose-600/30 to-violet-600/30 text-white'
                  : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]'
              }`}
            >
              {model.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TargetSwitch({
  value,
  onChange,
}: {
  value: HeroBackgroundTarget;
  onChange: (value: HeroBackgroundTarget) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className={labelClassName()}>Destino do fundo</span>
      <div className="grid grid-cols-2 gap-2">
        {(['mobile', 'desktop'] as const).map((item) => {
          const isActive = value === item;

          return (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              className={`min-h-11 rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                isActive
                  ? 'border-rose-400/40 bg-gradient-to-r from-rose-600/30 to-violet-600/30 text-white'
                  : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]'
              }`}
            >
              {item === 'mobile' ? 'Mobile' : 'Desktop'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AdminSection({
  title,
  subtitle,
  countLabel,
  isOpen,
  onToggle,
  sectionId,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  countLabel?: string;
  isOpen: boolean;
  onToggle: () => void;
  sectionId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={sectionId}
      className={`rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-xl ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5 xl:px-6 xl:py-5"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">
              {title}
            </h2>
            {countLabel ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/60">
                {countLabel}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-zinc-300">{subtitle}</p> : null}
        </div>

        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
          {isOpen ? 'Fechar' : 'Abrir'}
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-white/10 px-4 py-4 sm:px-5 xl:px-6 xl:py-5">{children}</div>
      ) : null}
    </section>
  );
}

function AdminMobileDialog({
  isOpen,
  title,
  onClose,
  children,
}: {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) {
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
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md xl:hidden"
      onClick={onClose}
    >
      <div className="flex min-h-full items-end justify-center overflow-hidden px-0">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative h-[min(92dvh,900px)] w-screen max-w-full overflow-hidden rounded-t-[32px] border border-white/10 bg-[#09090c]/95 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md"
          >
            <CloseIcon className="h-5 w-5" />
          </button>

          <div className="hide-scrollbar h-full overflow-y-auto">
            <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_42%)] px-5 pb-7 pt-16">
              <h2 className="max-w-3xl font-display text-2xl font-semibold tracking-tight text-white">
                {title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                Envie novas imagens e videos sem sair da gestao dessa modelo.
              </p>
            </div>

            <div className="px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ClipboardPasteDialog({
  isOpen,
  title,
  accept,
  multiple = false,
  onFiles,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  onClose: () => void;
}) {
  const pasteTargetRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!isOpen) {
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
    window.setTimeout(() => {
      pasteTargetRef.current?.focus();
    }, 60);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      setFeedback('');
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative w-full max-w-lg overflow-hidden rounded-[30px] border border-white/10 bg-[#09090c]/95 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md"
          >
            <CloseIcon className="h-5 w-5" />
          </button>

          <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.16),transparent_38%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_42%)] px-5 pb-6 pt-16">
            <h2 className="font-display text-2xl font-semibold text-white">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              No iPhone, toque e segure na caixa abaixo e escolha <strong>Colar</strong>.
            </p>
          </div>

          <div className="grid gap-4 px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
            <div
              ref={pasteTargetRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onPaste={(event) => {
                const pastedFiles = getAcceptedClipboardFiles(event, accept, multiple);

                if (pastedFiles.length === 0) {
                  setFeedback('Nao encontrei uma midia valida na area de transferencia.');
                  return;
                }

                event.preventDefault();
                onFiles(pastedFiles);
                onClose();
              }}
              className="min-h-40 rounded-[24px] border border-dashed border-white/15 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/55 outline-none transition focus:border-white/25 focus:bg-white/[0.05]"
            >
              Toque e segure aqui para colar a midia copiada.
            </div>

            {feedback ? (
              <p className="text-sm leading-6 text-amber-100/85">{feedback}</p>
            ) : (
              <p className="text-xs leading-5 text-white/45">
                Tambem funciona com <strong className="text-white/70">Ctrl+V</strong> no desktop.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function VideoTrimDialog({
  state,
  initialSelection,
  onApply,
  onClear,
  onClose,
}: {
  state: VideoTrimDialogState | null;
  initialSelection: VideoTrimSelection | null;
  onApply: (selection: VideoTrimSelection) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const previewSrc = usePreviewSrc(
    state?.kind === 'draft' ? state.file : null,
    state?.kind === 'existing' ? state.previewSrc : '',
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [durationSeconds, setDurationSeconds] = useState(initialSelection?.durationSeconds ?? 0);
  const [startSeconds, setStartSeconds] = useState(initialSelection?.startSeconds ?? 0);
  const [endSeconds, setEndSeconds] = useState(
    initialSelection?.endSeconds ?? initialSelection?.durationSeconds ?? 0,
  );
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);

  useEffect(() => {
    if (!state) {
      return;
    }

    setDurationSeconds(initialSelection?.durationSeconds ?? 0);
    setStartSeconds(initialSelection?.startSeconds ?? 0);
    setEndSeconds(initialSelection?.endSeconds ?? initialSelection?.durationSeconds ?? 0);
    setCurrentTimeSeconds(0);
  }, [
    initialSelection?.durationSeconds,
    initialSelection?.endSeconds,
    initialSelection?.startSeconds,
    state,
  ]);

  useEffect(() => {
    if (!state) {
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
  }, [state, onClose]);

  if (!state || typeof document === 'undefined') {
    return null;
  }

  const minimumClipLength = 0.2;
  const safeDuration = Math.max(durationSeconds, minimumClipLength);
  const normalizedStartSeconds = Math.min(startSeconds, Math.max(0, endSeconds - minimumClipLength));
  const normalizedEndSeconds = Math.max(endSeconds, normalizedStartSeconds + minimumClipLength);
  const canApply =
    durationSeconds > minimumClipLength &&
    normalizedEndSeconds - normalizedStartSeconds >= minimumClipLength;
  const startPercent = Math.min(100, (normalizedStartSeconds / safeDuration) * 100);
  const endPercent = Math.min(100, (normalizedEndSeconds / safeDuration) * 100);
  const playheadPercent = Math.min(100, (currentTimeSeconds / safeDuration) * 100);

  const seekToTime = (nextSeconds: number, autoPlay = false) => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.currentTime = Math.max(0, Math.min(nextSeconds, safeDuration));

    if (autoPlay) {
      void videoRef.current.play().catch(() => undefined);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-md" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Cortar video: ${state.title}`}
          className="relative w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/10 bg-[#09090c]/95 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md"
          >
            <CloseIcon className="h-5 w-5" />
          </button>

          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr),340px]">
            <div className="border-b border-white/10 bg-black lg:border-b-0 lg:border-r">
              <div className="aspect-video bg-black">
                {previewSrc ? (
                  <video
                    ref={videoRef}
                    src={previewSrc}
                    playsInline
                    preload="metadata"
                    className="h-full w-full bg-black object-contain"
                    onLoadedMetadata={(event) => {
                      const metadataDuration = Math.max(
                        minimumClipLength,
                        Number.isFinite(event.currentTarget.duration)
                          ? event.currentTarget.duration
                          : 0,
                      );
                      setDurationSeconds(metadataDuration);
                      setCurrentTimeSeconds(0);
                      setStartSeconds((current) =>
                        Math.min(current, Math.max(0, metadataDuration - minimumClipLength)),
                      );
                      setEndSeconds(() => {
                        const baseEnd =
                          initialSelection?.endSeconds && initialSelection.endSeconds > 0
                            ? initialSelection.endSeconds
                            : metadataDuration;
                        return Math.min(
                          metadataDuration,
                          Math.max(baseEnd, minimumClipLength),
                        );
                      });
                    }}
                    onTimeUpdate={(event) => {
                      setCurrentTimeSeconds(event.currentTarget.currentTime);
                      if (
                        event.currentTarget.currentTime >= normalizedEndSeconds &&
                        normalizedEndSeconds > normalizedStartSeconds
                      ) {
                        event.currentTarget.pause();
                      }
                    }}
                    onClick={() => {
                      if (!videoRef.current) {
                        return;
                      }

                      if (videoRef.current.paused) {
                        void videoRef.current.play().catch(() => undefined);
                      } else {
                        videoRef.current.pause();
                      }
                    }}
                  />
                ) : null}
              </div>

              <div className="border-t border-white/10 px-4 py-4 sm:px-5">
                <div
                  ref={timelineRef}
                  className="relative h-14 cursor-pointer touch-none"
                  onClick={(event) => {
                    if (!timelineRef.current) {
                      return;
                    }

                    const rect = timelineRef.current.getBoundingClientRect();
                    const ratio = Math.min(
                      1,
                      Math.max(0, (event.clientX - rect.left) / Math.max(rect.width, 1)),
                    );
                    seekToTime(ratio * safeDuration);
                  }}
                >
                  <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/10" />
                  <div
                    className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-rose-500 to-violet-500"
                    style={{
                      left: `${startPercent}%`,
                      width: `${Math.max(2, endPercent - startPercent)}%`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute top-1/2 h-5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70"
                    style={{ left: `${playheadPercent}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-1.5 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white"
                    style={{ left: `${startPercent}%` }}
                  >
                    {formatTrimTime(normalizedStartSeconds)}
                  </div>
                  <div
                    className="pointer-events-none absolute top-1.5 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white"
                    style={{ left: `${endPercent}%` }}
                  >
                    {formatTrimTime(normalizedEndSeconds)}
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-white shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    style={{ left: `${startPercent}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-white shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    style={{ left: `${endPercent}%` }}
                  />
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs font-medium text-white/55">
                      <span>Início</span>
                      <span>{formatTrimTime(normalizedStartSeconds)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={safeDuration}
                      step={0.1}
                      value={normalizedStartSeconds}
                      onChange={(event) => {
                        const nextStart = Number(event.target.value);
                        const limitedStart = Math.min(
                          nextStart,
                          Math.max(0, normalizedEndSeconds - minimumClipLength),
                        );
                        setStartSeconds(limitedStart);
                        seekToTime(limitedStart);
                      }}
                      className="h-3 w-full accent-rose-500"
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs font-medium text-white/55">
                      <span>Fim</span>
                      <span>{formatTrimTime(normalizedEndSeconds)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={safeDuration}
                      step={0.1}
                      value={normalizedEndSeconds}
                      onChange={(event) => {
                        const nextEnd = Number(event.target.value);
                        const limitedEnd = Math.max(
                          Math.min(nextEnd, safeDuration),
                          normalizedStartSeconds + minimumClipLength,
                        );
                        setEndSeconds(limitedEnd);
                        seekToTime(limitedEnd);
                      }}
                      className="h-3 w-full accent-violet-500"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs text-white/55">
                    <span>Ajuste pelos controles abaixo do preview.</span>
                    <span>{formatTrimTime(Math.max(0, normalizedEndSeconds - normalizedStartSeconds))}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-5 sm:p-6">
              <div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                  Corte de video
                </span>
                <h3 className="mt-3 font-display text-2xl font-semibold text-white">
                  {state.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  Ajuste direto na timeline abaixo do preview e envie so o trecho certo.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                    Trecho
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {formatTrimTime(Math.max(0, normalizedEndSeconds - normalizedStartSeconds))}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                    Inicio
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {formatTrimTime(normalizedStartSeconds)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                    Fim
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {formatTrimTime(normalizedEndSeconds)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => seekToTime(normalizedStartSeconds, true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                >
                  Testar trecho
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-medium text-white/70 transition hover:bg-white/[0.05] hover:text-white"
                >
                  Remover corte
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!canApply) {
                      return;
                    }

                    onApply({
                      startSeconds: normalizedStartSeconds,
                      endSeconds: normalizedEndSeconds,
                      durationSeconds,
                    });
                    onClose();
                  }}
                  disabled={!canApply}
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-rose-600 via-rose-500 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(168,85,247,0.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Aplicar corte
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TaskProgressBar({
  progress,
}: {
  progress: TaskProgressState;
}) {
  return (
    <div className="grid gap-2 rounded-[22px] border border-white/10 bg-black/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-white/75">{progress.label}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
          {progress.value}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rose-500 via-rose-400 to-violet-500 transition-[width] duration-200"
          style={{ width: `${progress.value}%` }}
        />
      </div>
    </div>
  );
}

interface TelegramCacheWarmGroup {
  label: string;
  items: TelegramCacheWarmItem[];
  cached: number;
  warmed: number;
  missing: number;
  failed: number;
}

function normalizeCacheReasonForDisplay(reason: string) {
  const normalizedReason = reason.trim();

  if (!normalizedReason) {
    return 'Falha ao verificar esta midia no cache do Telegram.';
  }

  if (
    normalizedReason.toLowerCase().includes('file is too big') ||
    normalizedReason.toLowerCase().includes('too big') ||
    normalizedReason.toLowerCase().includes('arquivo acima do limite aceito pelo bot do telegram')
  ) {
    return 'Arquivo acima do limite aceito pelo Bot do Telegram para esse tipo de envio.';
  }

  return normalizedReason;
}

function normalizeCacheFeedbackMessage(message: string) {
  return message
    .replace(
      /bad request:\s*file is too big/gi,
      'Arquivo acima do limite aceito pelo Bot do Telegram para esse tipo de envio.',
    )
    .replace(
      /arquivo acima do limite de 50 mb do bot api do telegram\./gi,
      'Arquivo acima do limite aceito pelo Bot do Telegram para esse tipo de envio.',
    );
}

function normalizeStoredCacheWarmStatus(status: TelegramCacheWarmStatus | null) {
  if (!status) {
    return null;
  }

  return {
    ...status,
    failures: status.failures.map((failure) => ({
      ...failure,
      reason: normalizeCacheReasonForDisplay(failure.reason),
    })),
    items: status.items.map((item) => ({
      ...item,
      reason: item.reason ? normalizeCacheReasonForDisplay(item.reason) : item.reason,
    })),
  };
}

function formatCacheStatusFeedback(status: TelegramCacheWarmStatus) {
  const actionLabel = status.mode === 'check' ? 'Verificacao concluida.' : 'Cache concluido.';
  const warmedLabel =
    status.mode === 'check' ? '0 enviada(s) agora' : `${status.warmed} enviada(s) agora`;
  const baseMessage = `${actionLabel} ${status.checked} midia(s) verificadas, ${status.alreadyCached} ja em cache, ${warmedLabel} e ${status.failed} falha(s).`;

  if (status.failed === 0) {
    return baseMessage;
  }

  const failurePreview = status.failures
    .slice(0, 3)
    .map((failure) => {
      const filename = failure.assetUrl.split('/').pop() || failure.assetUrl;
      return `${decodeURIComponent(filename)}: ${normalizeCacheReasonForDisplay(failure.reason)}`;
    })
    .join(' | ');

  return normalizeCacheFeedbackMessage(`${baseMessage} Primeiras falhas: ${failurePreview}`);
}

function formatCacheWarmLogTime(timestamp: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function readStoredCacheWarmState() {
  if (typeof window === 'undefined') {
    return {
      status: null as TelegramCacheWarmStatus | null,
      feedback: null as { message: string; tone: 'success' | 'error' } | null,
    };
  }

  try {
    const rawStatus = window.localStorage.getItem(CACHE_WARM_STATUS_STORAGE_KEY);
    const rawFeedback = window.localStorage.getItem(CACHE_WARM_FEEDBACK_STORAGE_KEY);
    const parsedFeedback = rawFeedback
      ? (JSON.parse(rawFeedback) as { message: string; tone: 'success' | 'error' })
      : null;

    return {
      status: normalizeStoredCacheWarmStatus(
        rawStatus ? (JSON.parse(rawStatus) as TelegramCacheWarmStatus) : null,
      ),
      feedback: parsedFeedback
        ? ({
            ...parsedFeedback,
            message: normalizeCacheFeedbackMessage(parsedFeedback.message),
          } as { message: string; tone: 'success' | 'error' })
        : null,
    };
  } catch {
    return {
      status: null as TelegramCacheWarmStatus | null,
      feedback: null as { message: string; tone: 'success' | 'error' } | null,
    };
  }
}

function groupCacheItems(items: TelegramCacheWarmItem[]) {
  const groups = new Map<string, TelegramCacheWarmGroup>();

  for (const item of items) {
    const groupLabel = item.groupLabel || 'Outros';
    const currentGroup = groups.get(groupLabel) ?? {
      label: groupLabel,
      items: [],
      cached: 0,
      warmed: 0,
      missing: 0,
      failed: 0,
    };

    currentGroup.items.push(item);
    if (item.status === 'cached') {
      currentGroup.cached += 1;
    } else if (item.status === 'warmed') {
      currentGroup.warmed += 1;
    } else if (item.status === 'missing') {
      currentGroup.missing += 1;
    } else {
      currentGroup.failed += 1;
    }
    groups.set(groupLabel, currentGroup);
  }

  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function summarizeCacheWarmItems(items: TelegramCacheWarmItem[]) {
  const failures = items
    .filter((item) => item.status === 'failed' && item.reason)
    .map((item) => ({
      assetUrl: item.assetUrl,
      mediaType: item.mediaType,
      reason: normalizeCacheReasonForDisplay(item.reason || ''),
    }));

  return {
    checked: items.length,
    alreadyCached: items.filter((item) => item.status === 'cached').length,
    warmed: items.filter((item) => item.status === 'warmed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    failures,
  };
}

function buildUpdatedCacheWarmStatus({
  currentStatus,
  nextItem,
  message,
  level,
}: {
  currentStatus: TelegramCacheWarmStatus;
  nextItem: TelegramCacheWarmItem;
  message: string;
  level: 'info' | 'success' | 'error';
}) {
  const nextItems = currentStatus.items.some((item) => item.assetUrl === nextItem.assetUrl)
    ? currentStatus.items.map((item) => (item.assetUrl === nextItem.assetUrl ? nextItem : item))
    : [...currentStatus.items, nextItem];
  const nextSummary = summarizeCacheWarmItems(nextItems);
  const now = new Date().toISOString();
  const nextStatus: TelegramCacheWarmStatus = {
    ...currentStatus,
    ...nextSummary,
    mode: 'warm',
    state: 'completed',
    total: Math.max(currentStatus.total, nextItems.length),
    progressPercent: 100,
    currentStep: message,
    currentAsset: nextItem.assetLabel,
    message,
    finishedAt: now,
    items: nextItems,
    logs: [
      ...(currentStatus.logs || []),
      {
        id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        level,
        message,
        timestamp: now,
      },
    ].slice(-80),
  };

  return normalizeStoredCacheWarmStatus(nextStatus) ?? nextStatus;
}

function getCacheGroupTone(label: string) {
  void label;
  return {
    shell:
      'border-white/12 bg-gradient-to-br from-white/[0.055] via-white/[0.025] to-black/45 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]',
    header: 'bg-white/[0.035]',
    accent: 'bg-white/24',
    button:
      'border-white/12 bg-white/[0.05] text-white/85 shadow-[0_0_0_1px_rgba(255,255,255,0.035)]',
    divider: 'border-white/12',
    badge: 'border-white/12 bg-white/[0.04] text-white/72',
    title: 'text-white',
    subtitle: 'text-white/60',
  };
}

export function AdminPanel({
  siteContent,
  isLoading,
  isSaving,
  error,
  onLogout,
  uploadAsset,
  addModel,
  updateModel,
  removeModel,
  toggleModelHomeVisibility,
  addMediaBatchToModel,
  removeMediaFromModel,
  toggleModelMediaFavorite,
  addModelFullContentVideo,
  removeModelFullContentVideo,
  addGroupProofItem,
  removeGroupProofItem,
  addHeroBackground,
  removeHeroBackground,
  clearSiteContent,
  trimExistingVideo,
  warmTelegramMediaCache,
  checkTelegramMediaCache,
  warmSingleTelegramMediaCache,
}: AdminPanelProps) {
  const initialCacheWarmState = readStoredCacheWarmState();
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [mediaForm, setMediaForm] = useState(emptyMediaForm);
  const [groupProofForm, setGroupProofForm] = useState(emptyGroupProofForm);
  const [heroBackgroundForm, setHeroBackgroundForm] = useState(emptyHeroBackgroundForm);
  const [modelFiles, setModelFiles] = useState(emptyModelFiles);
  const [mediaFiles, setMediaFiles] = useState(emptyMediaFiles);
  const [groupProofFile, setGroupProofFile] = useState<File | null>(null);
  const [heroBackgroundFile, setHeroBackgroundFile] = useState<File | null>(null);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cacheWarmFeedback, setCacheWarmFeedback] = useState<string | null>(
    initialCacheWarmState.feedback?.message ?? null,
  );
  const [cacheWarmFeedbackTone, setCacheWarmFeedbackTone] = useState<'success' | 'error'>(
    initialCacheWarmState.feedback?.tone ?? 'success',
  );
  const [cacheWarmStatus, setCacheWarmStatus] = useState<TelegramCacheWarmStatus | null>(
    initialCacheWarmState.status,
  );
  const [expandedCacheGroups, setExpandedCacheGroups] = useState<string[]>([]);
  const [singleCachePendingUrl, setSingleCachePendingUrl] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearConfirmArmed, setIsClearConfirmArmed] = useState(false);
  const [clearCaptchaChallenge, setClearCaptchaChallenge] = useState(createClearCaptchaChallenge);
  const [clearCaptchaInput, setClearCaptchaInput] = useState('');
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [selectedDesktopModelId, setSelectedDesktopModelId] = useState<string | null>(null);
  const [isDesktopModelRailCollapsed, setIsDesktopModelRailCollapsed] = useState(false);
  const [editingModelForm, setEditingModelForm] = useState(emptyModelForm);
  const [editingModelFiles, setEditingModelFiles] = useState(emptyModelFiles);
  const [fullContentFiles, setFullContentFiles] = useState<Record<string, File | null>>({});
  const [clipboardReadingTargetId, setClipboardReadingTargetId] = useState<string | null>(null);
  const [videoTrimSelections, setVideoTrimSelections] = useState<Record<string, VideoTrimSelection>>(
    {},
  );
  const [assetVersionBusters, setAssetVersionBusters] = useState<Record<string, number>>({});
  const [videoTrimDialogState, setVideoTrimDialogState] = useState<VideoTrimDialogState | null>(
    null,
  );
  const [fullContentPasteDialogModelId, setFullContentPasteDialogModelId] = useState<string | null>(
    null,
  );
  const [inlineModelMediaDrafts, setInlineModelMediaDrafts] = useState<
    Record<string, InlineMediaDraftState>
  >({});
  const [mobileInlineMediaModalModelId, setMobileInlineMediaModalModelId] = useState<string | null>(
    null,
  );
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [modelListSort, setModelListSort] = useState<ModelListSort>('latest');
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    model: false,
    media: false,
    backgrounds: false,
    proofs: false,
    models: false,
  });

  useEffect(() => {
    if (!mediaForm.modelId && siteContent.models[0]) {
      setMediaForm((current) => ({
        ...current,
        modelId: siteContent.models[0]?.id ?? '',
      }));
    }

    if (
      mediaForm.modelId &&
      !siteContent.models.some((model) => model.id === mediaForm.modelId)
    ) {
      setMediaForm((current) => ({
        ...current,
        modelId: siteContent.models[0]?.id ?? '',
      }));
    }
  }, [mediaForm.modelId, siteContent.models]);

  useEffect(() => {
    if (siteContent.models.length === 0) {
      setSelectedDesktopModelId(null);
      return;
    }

    if (!selectedDesktopModelId) {
      return;
    }

    if (siteContent.models.some((model) => model.id === selectedDesktopModelId)) {
      return;
    }

    setSelectedDesktopModelId(null);
  }, [selectedDesktopModelId, siteContent.models]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (cacheWarmStatus) {
      window.localStorage.setItem(
        CACHE_WARM_STATUS_STORAGE_KEY,
        JSON.stringify(cacheWarmStatus),
      );
    } else {
      window.localStorage.removeItem(CACHE_WARM_STATUS_STORAGE_KEY);
    }
  }, [cacheWarmStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (cacheWarmFeedback) {
      window.localStorage.setItem(
        CACHE_WARM_FEEDBACK_STORAGE_KEY,
        JSON.stringify({
          message: normalizeCacheFeedbackMessage(cacheWarmFeedback),
          tone: cacheWarmFeedbackTone,
        }),
      );
    } else {
      window.localStorage.removeItem(CACHE_WARM_FEEDBACK_STORAGE_KEY);
    }
  }, [cacheWarmFeedback, cacheWarmFeedbackTone]);

  const toggleSection = (sectionId: SectionId) => {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  const getModelFullContentHref = (
    model: Pick<ModelProfile, 'id' | 'name' | 'handle'>,
    routeToken: string,
  ) => {
    const normalizedRouteToken = routeToken.trim();

    if (!normalizedRouteToken) {
      return '';
    }

    const relativePath = getModelVideoPath(model, normalizedRouteToken);

    if (typeof window === 'undefined') {
      return relativePath;
    }

    return `${window.location.origin}${relativePath}`;
  };

  const updateTaskProgress = (taskId: string, label: string, value: number) => {
    setTaskProgress({
      taskId,
      label,
      value: Math.max(0, Math.min(100, Math.round(value))),
    });
  };

  const clearTaskProgress = () => {
    setTaskProgress(null);
  };

  const resetClearConfirmation = () => {
    setIsClearConfirmOpen(false);
    setIsClearConfirmArmed(false);
    setClearCaptchaChallenge(createClearCaptchaChallenge());
    setClearCaptchaInput('');
  };

  const askDeleteAssetFiles = (message: string) => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.confirm(message);
  };

  const getVersionedAssetUrl = (assetUrl: string) => {
    const version = assetVersionBusters[assetUrl];

    if (!assetUrl || !version) {
      return assetUrl;
    }

    return `${assetUrl}${assetUrl.includes('?') ? '&' : '?'}v=${version}`;
  };

  const bumpAssetVersion = (assetUrl: string) => {
    if (!assetUrl) {
      return;
    }

    setAssetVersionBusters((current) => ({
      ...current,
      [assetUrl]: (current[assetUrl] ?? 0) + 1,
    }));
  };

  const resolveAsset = async ({
    file,
    fallbackUrl,
    taskId,
    label,
    progressRange = [10, 82],
    options,
  }: {
    file: File | null;
    fallbackUrl: string;
    taskId: string;
    label: string;
    progressRange?: [number, number];
    options?: UploadAssetOptions;
  }) => {
    if (file) {
      const uploaded = await uploadAsset(file, options, (progress) => {
        const [start, end] = progressRange;
        const nextValue = start + ((end - start) * progress.percent) / 100;
        updateTaskProgress(taskId, label, nextValue);
      });
      return uploaded.url;
    }

    return fallbackUrl.trim();
  };

  const uploadAssetsSequentially = async ({
    files,
    taskId,
    label,
    range = [16, 86],
    optionsBuilder,
  }: {
    files: File[];
    taskId: string;
    label: string;
    range?: [number, number];
    optionsBuilder: (file: File, index: number) => UploadAssetOptions;
  }) => {
    const uploadedAssets: UploadAssetResult[] = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const [rangeStart, rangeEnd] = range;
      const currentStart = rangeStart + ((rangeEnd - rangeStart) * index) / files.length;
      const currentEnd =
        rangeStart + ((rangeEnd - rangeStart) * (index + 1)) / files.length;
      const uploaded = await uploadAsset(file, optionsBuilder(file, index), (progress) => {
        const nextValue = currentStart + ((currentEnd - currentStart) * progress.percent) / 100;
        updateTaskProgress(
          taskId,
          `${label} ${index + 1}/${files.length}`,
          nextValue,
        );
      });

      uploadedAssets.push(uploaded);
      updateTaskProgress(
        taskId,
        `${label} ${index + 1}/${files.length}`,
        currentEnd,
      );
    }

    return uploadedAssets;
  };

  const getTaskProgress = (taskId: string) =>
    taskProgress?.taskId === taskId ? taskProgress : null;

  const getSubmitLabel = (taskId: string, idleLabel: string, loadingLabel: string) => {
    if (activeTask !== taskId) {
      return idleLabel;
    }

    const currentProgress = getTaskProgress(taskId);

    if (!currentProgress) {
      return loadingLabel;
    }

    return `${currentProgress.label} ${currentProgress.value}%`;
  };

  const startEditingModel = (model: ModelProfile) => {
    setExpandedModelId(model.id);
    setSelectedDesktopModelId(model.id);
    setEditingModelId(model.id);
    setEditingModelFiles(emptyModelFiles);
    setEditingModelForm({
      name: model.name,
      handle: model.handle,
      tagline: model.tagline,
      profileImage: model.profileImage,
      coverImage: model.coverImage,
    });
    setFeedback(null);
  };

  const stopEditingModel = () => {
    setEditingModelId(null);
    setEditingModelFiles(emptyModelFiles);
    setEditingModelForm(emptyModelForm);
  };

  const getInlineMediaDraft = (modelId: string) =>
    inlineModelMediaDrafts[modelId] ?? createEmptyInlineMediaDraft();

  const updateInlineMediaDraft = (
    modelId: string,
    updater: (draft: InlineMediaDraftState) => InlineMediaDraftState,
  ) => {
    setInlineModelMediaDrafts((current) => ({
      ...current,
      [modelId]: updater(current[modelId] ?? createEmptyInlineMediaDraft()),
    }));
  };

  const clearInlineMediaDraft = (modelId: string) => {
    setInlineModelMediaDrafts((current) => {
      if (!(modelId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[modelId];
      return next;
    });
  };

  const getVideoTrimSelection = (file: File | null) => {
    if (!file || !file.type.startsWith('video/')) {
      return null;
    }

    return videoTrimSelections[createFileIdentity(file)] ?? null;
  };

  const applyVideoTrimSelection = (file: File, selection: VideoTrimSelection | null) => {
    const fileIdentity = createFileIdentity(file);

    setVideoTrimSelections((current) => {
      if (!selection) {
        if (!(fileIdentity in current)) {
          return current;
        }

        const next = { ...current };
        delete next[fileIdentity];
        return next;
      }

      return {
        ...current,
        [fileIdentity]: selection,
      };
    });
  };

  const buildVideoUploadOptions = (
    file: File,
    options: UploadAssetOptions,
  ): UploadAssetOptions => {
    if (!file.type.startsWith('video/')) {
      return options;
    }

    const trimSelection = getVideoTrimSelection(file);

    if (!trimSelection) {
      return options;
    }

    return {
      ...options,
      trimStartSeconds: trimSelection.startSeconds,
      trimEndSeconds: trimSelection.endSeconds,
    };
  };

  const renderVideoTrimFooter = (file: File) => {
    if (!file.type.startsWith('video/')) {
      return null;
    }

    const trimSelection = getVideoTrimSelection(file);

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setVideoTrimDialogState({
              kind: 'draft',
              file,
              title: file.name,
            })
          }
          className="inline-flex min-h-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/75 transition hover:bg-white/[0.08]"
        >
          {trimSelection ? 'Editar' : 'Cortar'}
        </button>
        {trimSelection ? (
          <span className="text-[10px] font-medium text-emerald-300/90">
            {formatTrimTime(trimSelection.startSeconds)} - {formatTrimTime(trimSelection.endSeconds)}
          </span>
        ) : null}
      </div>
    );
  };

  const handleTrimExistingVideo = async ({
    assetUrl,
    startSeconds,
    endSeconds,
    taskId,
    successMessage,
  }: {
    assetUrl: string;
    startSeconds: number;
    endSeconds: number;
    taskId: string;
    successMessage: string;
  }) => {
    if (activeTask) {
      return;
    }

    setActiveTask(taskId);
    updateTaskProgress(taskId, 'Processando corte', 32);
    setFeedback(null);

    try {
      const trimResult = await trimExistingVideo(assetUrl, startSeconds, endSeconds);
      bumpAssetVersion(assetUrl);
      if (trimResult.thumbnailUrl) {
        bumpAssetVersion(trimResult.thumbnailUrl);
      }
      updateTaskProgress(taskId, 'Video atualizado', 100);
      setFeedback(successMessage);
    } catch {
      setFeedback('Nao foi possivel cortar este video agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const openExistingVideoTrimDialog = ({
    assetUrl,
    previewSrc,
    title,
    taskId,
    successMessage,
  }: {
    assetUrl: string;
    previewSrc?: string;
    title: string;
    taskId: string;
    successMessage: string;
  }) => {
    setVideoTrimDialogState({
      kind: 'existing',
      src: assetUrl,
      previewSrc: previewSrc ?? getVersionedAssetUrl(assetUrl),
      title,
      taskId,
      successMessage,
    });
  };

  const handleModelSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeTask) {
      return;
    }

    setActiveTask('model');
    updateTaskProgress('model', 'Preparando upload', 6);
    setFeedback(null);

    try {
      const modelName = modelForm.name.trim();

      if (
        !modelName ||
        (!modelFiles.profileImage && !modelForm.profileImage.trim()) ||
        (!modelFiles.coverImage && !modelForm.coverImage.trim())
      ) {
        setFeedback('Preencha o nome e envie a foto de perfil e a capa.');
        return;
      }

      const profileImage = await resolveAsset({
        file: modelFiles.profileImage,
        fallbackUrl: modelForm.profileImage,
        taskId: 'model',
        label: 'Enviando foto de perfil',
        progressRange: [10, 46],
        options: {
          bucket: 'model-profile',
          modelName,
          mediaType: 'image',
        },
      });
      const coverImage = await resolveAsset({
        file: modelFiles.coverImage,
        fallbackUrl: modelForm.coverImage,
        taskId: 'model',
        label: 'Enviando imagem de capa',
        progressRange: [46, 84],
        options: {
          bucket: 'model-cover',
          modelName,
          mediaType: 'image',
        },
      });

      updateTaskProgress('model', 'Gravando modelo', 92);

      await addModel({
        ...modelForm,
        name: modelName,
        profileImage,
        coverImage,
      });

      updateTaskProgress('model', 'Modelo salva', 100);

      setModelForm(emptyModelForm);
      setModelFiles(emptyModelFiles);
      setFeedback('Modelo salva no projeto.');
      setOpenSections((current) => ({ ...current, models: true }));
    } catch {
      setFeedback('Nao foi possivel salvar a modelo agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleUpdateModel = async (modelId: string) => {
    if (activeTask) {
      return;
    }

    setActiveTask(`update-model-${modelId}`);
    updateTaskProgress(`update-model-${modelId}`, 'Preparando edicao', 6);
    setFeedback(null);

    try {
      const modelName = editingModelForm.name.trim();

      if (
        !modelName ||
        (!editingModelFiles.profileImage && !editingModelForm.profileImage.trim()) ||
        (!editingModelFiles.coverImage && !editingModelForm.coverImage.trim())
      ) {
        setFeedback('A edicao precisa de nome, foto de perfil e capa.');
        return;
      }

      const profileImage = await resolveAsset({
        file: editingModelFiles.profileImage,
        fallbackUrl: editingModelForm.profileImage,
        taskId: `update-model-${modelId}`,
        label: 'Atualizando foto de perfil',
        progressRange: [10, 46],
        options: {
          bucket: 'model-profile',
          modelName,
          mediaType: 'image',
        },
      });
      const coverImage = await resolveAsset({
        file: editingModelFiles.coverImage,
        fallbackUrl: editingModelForm.coverImage,
        taskId: `update-model-${modelId}`,
        label: 'Atualizando capa',
        progressRange: [46, 84],
        options: {
          bucket: 'model-cover',
          modelName,
          mediaType: 'image',
        },
      });

      updateTaskProgress(`update-model-${modelId}`, 'Gravando alteracoes', 92);

      await updateModel({
        id: modelId,
        ...editingModelForm,
        name: modelName,
        profileImage,
        coverImage,
      });

      updateTaskProgress(`update-model-${modelId}`, 'Edicao concluida', 100);
      stopEditingModel();
      setFeedback('Modelo atualizada com sucesso.');
    } catch {
      setFeedback('Nao foi possivel atualizar a modelo agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleSaveMediaBatchForModel = async ({
    model,
    files,
    title,
    subtitle,
    taskId,
    successMessage,
    onSuccess,
  }: {
    model: ModelProfile;
    files: File[];
    title: string;
    subtitle: string;
    taskId: string;
    successMessage: string;
    onSuccess?: () => void;
  }) => {
    if (activeTask) {
      return;
    }

    if (files.length === 0) {
      setFeedback('Selecione uma ou mais imagens e/ou videos para enviar.');
      return;
    }

    setActiveTask(taskId);
    updateTaskProgress(taskId, 'Preparando conteudo', 6);
    setFeedback(null);

    try {
      const assetUploads = await uploadAssetsSequentially({
        files,
        taskId,
        label: 'Enviando conteudo',
        range: [16, 86],
        optionsBuilder: (file) =>
          buildVideoUploadOptions(file, {
            bucket: 'model-media',
            modelName: model.name,
            mediaType: file.type.startsWith('video/') ? 'video' : 'image',
          }),
      });

      const trimmedTitle = title.trim();
      const batchItems = assetUploads.map((uploadedAsset, index) => {
        const file = files[index];
        const mediaType = file?.type.startsWith('video/') ? 'video' : 'image';
        const assetUrl = uploadedAsset.url;
        const thumbnailUrl =
          mediaType === 'video'
            ? uploadedAsset.thumbnailUrl || uploadedAsset.url
            : uploadedAsset.url;

        return {
          modelId: model.id,
          type: mediaType as 'image' | 'video',
          title:
            trimmedTitle && assetUploads.length > 1
              ? `${trimmedTitle} ${index + 1}`
              : trimmedTitle || `Previa ${index + 1}`,
          subtitle,
          thumbnail: thumbnailUrl,
          src: mediaType === 'video' ? assetUrl : undefined,
        };
      });

      updateTaskProgress(taskId, 'Gravando conteudo', 92);
      await addMediaBatchToModel(model.id, batchItems);

      updateTaskProgress(taskId, 'Conteudo salvo', 100);
      onSuccess?.();
      setFeedback(successMessage);
      setOpenSections((current) => ({ ...current, models: true }));
    } catch (error) {
      setFeedback(
        getTaskErrorMessage(error, 'Nao foi possivel salvar o conteudo agora.'),
      );
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleMediaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const selectedModel = siteContent.models.find((model) => model.id === mediaForm.modelId);

    if (!mediaForm.modelId || !selectedModel) {
      setFeedback('Selecione uma modelo antes de salvar o conteudo.');
      return;
    }

    await handleSaveMediaBatchForModel({
      model: selectedModel,
      files: mediaFiles.assets,
      title: mediaForm.title,
      subtitle: mediaForm.subtitle,
      taskId: 'media',
      successMessage: 'Conteudo salvo e ja disponivel na home e no modal da modelo.',
      onSuccess: () => {
        setMediaForm((current) => ({
          ...emptyMediaForm,
          modelId: current.modelId,
        }));
        setMediaFiles(emptyMediaFiles);
      },
    });
  };

  const handleSaveFullContentVideo = async (model: ModelProfile) => {
    if (activeTask) {
      return;
    }

    const taskId = `full-content-${model.id}`;
    const selectedFile = fullContentFiles[model.id] ?? null;

    if (!selectedFile) {
      setFeedback('Selecione um video para salvar no conteudo completo.');
      return;
    }

    setActiveTask(taskId);
    updateTaskProgress(taskId, 'Enviando video exclusivo', 8);
    setFeedback(null);

    try {
      const videoUrl = await resolveAsset({
        file: selectedFile,
        fallbackUrl: '',
        taskId,
        label: 'Enviando video exclusivo',
        progressRange: [18, 86],
        options: buildVideoUploadOptions(selectedFile, {
          bucket: 'model-full-video',
          modelName: model.name,
          mediaType: 'video',
        }),
      });

      updateTaskProgress(taskId, 'Gravando rota exclusiva', 92);
      await addModelFullContentVideo({
        modelId: model.id,
        videoUrl,
      });

      updateTaskProgress(taskId, 'Conteudo completo salvo', 100);
      setFullContentFiles((current) => ({
        ...current,
        [model.id]: null,
      }));
      setFeedback('Video exclusivo salvo. O link da pagina ja esta pronto no painel.');
    } catch (error) {
      setFeedback(
        getTaskErrorMessage(error, 'Nao foi possivel salvar o video exclusivo agora.'),
      );
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handlePasteFullContentVideo = async (modelId: string) => {
    if (activeTask || clipboardReadingTargetId) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
      setFullContentPasteDialogModelId(modelId);
      return;
    }

    const targetId = `full-content-paste-${modelId}`;
    setClipboardReadingTargetId(targetId);

    try {
      const pastedFiles = await readAcceptedClipboardFiles('video/*', false);

      if (pastedFiles.length > 0) {
        setFullContentFiles((current) => ({
          ...current,
          [modelId]: pastedFiles[0] ?? null,
        }));
        return;
      }
      setFullContentPasteDialogModelId(modelId);
    } catch {
      setFullContentPasteDialogModelId(modelId);
    } finally {
      setClipboardReadingTargetId(null);
    }
  };

  const handleRemoveFullContentVideo = async (modelId: string, contentId: string) => {
    if (activeTask) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm('Tem certeza que deseja excluir este conteúdo completo?')
    ) {
      return;
    }

    const deleteAssetFiles = askDeleteAssetFiles(
      'Deseja tambem apagar o arquivo de video do storage/uploads?',
    );

    const taskId = `remove-full-content-${contentId}`;

    setActiveTask(taskId);
    setFeedback(null);

    try {
      await removeModelFullContentVideo(modelId, contentId, { deleteAssetFiles });
      setFeedback(
        deleteAssetFiles
          ? 'Video exclusivo removido e arquivo apagado do storage.'
          : 'Video exclusivo removido da pagina independente.',
      );
    } catch {
      setFeedback('Nao foi possivel remover o video exclusivo agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleGroupProofSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeTask) {
      return;
    }

    setActiveTask('group-proof');
    updateTaskProgress('group-proof', 'Preparando print', 8);
    setFeedback(null);

    try {
      const image = await resolveAsset({
        file: groupProofFile,
        fallbackUrl: groupProofForm.image,
        taskId: 'group-proof',
        label: 'Enviando print',
        progressRange: [12, 84],
        options: {
          bucket: 'group-proof',
          mediaType: 'image',
        },
      });

      if (!image) {
        setFeedback('Envie um print local ou informe a URL da imagem.');
        return;
      }

      updateTaskProgress('group-proof', 'Gravando print', 92);
      await addGroupProofItem({
        ...groupProofForm,
        image,
      });

      updateTaskProgress('group-proof', 'Print salvo', 100);
      setGroupProofForm(emptyGroupProofForm);
      setGroupProofFile(null);
      setFeedback('Print do grupo salvo com sucesso.');
    } catch {
      setFeedback('Nao foi possivel salvar o print agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleHeroBackgroundSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeTask) {
      return;
    }

    setActiveTask('hero-background');
    updateTaskProgress('hero-background', 'Preparando fundo', 8);
    setFeedback(null);

    try {
      const image = await resolveAsset({
        file: heroBackgroundFile,
        fallbackUrl: heroBackgroundForm.image,
        taskId: 'hero-background',
        label: 'Enviando fundo',
        progressRange: [12, 84],
        options: {
          bucket: 'hero-background',
          target: heroBackgroundForm.target,
          mediaType: 'image',
        },
      });

      if (!image) {
        setFeedback('Envie uma imagem local ou informe a URL do fundo.');
        return;
      }

      updateTaskProgress('hero-background', 'Gravando fundo', 92);
      await addHeroBackground({
        ...heroBackgroundForm,
        image,
      });

      updateTaskProgress('hero-background', 'Fundo salvo', 100);
      setHeroBackgroundForm(emptyHeroBackgroundForm);
      setHeroBackgroundFile(null);
      setFeedback('Fundo da home salvo com sucesso.');
    } catch {
      setFeedback('Nao foi possivel salvar o fundo da home agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleClearContent = async () => {
    if (activeTask) {
      return;
    }

    const deleteAssetFiles = askDeleteAssetFiles(
      'Deseja tambem apagar todos os arquivos de midia do storage/uploads?',
    );

    setActiveTask('clear');
    updateTaskProgress('clear', 'Limpando conteudo', 40);
    setFeedback(null);

    try {
      await clearSiteContent({ deleteAssetFiles });
      setModelForm(emptyModelForm);
      setMediaForm(emptyMediaForm);
      setGroupProofForm(emptyGroupProofForm);
      setHeroBackgroundForm(emptyHeroBackgroundForm);
      setModelFiles(emptyModelFiles);
      setMediaFiles(emptyMediaFiles);
      setInlineModelMediaDrafts({});
      setGroupProofFile(null);
      setHeroBackgroundFile(null);
      setExpandedModelId(null);
      setSelectedDesktopModelId(null);
      setMobileInlineMediaModalModelId(null);
      stopEditingModel();
      resetClearConfirmation();
      updateTaskProgress('clear', 'Conteudo limpo', 100);
      setFeedback(
        deleteAssetFiles
          ? 'Conteudo limpo e arquivos de midia apagados do storage.'
          : 'Conteudo limpo. A home agora mostra somente o que voce voltar a cadastrar.',
      );
    } catch {
      setFeedback('Nao foi possivel limpar o conteudo agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleTelegramCacheJob = async (mode: 'check' | 'warm') => {
    if (activeTask) {
      return;
    }

    const taskId = mode === 'check' ? 'telegram-cache-check' : 'telegram-cache-warm';

    setActiveTask(taskId);
    updateTaskProgress(
      taskId,
      mode === 'check' ? 'Verificando midias em cache' : 'Verificando midias do projeto',
      12,
    );
    setCacheWarmFeedback(null);
    setCacheWarmFeedbackTone('success');
    setCacheWarmStatus(null);
    setExpandedCacheGroups([]);

    try {
      const runJob =
        mode === 'check' ? checkTelegramMediaCache : warmTelegramMediaCache;
      const summary = await runJob((status) => {
        setCacheWarmStatus(normalizeStoredCacheWarmStatus(status));
        updateTaskProgress(
          taskId,
          status.currentStep ||
            (mode === 'check'
              ? 'Verificando midias em cache'
              : 'Enviando midias para cache'),
          status.progressPercent || 12,
        );
      });
      const normalizedSummary = normalizeStoredCacheWarmStatus(summary);
      setCacheWarmStatus(normalizedSummary);
      updateTaskProgress(
        taskId,
        mode === 'check' ? 'Verificacao do cache concluida' : 'Cache do Telegram concluido',
        100,
      );
      setCacheWarmFeedback(formatCacheStatusFeedback(normalizedSummary ?? summary));
      setCacheWarmFeedbackTone((normalizedSummary ?? summary).failed > 0 ? 'error' : 'success');
    } catch (error) {
      setCacheWarmFeedback(
        error instanceof Error && error.message
          ? normalizeCacheFeedbackMessage(error.message)
          : mode === 'check'
            ? 'Nao foi possivel verificar as midias em cache agora.'
            : 'Nao foi possivel enviar as midias para cache do Telegram agora.',
      );
      setCacheWarmFeedbackTone('error');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
    }
  };

  const handleWarmSingleCacheItem = async (item: TelegramCacheWarmItem) => {
    if (activeTask || singleCachePendingUrl) {
      return;
    }

    setSingleCachePendingUrl(item.assetUrl);
    setCacheWarmFeedback(null);
    setCacheWarmFeedbackTone('success');
    setCacheWarmStatus((current) =>
      current
        ? {
            ...current,
            currentStep: `Enviando ${item.assetLabel} para o cache do Telegram...`,
            currentAsset: item.assetLabel,
            progressPercent: Math.max(18, current.progressPercent || 0),
          }
        : current,
    );

    try {
      const response = await warmSingleTelegramMediaCache(item.assetUrl, item.mediaType);
      const nextItem = {
        ...response.item,
        reason: response.item.reason
          ? normalizeCacheReasonForDisplay(response.item.reason)
          : response.item.reason,
      };
      const message =
        nextItem.status === 'warmed'
          ? `${nextItem.assetLabel} enviada para cache com sucesso.`
          : nextItem.status === 'cached'
            ? `${nextItem.assetLabel} ja estava em cache.`
            : `Falha ao enviar ${nextItem.assetLabel}: ${normalizeCacheReasonForDisplay(nextItem.reason || '')}`;
      const tone = response.ok && nextItem.status !== 'failed' ? 'success' : 'error';

      setCacheWarmStatus((current) =>
        current
          ? buildUpdatedCacheWarmStatus({
              currentStatus: current,
              nextItem,
              message,
              level: tone === 'success' ? 'success' : 'error',
            })
          : current,
      );
      setCacheWarmFeedback(message);
      setCacheWarmFeedbackTone(tone);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? normalizeCacheFeedbackMessage(error.message)
          : `Nao foi possivel enviar ${item.assetLabel} para o cache agora.`;
      setCacheWarmFeedback(message);
      setCacheWarmFeedbackTone('error');
      setCacheWarmStatus((current) =>
        current
          ? buildUpdatedCacheWarmStatus({
              currentStatus: current,
              nextItem: {
                ...item,
                status: 'failed',
                reason: message,
              },
              message,
              level: 'error',
            })
          : current,
      );
    } finally {
      setSingleCachePendingUrl(null);
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    if (activeTask) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm('Tem certeza que deseja remover esta modelo do site?')
    ) {
      return;
    }

    const deleteAssetFiles = askDeleteAssetFiles(
      'Deseja tambem apagar todos os arquivos dessa modelo do storage/uploads?',
    );

    setActiveTask(`remove-model-${modelId}`);
    setFeedback(null);

    try {
      await removeModel(modelId, { deleteAssetFiles });
      setFullContentFiles((current) => {
        if (!(modelId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[modelId];
        return next;
      });

      if (editingModelId === modelId) {
        stopEditingModel();
      }

      if (expandedModelId === modelId) {
        setExpandedModelId(null);
      }

      if (selectedDesktopModelId === modelId) {
        setSelectedDesktopModelId(null);
      }

      if (mobileInlineMediaModalModelId === modelId) {
        setMobileInlineMediaModalModelId(null);
      }

      clearInlineMediaDraft(modelId);

      setFeedback(
        deleteAssetFiles
          ? 'Modelo removida e arquivos apagados do storage.'
          : 'Modelo removida do site.',
      );
    } catch {
      setFeedback('Nao foi possivel remover a modelo agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleToggleModelHomeVisibility = async (model: ModelProfile) => {
    if (activeTask) {
      return;
    }

    setActiveTask(`toggle-home-model-${model.id}`);
    setFeedback(null);

    try {
      await toggleModelHomeVisibility(model.id);
      setFeedback(
        model.hiddenOnHome
          ? 'Modelo exibida novamente na home.'
          : 'Modelo ocultada da home temporariamente.',
      );
    } catch {
      setFeedback('Nao foi possivel alterar a visibilidade da modelo na home.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleRemoveMedia = async (modelId: string, mediaId: string) => {
    if (activeTask) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm('Tem certeza que deseja excluir este conteúdo?')
    ) {
      return;
    }

    const deleteAssetFiles = askDeleteAssetFiles(
      'Deseja tambem apagar o arquivo dessa previa do storage/uploads?',
    );

    setActiveTask(`remove-media-${mediaId}`);
    setFeedback(null);

    try {
      await removeMediaFromModel(modelId, mediaId, { deleteAssetFiles });
      setFeedback(
        deleteAssetFiles
          ? 'Conteudo removido e arquivo apagado do storage.'
          : 'Conteudo removido da modelo.',
      );
    } catch {
      setFeedback('Nao foi possivel remover o conteudo agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleToggleMediaFavorite = async (
    modelId: string,
    mediaId: string,
    isFavorite: boolean,
  ) => {
    if (activeTask) {
      return;
    }

    setActiveTask(`toggle-favorite-media-${mediaId}`);
    setFeedback(null);

    try {
      await toggleModelMediaFavorite(modelId, mediaId);
      setFeedback(isFavorite ? 'Previa removida dos favoritos.' : 'Previa marcada como favorita.');
    } catch {
      setFeedback('Nao foi possivel atualizar o favorito da previa agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleRemoveGroupProof = async (itemId: string) => {
    if (activeTask) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm('Tem certeza que deseja excluir este print do grupo?')
    ) {
      return;
    }

    const deleteAssetFiles = askDeleteAssetFiles(
      'Deseja tambem apagar o arquivo desse print do storage/uploads?',
    );

    setActiveTask(`remove-group-${itemId}`);
    setFeedback(null);

    try {
      await removeGroupProofItem(itemId, { deleteAssetFiles });
      setFeedback(
        deleteAssetFiles
          ? 'Print removido e arquivo apagado do storage.'
          : 'Print removido da home.',
      );
    } catch {
      setFeedback('Nao foi possivel remover o print agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleRemoveHeroBackground = async (
    target: HeroBackgroundTarget,
    itemId: string,
  ) => {
    if (activeTask) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm('Tem certeza que deseja excluir este fundo da home?')
    ) {
      return;
    }

    const deleteAssetFiles = askDeleteAssetFiles(
      'Deseja tambem apagar o arquivo desse fundo do storage/uploads?',
    );

    setActiveTask(`remove-hero-${itemId}`);
    setFeedback(null);

    try {
      await removeHeroBackground(target, itemId, { deleteAssetFiles });
      setFeedback(
        deleteAssetFiles
          ? 'Fundo removido e arquivo apagado do storage.'
          : 'Fundo da home removido.',
      );
    } catch {
      setFeedback('Nao foi possivel remover o fundo agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleClearCacheWarmLog = () => {
    setCacheWarmStatus(null);
    setCacheWarmFeedback(null);
    setCacheWarmFeedbackTone('success');
    setExpandedCacheGroups([]);

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CACHE_WARM_STATUS_STORAGE_KEY);
      window.localStorage.removeItem(CACHE_WARM_FEEDBACK_STORAGE_KEY);
    }
  };

  const totalMedia = siteContent.models.reduce((total, model) => total + model.gallery.length, 0);
  const totalBackgrounds =
    siteContent.heroBackgrounds.mobile.length + siteContent.heroBackgrounds.desktop.length;
  const cacheWarmGroups = groupCacheItems(cacheWarmStatus?.items ?? []);
  const totalFullContentVideos = siteContent.models.reduce(
    (total, model) => total + (model.fullContentVideos?.length ?? 0),
    0,
  );
  const hiddenModelsCount = siteContent.models.filter((model) => model.hiddenOnHome).length;
  const normalizedModelSearchQuery = modelSearchQuery.trim().toLowerCase();
  const searchedModels = normalizedModelSearchQuery
    ? siteContent.models.filter((model) =>
        [model.name, model.handle, model.tagline]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedModelSearchQuery)),
      )
    : siteContent.models;
  const filteredModels = [...searchedModels].sort((left, right) => {
    if (modelListSort === 'az') {
      return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
    }

    const leftContentCount = left.gallery.length + (left.fullContentVideos?.length ?? 0);
    const rightContentCount = right.gallery.length + (right.fullContentVideos?.length ?? 0);

    if (modelListSort === 'content') {
      if (rightContentCount !== leftContentCount) {
        return rightContentCount - leftContentCount;
      }

      return right.name.localeCompare(left.name, 'pt-BR', { sensitivity: 'base' });
    }

    return siteContent.models.indexOf(right) - siteContent.models.indexOf(left);
  });
  const selectedDesktopModel =
    siteContent.models.find((model) => model.id === selectedDesktopModelId) ?? null;
  const isDesktopModelFocused = Boolean(selectedDesktopModel);
  const desktopShellClassName = isDesktopModelRailCollapsed
    ? 'xl:grid xl:grid-cols-[92px,minmax(0,1fr)] xl:gap-5'
    : 'xl:grid xl:grid-cols-[320px,minmax(0,1fr)] xl:gap-5';

  const renderInlineMediaEditorContent = (model: ModelProfile) => {
    const inlineMediaDraft = getInlineMediaDraft(model.id);
    const inlineMediaTaskId = `inline-media-${model.id}`;
    const fullContentItems = model.fullContentVideos || [];

    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),260px] xl:items-start">
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={inlineMediaDraft.title}
              onChange={(event) =>
                updateInlineMediaDraft(model.id, (current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className={fieldClassName()}
              placeholder="Titulo curto opcional"
              disabled={Boolean(activeTask)}
            />
            <input
              value={inlineMediaDraft.subtitle}
              onChange={(event) =>
                updateInlineMediaDraft(model.id, (current) => ({
                  ...current,
                  subtitle: event.target.value,
                }))
              }
              className={fieldClassName()}
              placeholder="Legenda opcional"
              disabled={Boolean(activeTask)}
            />
          </div>

          <MultiFileUploadField
            label="Arquivos de previas"
            accept="image/*,video/*"
            files={inlineMediaDraft.assets}
            onFilesChange={(files) =>
              updateInlineMediaDraft(model.id, (current) => ({
                ...current,
                assets: files,
              }))
            }
            onRemoveFile={(_file, index) =>
              updateInlineMediaDraft(model.id, (current) => {
                const removedFile = current.assets[index] ?? null;

                if (removedFile) {
                  applyVideoTrimSelection(removedFile, null);
                }

                return {
                  ...current,
                  assets: current.assets.filter((_, assetIndex) => assetIndex !== index),
                };
              })
            }
            renderPreviewFooter={renderVideoTrimFooter}
            helper="Selecione imagens e videos juntos. O conteudo entra direto nessa modelo."
            disabled={Boolean(activeTask)}
          />
        </div>

        <div className="grid gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] p-4 xl:self-start">
          <div className="grid gap-2 text-sm text-white/70">
            <div className="flex items-center justify-between gap-3">
              <span>Arquivos prontos</span>
              <strong className="text-white">{inlineMediaDraft.assets.length}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Videos exclusivos</span>
              <strong className="text-white">{fullContentItems.length}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Na home</span>
              <strong className="text-white">{model.hiddenOnHome ? 'Oculta' : 'Visivel'}</strong>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              void handleSaveMediaBatchForModel({
                model,
                files: inlineMediaDraft.assets,
                title: inlineMediaDraft.title,
                subtitle: inlineMediaDraft.subtitle,
                taskId: inlineMediaTaskId,
                successMessage: 'Previas salvas e ja disponiveis na home e no modal da modelo.',
                onSuccess: () => {
                  clearInlineMediaDraft(model.id);
                  setMobileInlineMediaModalModelId((current) =>
                    current === model.id ? null : current,
                  );
                },
              })
            }
            disabled={Boolean(activeTask)}
            className={buttonClassName()}
          >
            {getSubmitLabel(
              inlineMediaTaskId,
              'Adicionar previas nessa modelo',
              'Salvando previas...',
            )}
          </button>

          {getTaskProgress(inlineMediaTaskId) ? (
            <TaskProgressBar progress={getTaskProgress(inlineMediaTaskId)!} />
          ) : null}
        </div>
      </div>
    );
  };

  const renderModelManagementBody = (model: ModelProfile) => {
    const isEditing = editingModelId === model.id;
    const currentFullContentFile = fullContentFiles[model.id] ?? null;
    const fullContentTaskId = `full-content-${model.id}`;
    const fullContentItems = model.fullContentVideos || [];

    return (
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,420px),1fr] xl:items-start">
          <div className="w-full max-w-[420px] overflow-hidden rounded-[24px] border border-white/10 bg-black">
            <div className="aspect-[16/10]">
              <img
                src={model.coverImage}
                alt={model.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>

          <div className="min-w-0 self-start">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleToggleModelHomeVisibility(model)}
                disabled={Boolean(activeTask)}
                className={ghostButtonClassName()}
              >
                {model.hiddenOnHome ? 'Mostrar na home' : 'Ocultar da home'}
              </button>
              <button
                type="button"
                onClick={() => (isEditing ? stopEditingModel() : startEditingModel(model))}
                className={ghostButtonClassName()}
              >
                {isEditing ? 'Cancelar edicao' : 'Editar'}
              </button>
              <button
                type="button"
                onClick={() => void handleRemoveModel(model.id)}
                disabled={Boolean(activeTask)}
                className={dangerGhostButtonClassName()}
              >
                Remover
              </button>
            </div>

            {model.tagline ? (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">{model.tagline}</p>
            ) : null}
          </div>
        </div>

        {isEditing ? (
          <div className="grid gap-3 rounded-[24px] border border-white/10 bg-black/30 p-4 sm:grid-cols-2 sm:items-start">
            <input
              value={editingModelForm.name}
              onChange={(event) =>
                setEditingModelForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className={fieldClassName()}
              placeholder="Nome da modelo"
            />
            <input
              value={editingModelForm.handle}
              onChange={(event) =>
                setEditingModelForm((current) => ({
                  ...current,
                  handle: event.target.value,
                }))
              }
              className={fieldClassName()}
              placeholder="@usuario ou identificador"
            />
            <input
              value={editingModelForm.tagline}
              onChange={(event) =>
                setEditingModelForm((current) => ({
                  ...current,
                  tagline: event.target.value,
                }))
              }
              className={`sm:col-span-2 ${fieldClassName()}`}
              placeholder="Frase curta opcional"
            />

            <UploadField
              label="Foto de perfil"
              accept="image/*"
              file={editingModelFiles.profileImage}
              urlValue={editingModelForm.profileImage}
              onFileChange={(file) =>
                setEditingModelFiles((current) => ({
                  ...current,
                  profileImage: file,
                }))
              }
              onUrlChange={(value) =>
                setEditingModelForm((current) => ({
                  ...current,
                  profileImage: value,
                }))
              }
              urlPlaceholder="URL opcional da foto de perfil"
              previewShape="circle"
              previewAlt="Preview da foto de perfil"
            />

            <UploadField
              label="Imagem de capa"
              accept="image/*"
              file={editingModelFiles.coverImage}
              urlValue={editingModelForm.coverImage}
              onFileChange={(file) =>
                setEditingModelFiles((current) => ({
                  ...current,
                  coverImage: file,
                }))
              }
              onUrlChange={(value) =>
                setEditingModelForm((current) => ({
                  ...current,
                  coverImage: value,
                }))
              }
              urlPlaceholder="URL opcional da capa"
              previewShape="landscape"
              previewAlt="Preview da capa"
            />

            <button
              type="button"
              onClick={() => void handleUpdateModel(model.id)}
              disabled={Boolean(activeTask)}
              className={`sm:col-span-2 ${buttonClassName()}`}
            >
              {getSubmitLabel(
                `update-model-${model.id}`,
                'Salvar alteracoes',
                'Salvando alteracoes...',
              )}
            </button>

            {getTaskProgress(`update-model-${model.id}`) ? (
              <div className="sm:col-span-2">
                <TaskProgressBar progress={getTaskProgress(`update-model-${model.id}`)!} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="hidden rounded-[24px] border border-white/10 bg-black/25 p-4 xl:block">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <span className={labelClassName()}>Adicionar previas</span>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                Envie novas imagens e videos direto nessa modelo aberta, sem voltar para a area
                geral do painel.
              </p>
            </div>
            <span className="text-xs text-white/45">
              {model.gallery.length} previa(s) cadastrada(s)
            </span>
          </div>

          <div className="mt-4">{renderInlineMediaEditorContent(model)}</div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-black/25 p-4 xl:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className={labelClassName()}>Adicionar previas</span>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                Abra um dialog para adicionar novos videos e imagens nessa modelo.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMobileInlineMediaModalModelId(model.id)}
              className={buttonClassName()}
            >
              Abrir
            </button>
          </div>
        </div>

        <AdminMobileDialog
          isOpen={mobileInlineMediaModalModelId === model.id}
          title={`Adicionar previas em ${model.name}`}
          onClose={() => setMobileInlineMediaModalModelId(null)}
        >
          {renderInlineMediaEditorContent(model)}
        </AdminMobileDialog>

        <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className={labelClassName()}>Conteudo completo</span>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                Adicione videos exclusivos com link proprio e acompanhe as visualizacoes.
              </p>
            </div>
            <span className="text-xs text-white/45">
              {fullContentItems.length} video(s) exclusivo(s)
            </span>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr),280px] xl:items-start">
            <div>
              {fullContentItems.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-2">
                  {fullContentItems.map((item) => {
                    const itemHref = getModelFullContentHref(model, item.routeToken);
                    const versionedVideoUrl = getVersionedAssetUrl(item.videoUrl);

                    return (
                      <article
                        key={item.id}
                        className="relative overflow-hidden rounded-[20px] border border-white/10 bg-black/70"
                      >
                        <div className="aspect-[16/10] bg-zinc-950">
                          <AutoplayMedia
                            type="video"
                            src={versionedVideoUrl}
                            poster={model.coverImage}
                            alt={item.title}
                            className="h-full w-full"
                            playMode="hover"
                            preloadStrategy="metadata"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveFullContentVideo(model.id, item.id)}
                          disabled={Boolean(activeTask)}
                          className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[10px] text-white/80 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          X
                        </button>
                        <div className="grid gap-2 px-3 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white/85">
                              {item.title}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/45">
                              {item.views} visualizacao(oes)
                            </div>
                          </div>
                          <a
                            href={itemHref}
                            target="_blank"
                            rel="noreferrer"
                            className="line-clamp-2 break-all text-[11px] text-rose-200 underline-offset-4 transition hover:text-white hover:underline"
                          >
                            {itemHref}
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              openExistingVideoTrimDialog({
                                assetUrl: item.videoUrl,
                                previewSrc: versionedVideoUrl,
                                title: item.title,
                                taskId: `trim-full-content-${item.id}`,
                                successMessage: 'Video exclusivo cortado e substituido com sucesso.',
                              })
                            }
                            disabled={Boolean(activeTask)}
                            className="inline-flex min-h-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cortar video
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm leading-6 text-zinc-400">
                  Nenhum video exclusivo cadastrado ainda para essa modelo.
                </div>
              )}
            </div>

            <div className="grid gap-3 rounded-[20px] border border-white/10 bg-white/[0.03] p-4 xl:self-start">
              <label
                tabIndex={Boolean(activeTask) ? -1 : 0}
                onPaste={(event) => {
                  if (activeTask) {
                    return;
                  }

                  const pastedFiles = getAcceptedClipboardFiles(event, 'video/*', false);

                  if (pastedFiles.length === 0) {
                    return;
                  }

                  event.preventDefault();
                  setFullContentFiles((current) => ({
                    ...current,
                    [model.id]: pastedFiles[0] ?? null,
                  }));
                }}
                onKeyDown={(event) => {
                  if (Boolean(activeTask)) {
                    return;
                  }

                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    const input = event.currentTarget.querySelector('input[type=\"file\"]');
                    input?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  }
                }}
                className="cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-white/15"
              >
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  disabled={Boolean(activeTask)}
                  onChange={(event) =>
                    setFullContentFiles((current) => ({
                      ...current,
                      [model.id]: event.target.files?.[0] ?? null,
                    }))
                  }
                />
                <div className="grid gap-3">
                  <span className="block min-w-0 truncate">
                    {currentFullContentFile
                      ? `Selecionado: ${currentFullContentFile.name}`
                      : 'Selecionar video exclusivo'}
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handlePasteFullContentVideo(model.id);
                      }}
                      disabled={
                        Boolean(activeTask) ||
                        clipboardReadingTargetId === `full-content-paste-${model.id}`
                      }
                      className="inline-flex min-h-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {clipboardReadingTargetId === `full-content-paste-${model.id}`
                        ? 'Colando...'
                        : 'Colar'}
                    </button>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                      Ctrl+V
                    </span>
                  </div>
                </div>
              </label>

              <p className="text-xs leading-5 text-white/45">
                Toque em <strong className="text-white/70">Colar</strong> no iPhone.
              </p>

              {currentFullContentFile ? (
                <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-[20px] border border-white/10 bg-black">
                  <PendingMediaPreview
                    file={currentFullContentFile}
                    aspectClassName="aspect-video"
                    footer={renderVideoTrimFooter(currentFullContentFile)}
                    onRemove={() => {
                      applyVideoTrimSelection(currentFullContentFile, null);
                      setFullContentFiles((current) => ({
                        ...current,
                        [model.id]: null,
                      }));
                    }}
                  />
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleSaveFullContentVideo(model)}
                disabled={Boolean(activeTask)}
                className={buttonClassName()}
              >
                {getSubmitLabel(
                  fullContentTaskId,
                  'Adicionar conteudo completo',
                  'Salvando conteudo completo...',
                )}
              </button>

              {getTaskProgress(fullContentTaskId) ? (
                <TaskProgressBar progress={getTaskProgress(fullContentTaskId)!} />
              ) : null}

              <ClipboardPasteDialog
                isOpen={fullContentPasteDialogModelId === model.id}
                title={`Colar video exclusivo em ${model.name}`}
                accept="video/*"
                onFiles={(pastedFiles) =>
                  setFullContentFiles((current) => ({
                    ...current,
                    [model.id]: pastedFiles[0] ?? null,
                  }))
                }
                onClose={() => setFullContentPasteDialogModelId(null)}
              />
            </div>
          </div>
        </div>

        {model.gallery.length === 0 ? (
          <p className="text-sm text-zinc-400">Essa modelo ainda nao tem conteudo cadastrado.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
            {model.gallery.map((item) => {
              const versionedMediaSrc =
                item.type === 'video' && item.src ? getVersionedAssetUrl(item.src) : item.src;

              return (
              <div key={item.id} className="relative overflow-hidden rounded-2xl">
                <div className="aspect-[4/5] bg-zinc-950">
                  <AutoplayMedia
                    type={item.type}
                    src={versionedMediaSrc}
                    poster={item.thumbnail}
                    alt={item.title}
                    className="h-full w-full"
                    playMode="hover"
                    preloadStrategy="metadata"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleToggleMediaFavorite(model.id, item.id, Boolean(item.favorite))
                  }
                  disabled={Boolean(activeTask)}
                  title={item.favorite ? 'Remover dos favoritos' : 'Favoritar previa'}
                  className={`absolute left-2 top-2 rounded-full border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60 ${
                    item.favorite
                      ? 'border-amber-300/40 bg-amber-400/20 text-amber-200'
                      : 'border-white/10 bg-black/55 text-white/60'
                  }`}
                >
                  <StarIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemoveMedia(model.id, item.id)}
                  disabled={Boolean(activeTask)}
                  className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[10px] text-white/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  X
                </button>
                {item.type === 'video' && item.src ? (
                  <button
                    type="button"
                    onClick={() =>
                      openExistingVideoTrimDialog({
                        assetUrl: item.src || '',
                        previewSrc: versionedMediaSrc || '',
                        title: item.title,
                        taskId: `trim-media-${item.id}`,
                        successMessage: 'Previa em video cortada e substituida com sucesso.',
                      })
                    }
                    disabled={Boolean(activeTask)}
                    className="absolute bottom-2 left-2 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cortar
                  </button>
                ) : null}
              </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="mx-auto max-w-[1640px] px-3 py-4 sm:px-5 sm:py-6 xl:px-8">
        <div className={desktopShellClassName}>
          <aside className="hidden xl:block xl:h-fit xl:sticky xl:top-6">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
              <div
                className={`flex items-start gap-2 ${isDesktopModelRailCollapsed ? 'justify-center px-0 pb-2' : 'justify-between px-1 pb-3'}`}
              >
                {!isDesktopModelRailCollapsed ? (
                  <div className="min-w-0">
                    <span className={labelClassName()}>Modelos</span>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      Selecione uma modelo para abrir a gestao completa no painel central.
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() =>
                    setIsDesktopModelRailCollapsed((current) => !current)
                  }
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-lg font-semibold text-white/75 transition hover:bg-white/[0.06] ${
                    isDesktopModelRailCollapsed ? 'mx-auto' : ''
                  }`}
                  aria-label={
                    isDesktopModelRailCollapsed
                      ? 'Expandir lista de modelos'
                      : 'Recolher lista de modelos'
                  }
                  title={
                    isDesktopModelRailCollapsed
                      ? 'Expandir lista de modelos'
                      : 'Recolher lista de modelos'
                  }
                >
                  {isDesktopModelRailCollapsed ? '›' : '‹'}
                </button>
              </div>

              {!isDesktopModelRailCollapsed ? (
                <div className="grid gap-2 pb-3">
                  <input
                    value={modelSearchQuery}
                    onChange={(event) => setModelSearchQuery(event.target.value)}
                    className={fieldClassName()}
                    placeholder="Pesquisar modelo..."
                  />
                  <select
                    value={modelListSort}
                    onChange={(event) => setModelListSort(event.target.value as ModelListSort)}
                    className={fieldClassName()}
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="latest" className="bg-zinc-950 text-white">Ultimas add</option>
                    <option value="az" className="bg-zinc-950 text-white">A - Z</option>
                    <option value="content" className="bg-zinc-950 text-white">Com mais conteudo</option>
                  </select>
                </div>
              ) : null}

              {filteredModels.length > 0 ? (
                <div className="hide-scrollbar max-h-[calc(100vh-80px)] space-y-2 overflow-y-auto pr-1">
                  {filteredModels.map((model) => {
                    const contentCounts = getModelContentCounts(model);
                    const isSelected = selectedDesktopModel?.id === model.id;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          if (selectedDesktopModelId === model.id) {
                            setSelectedDesktopModelId(null);
                            setExpandedModelId(null);
                            return;
                          }

                          setSelectedDesktopModelId(model.id);
                          setExpandedModelId(model.id);
                          setOpenSections((current) => ({ ...current, models: true }));
                        }}
                        className={`group relative flex w-full items-center rounded-[22px] text-left transition ${
                          isDesktopModelRailCollapsed
                            ? isSelected
                              ? 'justify-center border-transparent bg-transparent px-1.5 py-2.5'
                              : 'justify-center border-transparent bg-transparent px-1.5 py-2.5 hover:bg-white/[0.04]'
                            : isSelected
                              ? 'gap-3 border border-rose-400/35 bg-gradient-to-r from-rose-600/16 to-violet-600/16 px-3 py-3'
                              : 'gap-3 border border-white/10 bg-white/[0.03] px-3 py-3 hover:bg-white/[0.06]'
                        }`}
                        title={model.name}
                      >
                        {isDesktopModelRailCollapsed && isSelected ? (
                          <span className="absolute left-0 top-1/2 h-9 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-rose-400 to-violet-400 opacity-95" />
                        ) : null}

                        <div
                          className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black transition ${
                            isDesktopModelRailCollapsed
                              ? isSelected
                                ? 'ring-2 ring-rose-300/80 shadow-[0_0_0_4px_rgba(244,114,182,0.12),0_16px_36px_rgba(139,92,246,0.24)]'
                                : 'ring-1 ring-white/10 group-hover:ring-white/20'
                              : 'border border-white/10'
                          }`}
                        >
                          <img
                            src={model.profileImage}
                            alt={model.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>

                        {!isDesktopModelRailCollapsed ? (
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-semibold text-white">
                              {model.name}
                            </div>
                            {model.handle ? (
                              <div className="truncate text-sm text-white/58">{model.handle}</div>
                            ) : null}
                            <div className="mt-1 truncate text-[10px] text-white/60">
                              {contentCounts.previews} previas | {contentCounts.images} imagens | {contentCounts.exclusives} exclusivos
                              {model.hiddenOnHome ? ' | Oculta' : ''}
                            </div>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm leading-6 text-zinc-400">
                  {siteContent.models.length === 0
                    ? 'Nenhuma modelo cadastrada ainda.'
                    : 'Nenhuma modelo encontrada para essa busca.'}
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0">
        <header className="rounded-[30px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-6 xl:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <a
                href={getHomePath()}
                className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50"
              >
                Voltar para o site
              </a>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl xl:text-[2.8rem]">
                AllPrivacy Admin
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300 xl:text-[15px]">
                Painel protegido com upload local, preview visual e blocos mais compactos no
                celular.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:min-w-[420px] xl:justify-end">
              <a href={getAdminCommentsPath()} className={ghostButtonClassName()}>
                Comentarios
              </a>
              <button
                type="button"
                onClick={() => void onLogout()}
                className={ghostButtonClassName()}
              >
                Sair
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsClearConfirmOpen(true);
                  setIsClearConfirmArmed(false);
                  setClearCaptchaChallenge(createClearCaptchaChallenge());
                  setClearCaptchaInput('');
                }}
                disabled={Boolean(activeTask) || isLoading}
                className={ghostButtonClassName()}
              >
                {activeTask === 'clear' ? 'Limpando...' : 'Limpar tudo'}
              </button>
            </div>
          </div>

          {isClearConfirmOpen ? (
            <div className="mt-4 grid gap-3 rounded-[24px] border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-50">
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-100/80">
                  Confirmacao obrigatoria
                </span>
                <p className="leading-6 text-red-50/90">
                  Essa acao apaga todo o conteudo salvo no projeto. As midias em{' '}
                  <code className="rounded bg-black/20 px-1 py-0.5 text-red-50">storage/uploads</code>{' '}
                  podem ser mantidas ou apagadas na confirmacao final.
                </p>
              </div>

              {!isClearConfirmArmed ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setIsClearConfirmArmed(true)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-300/25 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-50 transition hover:bg-red-500/20"
                  >
                    Entendi, continuar
                  </button>
                  <button
                    type="button"
                    onClick={resetClearConfirmation}
                    className={ghostButtonClassName()}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <span className={labelClassName()}>Captcha simples</span>
                    <p className="text-sm text-red-50/90">
                      Quanto e {clearCaptchaChallenge.left} + {clearCaptchaChallenge.right}?
                    </p>
                    <input
                      inputMode="numeric"
                      value={clearCaptchaInput}
                      onChange={(event) => setClearCaptchaInput(event.target.value)}
                      className={fieldClassName()}
                      placeholder="Digite a resposta"
                      disabled={Boolean(activeTask)}
                    />
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleClearContent()}
                      disabled={
                        Boolean(activeTask) ||
                        isLoading ||
                        Number(clearCaptchaInput) !== clearCaptchaChallenge.answer
                      }
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-300/25 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-50 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeTask === 'clear' ? 'Limpando...' : 'Apagar todo o conteudo'}
                    </button>
                    <button
                      type="button"
                      onClick={resetClearConfirmation}
                      className={ghostButtonClassName()}
                      disabled={Boolean(activeTask)}
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:flex xl:flex-wrap">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Modelos: {siteContent.models.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Midias: {totalMedia}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Exclusivos: {totalFullContentVideos}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Ocultas: {hiddenModelsCount}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Prints: {siteContent.groupProofItems.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Fundos: {totalBackgrounds}
            </span>
            {isSaving ? (
              <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100">
                Salvando em disco...
              </span>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-[24px] border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {feedback ? (
          <div className="mt-4 rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {feedback}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
            <div className={`grid gap-4 2xl:grid-cols-[minmax(0,1fr),minmax(0,0.95fr)] ${isDesktopModelFocused ? 'xl:hidden' : ''}`}>
              <div className="space-y-4">
          <AdminSection
            title="Adicionar modelo"
            sectionId="admin-section-model"
            isOpen={openSections.model}
            onToggle={() => toggleSection('model')}
          >
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void handleModelSubmit(event)}>
              <input
                value={modelForm.name}
                onChange={(event) =>
                  setModelForm((current) => ({ ...current, name: event.target.value }))
                }
                className={fieldClassName()}
                placeholder="Nome da modelo"
                disabled={Boolean(activeTask) || isLoading}
              />
              <input
                value={modelForm.handle}
                onChange={(event) =>
                  setModelForm((current) => ({ ...current, handle: event.target.value }))
                }
                className={fieldClassName()}
                placeholder="@usuario ou identificador"
                disabled={Boolean(activeTask) || isLoading}
              />
              <input
                value={modelForm.tagline}
                onChange={(event) =>
                  setModelForm((current) => ({ ...current, tagline: event.target.value }))
                }
                className={`sm:col-span-2 ${fieldClassName()}`}
                placeholder="Frase curta opcional"
                disabled={Boolean(activeTask) || isLoading}
              />

              <UploadField
                label="Foto de perfil"
                accept="image/*"
                file={modelFiles.profileImage}
                urlValue={modelForm.profileImage}
                onFileChange={(file) =>
                  setModelFiles((current) => ({ ...current, profileImage: file }))
                }
                onUrlChange={(value) =>
                  setModelForm((current) => ({ ...current, profileImage: value }))
                }
                urlPlaceholder="URL opcional da foto de perfil"
                helper="Essa imagem aparece no circulo da home."
                disabled={Boolean(activeTask) || isLoading}
                previewShape="circle"
                previewAlt="Preview da foto de perfil"
              />

              <UploadField
                label="Imagem de capa"
                accept="image/*"
                file={modelFiles.coverImage}
                urlValue={modelForm.coverImage}
                onFileChange={(file) =>
                  setModelFiles((current) => ({ ...current, coverImage: file }))
                }
                onUrlChange={(value) =>
                  setModelForm((current) => ({ ...current, coverImage: value }))
                }
                urlPlaceholder="URL opcional da capa"
                helper="Essa imagem abre no topo do modal da modelo."
                disabled={Boolean(activeTask) || isLoading}
                previewShape="landscape"
                previewAlt="Preview da capa"
              />

              <button
                type="submit"
                disabled={Boolean(activeTask) || isLoading}
                className={`sm:col-span-2 ${buttonClassName()}`}
              >
                {getSubmitLabel('model', 'Salvar modelo', 'Salvando modelo...')}
              </button>

              {getTaskProgress('model') ? (
                <div className="sm:col-span-2">
                  <TaskProgressBar progress={getTaskProgress('model')!} />
                </div>
              ) : null}
            </form>
          </AdminSection>

          <AdminSection
            title="Adicionar conteudo"
            countLabel={siteContent.models.length === 0 ? 'Sem modelos' : undefined}
            sectionId="admin-section-media"
            isOpen={openSections.media}
            onToggle={() => toggleSection('media')}
          >
            <form className="grid gap-3" onSubmit={(event) => void handleMediaSubmit(event)}>
              <ModelPicker
                models={siteContent.models}
                selectedId={mediaForm.modelId}
                onSelect={(modelId) =>
                  setMediaForm((current) => ({
                    ...current,
                    modelId,
                  }))
                }
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={mediaForm.title}
                  onChange={(event) =>
                    setMediaForm((current) => ({ ...current, title: event.target.value }))
                  }
                  className={fieldClassName()}
                  placeholder="Titulo curto opcional"
                  disabled={Boolean(activeTask) || isLoading}
                />
                <input
                  value={mediaForm.subtitle}
                  onChange={(event) =>
                    setMediaForm((current) => ({ ...current, subtitle: event.target.value }))
                  }
                  className={fieldClassName()}
                  placeholder="Legenda opcional"
                  disabled={Boolean(activeTask) || isLoading}
                />
              </div>

              <MultiFileUploadField
                label="Arquivos de conteudo"
                accept="image/*,video/*"
                files={mediaFiles.assets}
                onFilesChange={(files) =>
                  setMediaFiles((current) => ({
                    ...current,
                    assets: files,
                  }))
                }
                onRemoveFile={(_file, index) =>
                  setMediaFiles((current) => {
                    const removedFile = current.assets[index] ?? null;

                    if (removedFile) {
                      applyVideoTrimSelection(removedFile, null);
                    }

                    return {
                      ...current,
                      assets: current.assets.filter((_, assetIndex) => assetIndex !== index),
                    };
                  })
                }
                renderPreviewFooter={renderVideoTrimFooter}
                helper="Selecione imagens e videos juntos. Se quiser enviar um unico arquivo, use este mesmo campo."
                disabled={Boolean(activeTask) || isLoading}
              />

              <button
                type="submit"
                disabled={Boolean(activeTask) || isLoading || siteContent.models.length === 0}
                className={buttonClassName()}
              >
                {getSubmitLabel('media', 'Salvar conteudo', 'Salvando conteudo...')}
              </button>

              {getTaskProgress('media') ? (
                <TaskProgressBar progress={getTaskProgress('media')!} />
              ) : null}
            </form>
          </AdminSection>

              </div>
              <div className="space-y-4">

          <AdminSection
            title="Fundos da home"
            countLabel={`${totalBackgrounds} fundo(s)`}
            sectionId="admin-section-backgrounds"
            isOpen={openSections.backgrounds}
            onToggle={() => toggleSection('backgrounds')}
          >
            <form className="grid gap-3" onSubmit={(event) => void handleHeroBackgroundSubmit(event)}>
              <TargetSwitch
                value={heroBackgroundForm.target}
                onChange={(target) =>
                  setHeroBackgroundForm((current) => ({
                    ...current,
                    target,
                  }))
                }
              />

              <input
                value={heroBackgroundForm.title}
                onChange={(event) =>
                  setHeroBackgroundForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className={fieldClassName()}
                placeholder="Titulo opcional do fundo"
                disabled={Boolean(activeTask) || isLoading}
              />

              <UploadField
                label="Imagem de fundo"
                accept="image/*"
                file={heroBackgroundFile}
                urlValue={heroBackgroundForm.image}
                onFileChange={setHeroBackgroundFile}
                onUrlChange={(value) =>
                  setHeroBackgroundForm((current) => ({
                    ...current,
                    image: value,
                  }))
                }
                urlPlaceholder="URL opcional do fundo"
                helper="No celular e no desktop o sistema sorteia do grupo correspondente."
                disabled={Boolean(activeTask) || isLoading}
                previewShape="landscape"
                previewAlt="Preview do fundo"
              />

              <button
                type="submit"
                disabled={Boolean(activeTask) || isLoading}
                className={buttonClassName()}
              >
                {getSubmitLabel('hero-background', 'Salvar fundo', 'Salvando fundo...')}
              </button>

              {getTaskProgress('hero-background') ? (
                <TaskProgressBar progress={getTaskProgress('hero-background')!} />
              ) : null}
            </form>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {(['mobile', 'desktop'] as const).map((target) => (
                <div
                  key={target}
                  className="rounded-[24px] border border-white/10 bg-black/25 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/60">
                      {target === 'mobile' ? 'Mobile' : 'Desktop'}
                    </h3>
                    <span className="text-xs text-white/45">
                      {siteContent.heroBackgrounds[target].length} fundo(s)
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {siteContent.heroBackgrounds[target].map((item) => (
                      <article
                        key={item.id}
                        className="overflow-hidden rounded-[22px] border border-white/10 bg-black"
                      >
                        <div className="aspect-[16/10]">
                          <img
                            src={item.image}
                            alt={item.title || `Fundo ${target}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 px-3 py-3">
                          <span className="truncate text-xs text-white/75">
                            {item.title || `Fundo ${target}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveHeroBackground(target, item.id)}
                            disabled={Boolean(activeTask)}
                            className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Remover
                          </button>
                        </div>
                      </article>
                    ))}

                    {siteContent.heroBackgrounds[target].length === 0 ? (
                      <p className="text-sm text-zinc-400">
                        Nenhum fundo cadastrado para {target === 'mobile' ? 'mobile' : 'desktop'}.
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </AdminSection>

          <AdminSection
            title="Prints do grupo"
            countLabel={`${siteContent.groupProofItems.length} print(s)`}
            sectionId="admin-section-proofs"
            isOpen={openSections.proofs}
            onToggle={() => toggleSection('proofs')}
          >
            <form className="grid gap-3" onSubmit={(event) => void handleGroupProofSubmit(event)}>
              <input
                value={groupProofForm.title}
                onChange={(event) =>
                  setGroupProofForm((current) => ({ ...current, title: event.target.value }))
                }
                className={fieldClassName()}
                placeholder="Titulo opcional do print"
                disabled={Boolean(activeTask) || isLoading}
              />

              <UploadField
                label="Print do grupo"
                accept="image/*"
                file={groupProofFile}
                urlValue={groupProofForm.image}
                onFileChange={setGroupProofFile}
                onUrlChange={(value) =>
                  setGroupProofForm((current) => ({ ...current, image: value }))
                }
                urlPlaceholder="URL opcional do print"
                helper="Ideal para subir capturas reais do grupo direto do seu computador."
                disabled={Boolean(activeTask) || isLoading}
                previewShape="portrait"
                previewAlt="Preview do print"
              />

              <button
                type="submit"
                disabled={Boolean(activeTask) || isLoading}
                className={buttonClassName()}
              >
                {getSubmitLabel('group-proof', 'Adicionar print', 'Salvando print...')}
              </button>

              {getTaskProgress('group-proof') ? (
                <TaskProgressBar progress={getTaskProgress('group-proof')!} />
              ) : null}
            </form>

            <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-auto pb-1">
              {siteContent.groupProofItems.map((item) => (
                <article
                  key={item.id}
                  className="w-[150px] shrink-0 overflow-hidden rounded-[22px] border border-white/10 bg-black"
                >
                  <div className="aspect-[9/16]">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-3">
                    <span className="truncate text-xs text-white/75">
                      {item.title || 'Print'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRemoveGroupProof(item.id)}
                      disabled={Boolean(activeTask)}
                      className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      X
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </AdminSection>
              </div>
            </div>

          <AdminSection
            title="Modelos cadastradas"
            subtitle="Abra apenas a modelo que quiser editar ou revisar."
            countLabel={`${siteContent.models.length} modelo(s)`}
            sectionId="admin-section-models"
            isOpen={openSections.models}
            onToggle={() => toggleSection('models')}
            className="xl:hidden"
          >
            <div className="grid gap-3 xl:hidden">
              <div className="grid gap-2">
                <input
                  value={modelSearchQuery}
                  onChange={(event) => setModelSearchQuery(event.target.value)}
                  className={fieldClassName()}
                  placeholder="Pesquisar modelo..."
                />
                <select
                  value={modelListSort}
                  onChange={(event) => setModelListSort(event.target.value as ModelListSort)}
                  className={fieldClassName()}
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="latest" className="bg-zinc-950 text-white">Ultimas add</option>
                  <option value="az" className="bg-zinc-950 text-white">A - Z</option>
                  <option value="content" className="bg-zinc-950 text-white">Com mais conteudo</option>
                </select>
              </div>

              {filteredModels.map((model) => {
                const isExpanded = expandedModelId === model.id;
                const contentCounts = getModelContentCounts(model);

                return (
                  <article
                    key={model.id}
                    className="rounded-[24px] border border-white/10 bg-black/25 p-4"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedModelId((current) => (current === model.id ? null : model.id))
                      }
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-black">
                          <img
                            src={model.profileImage}
                            alt={model.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>

                        <div className="min-w-0">
                          <h3 className="truncate font-display text-xl font-semibold text-white">
                            {model.name}
                          </h3>
                          {model.handle ? (
                            <p className="truncate text-sm text-zinc-300">{model.handle}</p>
                          ) : null}
                          <p className="mt-1 text-[10px] tracking-[0.08em] text-white/45 sm:text-[11px]">
                            {contentCounts.previews} previas | {contentCounts.images} imagens | {contentCounts.exclusives} exclusivos
                          </p>
                          {model.hiddenOnHome ? (
                            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-200/85">
                              Oculta da home
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <span className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                        {isExpanded ? 'Fechar' : 'Abrir'}
                      </span>
                    </button>

                    {isExpanded ? <div className="mt-4">{renderModelManagementBody(model)}</div> : null}
                  </article>
                );
              })}
            </div>

            {!isLoading && filteredModels.length === 0 ? (
              <p className="text-sm text-zinc-400">
                {siteContent.models.length === 0
                  ? 'Nenhuma modelo cadastrada ainda. A home ficara vazia ate voce adicionar as primeiras.'
                  : 'Nenhuma modelo encontrada para essa busca.'}
              </p>
            ) : null}
          </AdminSection>

          {selectedDesktopModel ? (
            <section className="hidden xl:block rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
              {(() => {
                const contentCounts = getModelContentCounts(selectedDesktopModel);

                return (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black">
                      <img
                        src={selectedDesktopModel.profileImage}
                        alt={selectedDesktopModel.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate font-display text-3xl font-semibold text-white">
                        {selectedDesktopModel.name}
                      </h3>
                      {selectedDesktopModel.handle ? (
                        <p className="mt-1 truncate text-base text-zinc-300">
                          {selectedDesktopModel.handle}
                        </p>
                      ) : null}
                      <div className="hide-scrollbar mt-3 flex flex-nowrap gap-1 overflow-x-auto pr-1 text-[10px] text-white/70">
                        <span className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {contentCounts.previews} previas
                        </span>
                        <span className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {contentCounts.images} imagens
                        </span>
                        <span className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
                          {contentCounts.exclusives} exclusivos
                        </span>
                        {selectedDesktopModel.hiddenOnHome ? (
                          <span className="whitespace-nowrap rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-amber-100">
                            Oculta da home
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                {renderModelManagementBody(selectedDesktopModel)}
              </div>
                );
              })()}
            </section>
          ) : null}

          <section
            id="admin-section-telegram-cache"
            className={`rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-5 xl:p-6 ${isDesktopModelFocused ? 'xl:hidden' : ''}`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">
                  Cache do Telegram
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                  Verifica apenas as previas das modelos e os arquivos da pasta bot, pula o
                  que ja estiver em cache e envia apenas o que ainda faltar para o Telegram.
                </p>
              </div>

              <div className="grid gap-2 sm:min-w-[320px]">
                <button
                  type="button"
                  onClick={() => void handleTelegramCacheJob('check')}
                  disabled={Boolean(activeTask) || isLoading}
                  className={ghostButtonClassName()}
                >
                  {getSubmitLabel(
                    'telegram-cache-check',
                    'Verificar midias em cache',
                    'Verificando cache...',
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTelegramCacheJob('warm')}
                  disabled={Boolean(activeTask) || isLoading}
                  className={buttonClassName()}
                >
                  {getSubmitLabel(
                    'telegram-cache-warm',
                    'Enviar toda midia para cache do telegram',
                    'Enviando para cache...',
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleClearCacheWarmLog}
                  disabled={Boolean(activeTask) || (!cacheWarmStatus && !cacheWarmFeedback)}
                  className={ghostButtonClassName()}
                >
                  Limpar log
                </button>
              </div>
            </div>

            {getTaskProgress('telegram-cache-check') ? (
              <div className="mt-4">
                <TaskProgressBar progress={getTaskProgress('telegram-cache-check')!} />
              </div>
            ) : null}

            {getTaskProgress('telegram-cache-warm') ? (
              <div className="mt-4">
                <TaskProgressBar progress={getTaskProgress('telegram-cache-warm')!} />
              </div>
            ) : null}

            {cacheWarmStatus ? (
              <div className="mt-4 grid gap-3 rounded-[22px] border border-white/10 bg-black/25 p-4">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium leading-4 text-white/75">
                    Verificadas: {cacheWarmStatus.checked}/{cacheWarmStatus.total}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium leading-4 text-white/75">
                    Modo: {cacheWarmStatus.mode === 'check' ? 'Verificar' : 'Enviar'}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium leading-4 text-white/75">
                    Ja em cache: {cacheWarmStatus.alreadyCached}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium leading-4 text-white/75">
                    Enviadas: {cacheWarmStatus.warmed}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-medium leading-4 ${
                      cacheWarmStatus.failed > 0
                        ? 'border-red-500/25 bg-red-500/10 text-red-100'
                        : 'border-white/10 bg-white/[0.04] text-white/75'
                    }`}
                  >
                    Falhas: {cacheWarmStatus.failed}
                  </span>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white/80">
                  <div className="font-medium leading-6 text-white">
                    {cacheWarmStatus.currentStep || 'Aguardando o cache do Telegram...'}
                  </div>
                  {cacheWarmStatus.currentAsset ? (
                    <div className="mt-1 break-all text-xs text-white/45">
                      Arquivo atual: {cacheWarmStatus.currentAsset}
                    </div>
                  ) : null}
                </div>

                {cacheWarmGroups.length > 0 ? (
                  <div className="grid gap-2 rounded-[18px] border border-white/10 bg-black/30 p-3">
                    <span className={labelClassName()}>Logs por modelo</span>
                    <div className="space-y-4">
                      {cacheWarmGroups.map((group) => {
                        const isExpanded = expandedCacheGroups.includes(group.label);
                        const groupTone = getCacheGroupTone(group.label);

                        return (
                          <div
                            key={group.label}
                            className={`overflow-hidden rounded-[20px] border-2 ${groupTone.shell}`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCacheGroups((current) =>
                                  current.includes(group.label)
                                    ? current.filter((label) => label !== group.label)
                                    : [...current, group.label],
                                )
                              }
                              className={`relative flex w-full flex-col gap-3 px-3 py-3 text-left transition sm:flex-row sm:items-center sm:justify-between ${groupTone.header}`}
                            >
                              <span
                                className={`absolute inset-y-0 left-0 w-1.5 rounded-r-full ${groupTone.accent}`}
                              />
                              <div className="min-w-0 pl-3">
                                <div className={`truncate font-semibold ${groupTone.title}`}>
                                  {group.label}
                                </div>
                                <div
                                  className={`mt-1 grid grid-cols-2 gap-1.5 text-[11px] sm:flex sm:flex-wrap ${groupTone.subtitle}`}
                                >
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-center ${groupTone.badge}`}
                                  >
                                    {group.items.length} midia(s)
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-center ${groupTone.badge}`}
                                  >
                                    {group.cached} em cache
                                  </span>
                                  {group.warmed > 0 ? (
                                    <span className="rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2 py-0.5 text-center text-emerald-100">
                                      {group.warmed} enviada(s)
                                    </span>
                                  ) : null}
                                  {group.missing > 0 ? (
                                    <span className="rounded-full border border-amber-400/30 bg-amber-500/12 px-2 py-0.5 text-center text-amber-100">
                                      {group.missing} faltando
                                    </span>
                                  ) : null}
                                  {group.failed > 0 ? (
                                    <span className="rounded-full border border-red-400/30 bg-red-500/12 px-2 py-0.5 text-center text-red-100">
                                      {group.failed} falha(s)
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <span
                                className={`self-start rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] sm:self-auto ${groupTone.button}`}
                              >
                                {isExpanded ? 'Fechar' : 'Abrir'}
                              </span>
                            </button>

                            {isExpanded ? (
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  setExpandedCacheGroups((current) =>
                                    current.filter((label) => label !== group.label),
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setExpandedCacheGroups((current) =>
                                      current.filter((label) => label !== group.label),
                                    );
                                  }
                                }}
                                className={`cursor-pointer border-t px-2.5 py-3 sm:px-3 ${groupTone.divider}`}
                              >
                                <div
                                  className={`mb-2 break-words text-[11px] font-semibold uppercase tracking-[0.18em] ${groupTone.subtitle}`}
                                >
                                  Log detalhado de {group.label}
                                </div>
                                <div className="space-y-1.5">
                                  {group.items.map((item) => (
                                    (() => {
                                      const canWarmIndividually = item.status === 'missing';
                                      const isWarmingThisItem =
                                        singleCachePendingUrl === item.assetUrl;

                                      return (
                                    <div
                                      key={item.id}
                                      className={`min-w-0 overflow-hidden rounded-2xl border px-2.5 py-2 text-sm sm:px-3 ${
                                        item.status === 'failed'
                                          ? 'border-red-500/20 bg-red-500/10 text-red-100'
                                          : item.status === 'warmed'
                                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                                            : item.status === 'missing'
                                              ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                                              : 'border-white/10 bg-white/[0.03] text-white/75'
                                      }`}
                                    >
                                      <div className="grid min-w-0 gap-2">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                          <div className="flex min-w-0 items-start gap-3">
                                            <CacheWarmItemThumbnail item={item} />
                                            <div className="min-w-0 grid gap-2">
                                              <span className="min-w-0 break-all text-[13px] font-medium leading-5 sm:text-sm">
                                                {item.assetLabel}
                                              </span>
                                              <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
                                                <span className="rounded-full border border-white/10 px-2 py-1 text-center text-[10px] uppercase tracking-[0.18em]">
                                                  {item.mediaType}
                                                </span>
                                                <span className="rounded-full border border-white/10 px-2 py-1 text-center text-[10px] uppercase tracking-[0.18em]">
                                                  {item.status === 'cached'
                                                    ? 'em cache'
                                                    : item.status === 'warmed'
                                                      ? 'enviado'
                                                      : item.status === 'missing'
                                                        ? 'faltando'
                                                        : 'falha'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>

                                          {canWarmIndividually ? (
                                            <div
                                              className="shrink-0"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                              }}
                                              onKeyDown={(event) => {
                                                event.stopPropagation();
                                              }}
                                            >
                                              <button
                                                type="button"
                                                onClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  void handleWarmSingleCacheItem(item);
                                                }}
                                                disabled={Boolean(activeTask) || Boolean(singleCachePendingUrl)}
                                                className="inline-flex min-h-10 items-center justify-center rounded-full border border-amber-400/25 bg-amber-500/12 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-50 transition hover:bg-amber-500/18 disabled:cursor-not-allowed disabled:opacity-60"
                                              >
                                                {isWarmingThisItem ? 'Enviando...' : 'Enviar agora'}
                                              </button>
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                      {item.reason ? (
                                        <div className="mt-1 break-all text-xs leading-5 opacity-80">
                                          {normalizeCacheReasonForDisplay(item.reason)}
                                        </div>
                                      ) : null}
                                    </div>
                                      );
                                    })()
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {cacheWarmStatus.logs.length > 0 ? (
                  <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
                    Ultima atualizacao:{' '}
                    {formatCacheWarmLogTime(
                      cacheWarmStatus.logs[cacheWarmStatus.logs.length - 1]?.timestamp || '',
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {cacheWarmFeedback ? (
              <div
                className={`mt-4 rounded-[22px] border px-4 py-3 text-sm ${
                  cacheWarmFeedbackTone === 'error'
                    ? 'border-red-500/25 bg-red-500/10 text-red-100'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {cacheWarmFeedback}
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <VideoTrimDialog
        state={videoTrimDialogState}
        initialSelection={
          videoTrimDialogState?.kind === 'draft'
            ? getVideoTrimSelection(videoTrimDialogState.file)
            : null
        }
        onApply={(selection) => {
          if (!videoTrimDialogState) {
            return;
          }

          if (videoTrimDialogState.kind === 'draft') {
            applyVideoTrimSelection(videoTrimDialogState.file, selection);
            return;
          }

          void handleTrimExistingVideo({
            assetUrl: videoTrimDialogState.src,
            startSeconds: selection.startSeconds,
            endSeconds: selection.endSeconds,
            taskId: videoTrimDialogState.taskId,
            successMessage: videoTrimDialogState.successMessage,
          });
        }}
        onClear={() => {
          if (!videoTrimDialogState) {
            return;
          }

          if (videoTrimDialogState.kind === 'draft') {
            applyVideoTrimSelection(videoTrimDialogState.file, null);
          }
        }}
        onClose={() => setVideoTrimDialogState(null)}
      />
      </div>
    </div>
    </div>
  );
}
