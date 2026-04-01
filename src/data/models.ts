import type { PreviewCard, SiteContent, ModelProfile } from '../types';

export const defaultSiteContent: SiteContent = {
  models: [],
  groupProofItems: [],
  heroBackgrounds: {
    mobile: [],
    desktop: [],
  },
};

function shuffleArray<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

export function getRandomPreviewCards(models: ModelProfile[], limit = 12): PreviewCard[] {
  const allItems = models.flatMap((model) =>
    model.gallery.map((item, index) => ({
      id: `${model.id}-preview-${index}`,
      ownerId: model.id,
      owner: model.name,
      ownerHandle: model.handle,
      ownerProfileImage: model.profileImage,
      ownerCoverImage: model.coverImage,
      title: item.title,
      type: item.type,
      thumbnail: item.thumbnail,
      src: item.src,
      accentFrom: model.accentFrom,
      accentTo: model.accentTo,
    })),
  );

  return shuffleArray(allItems).slice(0, Math.min(limit, allItems.length));
}

export function getRandomPreviewCardsByType(
  models: ModelProfile[],
  type: 'image' | 'video',
  limit: number,
): PreviewCard[] {
  const allItems = models.flatMap((model) =>
    model.gallery
      .filter((item) => item.type === type)
      .map((item, index) => ({
        id: `${model.id}-${type}-preview-${index}`,
        ownerId: model.id,
        owner: model.name,
        ownerHandle: model.handle,
        ownerProfileImage: model.profileImage,
        ownerCoverImage: model.coverImage,
        title: item.title,
        type: item.type,
        thumbnail: item.thumbnail,
        src: item.src,
        accentFrom: model.accentFrom,
        accentTo: model.accentTo,
      })),
  );

  return shuffleArray(allItems).slice(0, Math.min(limit, allItems.length));
}

export function getPreviewCardsForModelByType(
  model: ModelProfile,
  type: 'image' | 'video',
  limit: number,
): PreviewCard[] {
  const items = model.gallery
    .filter((item) => item.type === type)
    .map((item, index) => ({
      id: `${model.id}-${type}-showcase-${index}`,
      ownerId: model.id,
      owner: model.name,
      ownerHandle: model.handle,
      ownerProfileImage: model.profileImage,
      ownerCoverImage: model.coverImage,
      title: item.title,
      type: item.type,
      thumbnail: item.thumbnail,
      src: item.src,
      accentFrom: model.accentFrom,
      accentTo: model.accentTo,
    }));

  return shuffleArray(items).slice(0, Math.min(limit, items.length));
}

export const heroBackdrop =
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1400&h=2200&q=80';
