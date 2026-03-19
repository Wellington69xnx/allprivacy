import { getModelRouteSlug, sanitizeModelSlug } from './modelRoute';
import type { ModelProfile } from '../types';

function normalizeBotUsername(value: string) {
  return value.trim().replace(/^@+/, '');
}

function getSafePayload(value: string) {
  const normalized = sanitizeModelSlug(value).slice(0, 48);
  return normalized || 'home';
}

export function getTelegramEntryUrl(botUsername: string, payload: string) {
  const normalizedBotUsername = normalizeBotUsername(botUsername);

  if (!normalizedBotUsername) {
    return '#';
  }

  return `https://t.me/${normalizedBotUsername}?start=${encodeURIComponent(
    getSafePayload(payload),
  )}`;
}

export function getHomeTelegramPayload() {
  if (typeof window === 'undefined') {
    return 'home';
  }

  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref') || params.get('utm_content') || params.get('model');

  return getSafePayload(ref || 'home');
}

export function getModelTelegramPayload(model: Pick<ModelProfile, 'id' | 'name' | 'handle'>) {
  return getSafePayload(getModelRouteSlug(model));
}
