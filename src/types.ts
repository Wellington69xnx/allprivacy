export type MediaType = 'image' | 'video';
export type HeroBackgroundTarget = 'mobile' | 'desktop';
export type UploadAssetBucket =
  | 'model-profile'
  | 'model-cover'
  | 'model-media'
  | 'model-full-video'
  | 'hero-background'
  | 'group-proof';

export interface ModelMedia {
  id: string;
  type: MediaType;
  title: string;
  subtitle: string;
  thumbnail: string;
  src?: string;
  favorite?: boolean;
}

export interface ModelFullContentVideo {
  id: string;
  title: string;
  routeToken: string;
  videoUrl: string;
  views: number;
  comments?: ModelFullContentComment[];
}

export interface ModelFullContentComment {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  likes: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  handle: string;
  tagline: string;
  hiddenOnHome?: boolean;
  status?: string;
  accentFrom: string;
  accentTo: string;
  profileImage: string;
  coverImage: string;
  gallery: ModelMedia[];
  fullContentVideos?: ModelFullContentVideo[];
}

export interface PreviewCard {
  id: string;
  ownerId: string;
  owner: string;
  ownerHandle: string;
  ownerProfileImage: string;
  ownerCoverImage: string;
  title: string;
  type: MediaType;
  thumbnail: string;
  src?: string;
  accentFrom: string;
  accentTo: string;
}

export interface GroupProofItem {
  id: string;
  title: string;
  subtitle?: string;
  image: string;
}

export interface HeroBackgroundItem {
  id: string;
  title?: string;
  image: string;
  target: HeroBackgroundTarget;
}

export interface SiteContent {
  models: ModelProfile[];
  groupProofItems: GroupProofItem[];
  heroBackgrounds: {
    mobile: HeroBackgroundItem[];
    desktop: HeroBackgroundItem[];
  };
}

export interface UploadAssetOptions {
  bucket?: UploadAssetBucket;
  modelName?: string;
  target?: HeroBackgroundTarget;
  mediaType?: MediaType;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
}

export interface UploadAssetProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadAssetResult {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  thumbnailUrl?: string;
}

export interface TelegramCacheWarmFailure {
  assetUrl: string;
  mediaType: MediaType;
  reason: string;
}

export interface TelegramCacheWarmLogEntry {
  id: string;
  level: 'info' | 'success' | 'error';
  message: string;
  timestamp: string;
}

export interface TelegramCacheWarmItem {
  id: string;
  groupLabel: string;
  assetLabel: string;
  assetUrl: string;
  mediaType: MediaType;
  status: 'cached' | 'warmed' | 'missing' | 'failed';
  reason?: string;
}

export interface TelegramCacheWarmSummary {
  total: number;
  checked: number;
  alreadyCached: number;
  warmed: number;
  failed: number;
  failures: TelegramCacheWarmFailure[];
}

export interface TelegramCacheWarmStatus extends TelegramCacheWarmSummary {
  jobId: string;
  mode: 'check' | 'warm';
  state: 'running' | 'completed' | 'failed';
  progressPercent: number;
  currentStep: string;
  currentAsset: string;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  logs: TelegramCacheWarmLogEntry[];
  items: TelegramCacheWarmItem[];
}

export interface TelegramCacheSingleItemResponse {
  ok: boolean;
  item: TelegramCacheWarmItem;
  message?: string;
}
