export type MediaType = 'image' | 'video';

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
  status: string;
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
