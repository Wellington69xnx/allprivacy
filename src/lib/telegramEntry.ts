import { getModelRouteSlug, sanitizeModelSlug } from './modelRoute';
import type { SubscriptionPlanId } from './subscriptionPlans';
import type { ModelProfile } from '../types';

function normalizeBotUsername(value: string) {
  return value.trim().replace(/^@+/, '');
}

function getSafePayload(value: string) {
  const normalized = sanitizeModelSlug(value).slice(0, 48);
  return normalized || 'home';
}

function buildTelegramPayload(target: string, planId?: SubscriptionPlanId) {
  const safeTarget = getSafePayload(target);
  const normalizedPlanId = planId === '7d' || planId === '30d' ? planId : '';

  if (!normalizedPlanId) {
    return safeTarget;
  }

  return `plan-${normalizedPlanId}-${safeTarget}`;
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

export function getHomeTelegramPayload(planId?: SubscriptionPlanId) {
  if (typeof window === 'undefined') {
    return buildTelegramPayload('home', planId);
  }

  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref') || params.get('utm_content') || params.get('model');

  return buildTelegramPayload(ref || 'home', planId);
}

export function getModelTelegramPayload(
  model: Pick<ModelProfile, 'id' | 'name' | 'handle'>,
  planId?: SubscriptionPlanId,
) {
  return buildTelegramPayload(getModelRouteSlug(model), planId);
}
