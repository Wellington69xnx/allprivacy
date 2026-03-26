import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getHomePath } from '../lib/modelRoute';
import type {
  HeroBackgroundTarget,
  ModelProfile,
  SiteContent,
  TelegramCacheWarmItem,
  TelegramCacheWarmStatus,
  UploadAssetOptions,
  UploadAssetProgress,
  UploadAssetResult,
} from '../types';
import { AutoplayMedia } from './AutoplayMedia';

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
  removeModel: (modelId: string) => Promise<void>;
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
  removeMediaFromModel: (modelId: string, mediaId: string) => Promise<void>;
  addGroupProofItem: (input: { title: string; image: string }) => Promise<void>;
  removeGroupProofItem: (itemId: string) => Promise<void>;
  addHeroBackground: (input: {
    title: string;
    image: string;
    target: HeroBackgroundTarget;
  }) => Promise<void>;
  removeHeroBackground: (target: HeroBackgroundTarget, itemId: string) => Promise<void>;
  clearSiteContent: () => Promise<void>;
  warmTelegramMediaCache: (
    onStatus?: (status: TelegramCacheWarmStatus) => void,
  ) => Promise<TelegramCacheWarmStatus>;
  checkTelegramMediaCache: (
    onStatus?: (status: TelegramCacheWarmStatus) => void,
  ) => Promise<TelegramCacheWarmStatus>;
}

interface ModelFormState {
  name: string;
  handle: string;
  tagline: string;
  profileImage: string;
  coverImage: string;
}

interface MediaFormState {
  modelId: string;
  type: 'image' | 'video';
  title: string;
  subtitle: string;
  thumbnail: string;
  src: string;
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
  thumbnail: File | null;
  assets: File[];
}

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
  type: 'image',
  title: '',
  subtitle: '',
  thumbnail: '',
  src: '',
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
  thumbnail: null,
  assets: [],
};

function fieldClassName() {
  return 'min-h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60 md:text-[15px]';
}

function labelClassName() {
  return 'text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55';
}

function buttonClassName() {
  return 'inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-rose-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60';
}

function ghostButtonClassName() {
  return 'inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60';
}

function previewFrameClassName(shape: PreviewShape) {
  if (shape === 'circle') {
    return 'mx-auto h-24 w-24 overflow-hidden rounded-full border border-white/10 bg-black';
  }

  if (shape === 'landscape') {
    return 'aspect-[16/10] overflow-hidden rounded-[22px] border border-white/10 bg-black';
  }

  if (shape === 'portrait') {
    return 'aspect-[9/16] overflow-hidden rounded-[22px] border border-white/10 bg-black';
  }

  return 'aspect-square overflow-hidden rounded-[22px] border border-white/10 bg-black';
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

  return (
    <div className={previewFrameClassName(shape)}>
      <img src={previewSrc} alt={alt} className="h-full w-full object-cover" loading="lazy" />
    </div>
  );
}

function PendingMediaPreview({ file }: { file: File }) {
  const previewSrc = usePreviewSrc(file, '');
  const isVideo = file.type.startsWith('video/');

  if (!previewSrc) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-white/10 bg-black">
      <div className="aspect-[4/5] bg-black">
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
      <div className="truncate border-t border-white/10 px-3 py-2 text-[11px] text-white/65">
        {file.name}
      </div>
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
  return (
    <div className="grid gap-3 rounded-[24px] border border-white/10 bg-black/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={labelClassName()}>{label}</span>
        {file ? <span className="max-w-[55%] truncate text-xs text-white/45">{file.name}</span> : null}
      </div>

      {file || urlValue.trim() ? (
        <PreviewImage file={file} url={urlValue} alt={previewAlt} shape={previewShape} />
      ) : null}

      <label className="cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.05]">
        <input
          type="file"
          accept={accept}
          className="hidden"
          disabled={disabled}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        {file ? 'Trocar arquivo local' : 'Selecionar arquivo local'}
      </label>

      <input
        value={urlValue}
        onChange={(event) => onUrlChange(event.target.value)}
        className={fieldClassName()}
        placeholder={urlPlaceholder}
        disabled={disabled}
      />

      {helper ? <p className="text-xs leading-5 text-white/45">{helper}</p> : null}
    </div>
  );
}

function MultiFileUploadField({
  label,
  accept,
  files,
  onFilesChange,
  helper,
  disabled = false,
}: {
  label: string;
  accept: string;
  files: File[];
  onFilesChange: (files: File[]) => void;
  helper?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-[24px] border border-white/10 bg-black/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={labelClassName()}>{label}</span>
        {files.length > 0 ? <span className="text-xs text-white/45">{files.length} arquivo(s)</span> : null}
      </div>

      <label className="cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.05]">
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          disabled={disabled}
          onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
        />
        {files.length > 0 ? 'Trocar arquivos locais' : 'Selecionar varios arquivos'}
      </label>

      {files.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {files.map((file) => (
            <PendingMediaPreview key={`${file.name}-${file.lastModified}`} file={file} />
          ))}
        </div>
      ) : null}

      {helper ? <p className="text-xs leading-5 text-white/45">{helper}</p> : null}
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

function MediaTypeSwitch({
  value,
  onChange,
}: {
  value: 'image' | 'video';
  onChange: (value: 'image' | 'video') => void;
}) {
  return (
    <div className="grid gap-2">
      <span className={labelClassName()}>Tipo de conteudo</span>
      <div className="grid grid-cols-2 gap-2">
        {(['image', 'video'] as const).map((item) => {
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
              {item === 'image' ? 'Imagem' : 'Video'}
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
  children,
}: {
  title: string;
  subtitle: string;
  countLabel?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
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
          <p className="mt-2 text-sm leading-6 text-zinc-300">{subtitle}</p>
        </div>

        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
          {isOpen ? 'Fechar' : 'Abrir'}
        </span>
      </button>

      {isOpen ? <div className="border-t border-white/10 px-4 py-4 sm:px-5">{children}</div> : null}
    </section>
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
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [editingModelForm, setEditingModelForm] = useState(emptyModelForm);
  const [editingModelFiles, setEditingModelFiles] = useState(emptyModelFiles);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    model: false,
    media: false,
    backgrounds: false,
    proofs: false,
    models: true,
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
    const uploadedUrls: string[] = [];

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

      uploadedUrls.push(uploaded.url);
      updateTaskProgress(
        taskId,
        `${label} ${index + 1}/${files.length}`,
        currentEnd,
      );
    }

    return uploadedUrls;
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

  const handleMediaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (activeTask) {
      return;
    }

    setActiveTask('media');
    updateTaskProgress('media', 'Preparando conteudo', 6);
    setFeedback(null);

    try {
      const selectedModel = siteContent.models.find((model) => model.id === mediaForm.modelId);

      if (!mediaForm.modelId || !selectedModel) {
        setFeedback('Selecione uma modelo antes de salvar o conteudo.');
        return;
      }

      const modelName = selectedModel.name;
      const hasLocalAssets = mediaFiles.assets.length > 0;
      const isVideo = mediaForm.type === 'video';
      const thumbnail =
        isVideo || !hasLocalAssets
          ? await resolveAsset({
              file: mediaFiles.thumbnail,
              fallbackUrl: mediaForm.thumbnail,
              taskId: 'media',
              label: isVideo ? 'Enviando poster' : 'Enviando imagem',
              progressRange: hasLocalAssets ? [10, 20] : [10, 78],
              options: {
                bucket: 'model-media',
                modelName,
                mediaType: 'image',
              },
            })
          : mediaForm.thumbnail.trim();

      const assetUploads = hasLocalAssets
        ? await uploadAssetsSequentially({
            files: mediaFiles.assets,
            taskId: 'media',
            label: mediaForm.type === 'video' ? 'Enviando video' : 'Enviando imagem',
            range: [20, 86],
            optionsBuilder: () => ({
              bucket: 'model-media',
              modelName,
              mediaType: mediaForm.type,
            }),
          })
        : [];

      if (assetUploads.length > 0) {
        const batchItems = assetUploads.map((assetUrl, index) => ({
          modelId: mediaForm.modelId,
          type: mediaForm.type,
          title:
            mediaForm.title.trim() && assetUploads.length > 1
              ? `${mediaForm.title.trim()} ${index + 1}`
              : mediaForm.title.trim() || `Previa ${index + 1}`,
          subtitle: mediaForm.subtitle,
          thumbnail: mediaForm.type === 'video' ? thumbnail || assetUrl : assetUrl,
          src: mediaForm.type === 'video' ? assetUrl : undefined,
        }));

        updateTaskProgress('media', 'Gravando conteudo', 92);
        await addMediaBatchToModel(mediaForm.modelId, batchItems);
      } else {
        const videoSource = mediaForm.type === 'video' ? mediaForm.src.trim() : undefined;

        if (mediaForm.type === 'image' && !thumbnail) {
          setFeedback('Envie uma ou mais imagens locais ou informe a URL da previa.');
          return;
        }

        if (mediaForm.type === 'video' && !videoSource) {
          setFeedback('Envie um ou mais videos locais ou informe a URL do video.');
          return;
        }

        updateTaskProgress('media', 'Gravando conteudo', 92);
        await addMediaToModel({
          ...mediaForm,
          thumbnail: mediaForm.type === 'video' ? thumbnail || videoSource || '' : thumbnail,
          src: videoSource,
        });
      }

      updateTaskProgress('media', 'Conteudo salvo', 100);
      setMediaForm((current) => ({
        ...emptyMediaForm,
        modelId: current.modelId,
      }));
      setMediaFiles(emptyMediaFiles);
      setFeedback('Conteudo salvo e ja disponivel na home e no modal da modelo.');
      setOpenSections((current) => ({ ...current, models: true }));
    } catch {
      setFeedback('Nao foi possivel salvar o conteudo agora.');
    } finally {
      setActiveTask(null);
      clearTaskProgress();
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

    setActiveTask('clear');
    updateTaskProgress('clear', 'Limpando conteudo', 40);
    setFeedback(null);

    try {
      await clearSiteContent();
      setModelForm(emptyModelForm);
      setMediaForm(emptyMediaForm);
      setGroupProofForm(emptyGroupProofForm);
      setHeroBackgroundForm(emptyHeroBackgroundForm);
      setModelFiles(emptyModelFiles);
      setMediaFiles(emptyMediaFiles);
      setGroupProofFile(null);
      setHeroBackgroundFile(null);
      setExpandedModelId(null);
      stopEditingModel();
      updateTaskProgress('clear', 'Conteudo limpo', 100);
      setFeedback('Conteudo limpo. A home agora mostra somente o que voce voltar a cadastrar.');
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

  const handleRemoveModel = async (modelId: string) => {
    if (activeTask) {
      return;
    }

    setActiveTask(`remove-model-${modelId}`);
    setFeedback(null);

    try {
      await removeModel(modelId);

      if (editingModelId === modelId) {
        stopEditingModel();
      }

      if (expandedModelId === modelId) {
        setExpandedModelId(null);
      }

      setFeedback('Modelo removida do site.');
    } catch {
      setFeedback('Nao foi possivel remover a modelo agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleRemoveMedia = async (modelId: string, mediaId: string) => {
    if (activeTask) {
      return;
    }

    setActiveTask(`remove-media-${mediaId}`);
    setFeedback(null);

    try {
      await removeMediaFromModel(modelId, mediaId);
      setFeedback('Conteudo removido da modelo.');
    } catch {
      setFeedback('Nao foi possivel remover o conteudo agora.');
    } finally {
      setActiveTask(null);
    }
  };

  const handleRemoveGroupProof = async (itemId: string) => {
    if (activeTask) {
      return;
    }

    setActiveTask(`remove-group-${itemId}`);
    setFeedback(null);

    try {
      await removeGroupProofItem(itemId);
      setFeedback('Print removido da home.');
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

    setActiveTask(`remove-hero-${itemId}`);
    setFeedback(null);

    try {
      await removeHeroBackground(target, itemId);
      setFeedback('Fundo da home removido.');
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

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="mx-auto max-w-[1260px] px-3 py-4 sm:px-5 sm:py-6">
        <header className="rounded-[30px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <a
                href={getHomePath()}
                className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50"
              >
                Voltar para o site
              </a>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                AllPrivacy Admin
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                Painel protegido com upload local, preview visual e blocos mais compactos no
                celular.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={() => void onLogout()}
                className={ghostButtonClassName()}
              >
                Sair
              </button>
              <button
                type="button"
                onClick={() => void handleClearContent()}
                disabled={Boolean(activeTask) || isLoading}
                className={ghostButtonClassName()}
              >
                {activeTask === 'clear' ? 'Limpando...' : 'Limpar tudo'}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:flex lg:flex-wrap">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Modelos: {siteContent.models.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/75">
              Midias: {totalMedia}
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
          <AdminSection
            title="Adicionar modelo"
            subtitle="Cadastre perfil, capa e dados principais com preview antes de salvar."
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
            subtitle="Envie varios videos ou imagens de uma vez. A home e o modal puxam daqui."
            countLabel={siteContent.models.length === 0 ? 'Sem modelos' : undefined}
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

              <MediaTypeSwitch
                value={mediaForm.type}
                onChange={(type) => setMediaForm((current) => ({ ...current, type }))}
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
                label={mediaForm.type === 'video' ? 'Arquivos de video' : 'Arquivos de imagem'}
                accept={mediaForm.type === 'video' ? 'video/*' : 'image/*'}
                files={mediaFiles.assets}
                onFilesChange={(files) =>
                  setMediaFiles((current) => ({
                    ...current,
                    assets: files,
                  }))
                }
                helper={
                  mediaForm.type === 'video'
                    ? 'No painel, os videos so tocam ao tocar ou passar o mouse.'
                    : 'As imagens selecionadas aparecem em miniatura antes do envio.'
                }
                disabled={Boolean(activeTask) || isLoading}
              />

              <UploadField
                label={mediaForm.type === 'video' ? 'Poster opcional' : 'Imagem unica'}
                accept="image/*"
                file={mediaFiles.thumbnail}
                urlValue={mediaForm.thumbnail}
                onFileChange={(file) =>
                  setMediaFiles((current) => ({ ...current, thumbnail: file }))
                }
                onUrlChange={(value) =>
                  setMediaForm((current) => ({ ...current, thumbnail: value }))
                }
                urlPlaceholder={
                  mediaForm.type === 'video'
                    ? 'URL opcional do poster'
                    : 'URL opcional da imagem'
                }
                helper={
                  mediaForm.type === 'video'
                    ? 'Se nao houver poster, o proprio video entra como fallback.'
                    : 'Use isso apenas se nao quiser subir arquivo local.'
                }
                disabled={Boolean(activeTask) || isLoading}
                previewShape={mediaForm.type === 'video' ? 'landscape' : 'portrait'}
                previewAlt="Preview do arquivo"
              />

              {mediaForm.type === 'video' ? (
                <input
                  value={mediaForm.src}
                  onChange={(event) =>
                    setMediaForm((current) => ({ ...current, src: event.target.value }))
                  }
                  className={fieldClassName()}
                  placeholder="URL opcional de um video unico"
                  disabled={Boolean(activeTask) || isLoading}
                />
              ) : null}

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

          <AdminSection
            title="Fundos da home"
            subtitle="Cadastre imagens separadas para mobile e desktop. O site escolhe uma delas ao abrir."
            countLabel={`${totalBackgrounds} fundo(s)`}
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
            subtitle="Essa faixa alimenta a secao 'Grupo por Dentro' com prints verticais."
            countLabel={`${siteContent.groupProofItems.length} print(s)`}
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

          <AdminSection
            title="Modelos cadastradas"
            subtitle="Abra apenas a modelo que quiser editar ou revisar."
            countLabel={`${siteContent.models.length} modelo(s)`}
            isOpen={openSections.models}
            onToggle={() => toggleSection('models')}
          >
            <div className="grid gap-3">
              {siteContent.models.map((model) => {
                const isExpanded = expandedModelId === model.id;
                const isEditing = editingModelId === model.id;

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
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/45">
                            {model.gallery.length} conteudo(s)
                          </p>
                        </div>
                      </div>

                      <span className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                        {isExpanded ? 'Fechar' : 'Abrir'}
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="mt-4 grid gap-4 lg:grid-cols-[260px,1fr]">
                        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black">
                          <div className="aspect-[16/10] sm:aspect-[5/4] lg:aspect-[4/5]">
                            <img
                              src={model.coverImage}
                              alt={model.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                isEditing ? stopEditingModel() : startEditingModel(model)
                              }
                              className={ghostButtonClassName()}
                            >
                              {isEditing ? 'Cancelar edicao' : 'Editar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemoveModel(model.id)}
                              disabled={Boolean(activeTask)}
                              className={ghostButtonClassName()}
                            >
                              Remover
                            </button>
                          </div>

                          {model.tagline ? (
                            <p className="mt-3 text-sm leading-6 text-zinc-300">
                              {model.tagline}
                            </p>
                          ) : null}

                          {isEditing ? (
                            <div className="mt-4 grid gap-3 rounded-[24px] border border-white/10 bg-black/30 p-4 sm:grid-cols-2">
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
                                  <TaskProgressBar
                                    progress={getTaskProgress(`update-model-${model.id}`)!}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {model.gallery.length === 0 ? (
                            <p className="mt-4 text-sm text-zinc-400">
                              Essa modelo ainda nao tem conteudo cadastrado.
                            </p>
                          ) : (
                            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                              {model.gallery.map((item) => (
                                <div key={item.id} className="relative overflow-hidden rounded-2xl">
                                  <div className="aspect-[4/5] bg-zinc-950">
                                    <AutoplayMedia
                                      type={item.type}
                                      src={item.src}
                                      poster={item.thumbnail}
                                      alt={item.title}
                                      className="h-full w-full"
                                      playMode="hover"
                                      preloadStrategy="metadata"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveMedia(model.id, item.id)}
                                    disabled={Boolean(activeTask)}
                                    className="absolute right-2 top-2 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[10px] text-white/80 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    X
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            {!isLoading && siteContent.models.length === 0 ? (
              <p className="text-sm text-zinc-400">
                Nenhuma modelo cadastrada ainda. A home ficara vazia ate voce adicionar as
                primeiras.
              </p>
            ) : null}
          </AdminSection>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-5">
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
                                      {item.reason ? (
                                        <div className="mt-1 break-all text-xs leading-5 opacity-80">
                                          {normalizeCacheReasonForDisplay(item.reason)}
                                        </div>
                                      ) : null}
                                    </div>
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
    </div>
  );
}
