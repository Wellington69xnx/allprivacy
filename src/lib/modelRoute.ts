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

export function getHomePath() {
  return '/';
}

export function getAdminPath() {
  return '/admin';
}

export function getModelPath(model: Pick<ModelProfile, 'id' | 'name' | 'handle'>) {
  return `/${getModelRouteSlug(model)}`;
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
