export type MediaType = 'image' | 'video';
export type HeroBackgroundTarget = 'mobile' | 'desktop';
export type UploadAssetBucket =
  | 'model-profile'
  | 'model-cover'
  | 'model-media'
  | 'hero-background'
  | 'group-proof';

export interface ModelMedia {
  id: string;
  type: MediaType;
  title: string;
  subtitle: string;
  thumbnail: string;
  src?: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  handle: string;
  tagline: string;
  status?: string;
  accentFrom: string;
  accentTo: string;
  profileImage: string;
  coverImage: string;
  gallery: ModelMedia[];
}

export interface PreviewCard {
  id: string;
  owner: string;
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
}
