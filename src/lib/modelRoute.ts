import type { ModelProfile } from '../types';

export function sanitizeModelSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getModelRouteSlug(model: Pick<ModelProfile, 'id' | 'name' | 'handle'>) {
  return (
    sanitizeModelSlug(model.handle) ||
    sanitizeModelSlug(model.name) ||
    sanitizeModelSlug(model.id)
  );
}

function getFirstSegmentSlug(value: string) {
  const normalized = sanitizeModelSlug(value);
  return normalized.split('-').filter(Boolean)[0] || normalized;
}

export function getModelVideoBaseSlug(model: Pick<ModelProfile, 'id' | 'name' | 'handle'>) {
  return (
    getFirstSegmentSlug(model.handle) ||
    getFirstSegmentSlug(model.name) ||
    getModelRouteSlug(model)
  );
}

export function getHomePath() {
  return '/';
}

export function getAdminPath() {
  return '/admin';
}

export function getAdminCommentsPath() {
  return '/admin/comentarios';
}

export function getAboutPath() {
  return '/sobre';
}

export function getSupportPath() {
  return '/suporte';
}

export function getModelPath(model: Pick<ModelProfile, 'id' | 'name' | 'handle'>) {
  return `/${getModelRouteSlug(model)}`;
}

export function getModelVideoPath(
  model: Pick<ModelProfile, 'id' | 'name' | 'handle'>,
  routeToken: string,
) {
  return `/${getModelVideoBaseSlug(model)}/${encodeURIComponent(routeToken)}`;
}

export function findModelByRouteSlug(models: ModelProfile[], routeSlug: string) {
  const normalizedRouteSlug = sanitizeModelSlug(routeSlug);

  return (
    models.find((model) => getModelRouteSlug(model) === normalizedRouteSlug) ||
    models.find((model) => getFirstSegmentSlug(model.name) === normalizedRouteSlug) ||
    models.find((model) => model.id === routeSlug) ||
    null
  );
}

export function findModelByVideoRoute(
  models: ModelProfile[],
  routeSlug: string,
  routeToken: string,
) {
  const normalizedRouteSlug = sanitizeModelSlug(routeSlug);
  const normalizedRouteToken = routeToken.trim().toLowerCase();

  for (const model of models) {
    const hasMatchingSlug =
      getModelVideoBaseSlug(model) === normalizedRouteSlug ||
      getModelRouteSlug(model) === normalizedRouteSlug ||
      getFirstSegmentSlug(model.name) === normalizedRouteSlug ||
      getFirstSegmentSlug(model.handle) === normalizedRouteSlug;

    if (!hasMatchingSlug) {
      continue;
    }

    const matchingContent =
      model.fullContentVideos?.find(
        (item) => item.routeToken?.trim().toLowerCase() === normalizedRouteToken,
      ) || null;

    if (matchingContent) {
      return {
        model,
        content: matchingContent,
      };
    }
  }

  return null;
}
