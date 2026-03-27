import path from 'node:path';
import QRCode from 'qrcode';
import { openAsBlob, promises as fs } from 'node:fs';
import { isSyncPayPaidStatus } from './syncpay-client.mjs';

const telegramApiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const telegramPhotoUploadLimitBytes = 10 * 1024 * 1024;
const telegramOtherUploadLimitBytes = 50 * 1024 * 1024;
const paymentConversationStepEmail = 'awaiting-email';
const paymentConversationStepCpf = 'awaiting-cpf';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePhoneDigits(value) {
  let digits = toText(value).replace(/\D+/g, '');

  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (digits.length > 11) {
    digits = digits.slice(-11);
  }

  return digits;
}

function logBot(message, details) {
  const timestamp = new Date().toISOString();

  if (details === undefined) {
    console.log(`[bot ${timestamp}] ${message}`);
    return;
  }

  console.log(`[bot ${timestamp}] ${message}`, details);
}

function getNetworkErrorCode(error) {
  return (
    toText(error?.cause?.code) ||
    toText(error?.code) ||
    (Array.isArray(error?.cause?.errors)
      ? error.cause.errors.map((item) => toText(item?.code)).filter(Boolean)[0]
      : '')
  );
}

function getTelegramConnectivityHint(error, apiBaseUrl) {
  const errorCode = getNetworkErrorCode(error);

  if (['ETIMEDOUT', 'ENETUNREACH', 'ECONNREFUSED'].includes(errorCode)) {
    return `Sem conectividade ate ${apiBaseUrl}. Verifique firewall, VPN, bloqueio do provedor ou teste em outra rede.`;
  }

  return '';
}

function sanitizeModelSlug(value) {
  return toText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getModelRouteSlug(model) {
  return sanitizeModelSlug(model.handle) || sanitizeModelSlug(model.name) || toText(model.id);
}

function getFirstNameSlug(model) {
  return sanitizeModelSlug(model.name).split('-').filter(Boolean)[0] || getModelRouteSlug(model);
}

function normalizeBaseUrl(value) {
  return toText(value).replace(/\/+$/, '');
}

function buildModelUrl(siteUrl, model) {
  return `${normalizeBaseUrl(siteUrl)}/${getModelRouteSlug(model)}`;
}

function buildHomeUrl(siteUrl) {
  return normalizeBaseUrl(siteUrl) || 'http://localhost:5173';
}

function buildGroupUrl(groupUrl, siteUrl) {
  return normalizeBaseUrl(groupUrl) || buildHomeUrl(siteUrl);
}

function buildAbsoluteAssetUrl(siteUrl, assetUrl) {
  const normalizedAssetUrl = toText(assetUrl);

  if (!normalizedAssetUrl) {
    return '';
  }

  if (/^https?:\/\//i.test(normalizedAssetUrl)) {
    return normalizedAssetUrl;
  }

  return `${buildHomeUrl(siteUrl)}${normalizedAssetUrl.startsWith('/') ? '' : '/'}${normalizedAssetUrl}`;
}

function isPrivateHostname(hostname) {
  const normalizedHostname = toText(hostname).toLowerCase();

  if (!normalizedHostname) {
    return true;
  }

  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '::1'
  ) {
    return true;
  }

  if (
    normalizedHostname.startsWith('10.') ||
    normalizedHostname.startsWith('192.168.') ||
    normalizedHostname.startsWith('169.254.')
  ) {
    return true;
  }

  const private172Match = normalizedHostname.match(/^172\.(\d{1,3})\./);

  if (private172Match) {
    const secondOctet = Number(private172Match[1]);

    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  return false;
}

function shouldPreferRemoteMedia(siteUrl) {
  try {
    const parsedUrl = new URL(buildHomeUrl(siteUrl));
    return !isPrivateHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function splitModelsIntoRows(models, siteUrl) {
  const rows = [];

  for (let index = 0; index < models.length; index += 2) {
    rows.push(
      models.slice(index, index + 2).map((model) => ({
        text: model.name,
        callback_data: `model:${getModelRouteSlug(model)}`,
      })),
    );
  }

  rows.push([
    {
      text: 'Abrir site',
      url: buildHomeUrl(siteUrl),
    },
  ]);

  return rows;
}

function buildModelCaption(model) {
  const parts = [
    `*${model.name}*`,
    model.handle ? `${model.handle.startsWith('@') ? model.handle : `@${model.handle}`}` : null,
    model.tagline || null,
    '',
    `Midias cadastradas: ${Array.isArray(model.gallery) ? model.gallery.length : 0}`,
  ];

  return parts.filter((part) => part !== null).join('\n');
}

function formatCurrencyBRL(amount) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function normalizePlanId(value) {
  const normalized = toText(value).toLowerCase();

  if (
    normalized === '7' ||
    normalized === '7d' ||
    normalized === '7dia' ||
    normalized === '7dias' ||
    normalized === '7-dias'
  ) {
    return '7d';
  }

  if (
    normalized === '30' ||
    normalized === '30d' ||
    normalized === '30dia' ||
    normalized === '30dias' ||
    normalized === '30-dias'
  ) {
    return '30d';
  }

  return normalized;
}

function getPaymentPlans(options) {
  return Array.isArray(options?.paymentConfig?.plans) ? options.paymentConfig.plans : [];
}

function getDefaultPaymentPlan(options) {
  const plans = getPaymentPlans(options);
  const preferredPlanId = normalizePlanId(options?.paymentConfig?.defaultPlanId);

  return (
    plans.find((plan) => normalizePlanId(plan.id) === preferredPlanId) ||
    plans[0] ||
    null
  );
}

function getPaymentPlan(options, planId) {
  const normalizedPlanId = normalizePlanId(planId);
  const plans = getPaymentPlans(options);

  return (
    plans.find((plan) => normalizePlanId(plan.id) === normalizedPlanId) ||
    getDefaultPaymentPlan(options)
  );
}

function getPaymentPlanForPayment(payment, options) {
  return getPaymentPlan(options, payment?.planId);
}

function isFakePixPayment(payment) {
  return Boolean(
    payment?.syncpayPayload &&
      typeof payment.syncpayPayload === 'object' &&
      payment.syncpayPayload.fakePix === true,
  );
}

function buildFakePixCode(payment, paymentPlan) {
  const normalizedPlanId = normalizePlanId(payment?.planId || paymentPlan?.id || 'vip').toUpperCase();
  const amount = Number(payment?.displayAmount || paymentPlan?.displayAmount || payment?.amount || 0).toFixed(2);
  const modelSlug = sanitizeModelSlug(payment?.modelSlug || 'home').toUpperCase();
  const suffix = toText(payment?.id).replace(/[^a-zA-Z0-9]+/g, '').slice(-12).toUpperCase() || 'TESTE';

  return `FAKEPIX|ALLPRIVACY|${normalizedPlanId}|${amount}|${modelSlug}|${suffix}`;
}

function buildFakePixPaymentResult(payment, options) {
  const paymentPlan = getPaymentPlanForPayment(payment, options);
  const expiresAt = new Date(Date.now() + Math.max(60_000, Number(options.paymentConfig.pixTtlMs || 0))).toISOString();
  const paymentCode = buildFakePixCode(payment, paymentPlan);

  return {
    status: 'pending',
    transactionId: `fake-${payment.id}`,
    paymentCode,
    paymentCodeBase64: Buffer.from(paymentCode, 'utf8').toString('base64'),
    paymentLink: '',
    dueAt: expiresAt,
    pixExpiresAt: expiresAt,
    raw: {
      fakePix: true,
      provider: 'fake',
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildPlanBadge(plan) {
  if (!plan) {
    return '';
  }

  return `${plan.durationLabel} • ${formatCurrencyBRL(plan.displayAmount)}`;
}

function buildPaymentLabel(plan) {
  return buildPlanBadge(plan);
}

function buildPaymentPlansList(options) {
  const plans = getPaymentPlans(options);

  return plans
    .map((plan, index) => {
      const marker = index === 0 ? '1️⃣' : index === 1 ? '2️⃣' : '•';
      return `${marker} ${buildPlanBadge(plan)}`;
    })
    .join('\n');
}

function buildPaymentPlansIntro(options, title = '💎 Escolha seu plano:') {
  const plansList = buildPaymentPlansList(options);

  if (!plansList) {
    return title;
  }

  return `${title}\n${plansList}`;
}

function parsePaymentActionPayload(value, prefix) {
  const normalizedValue = toText(value).replace(new RegExp(`^${prefix}:`), '');
  const [firstPart, ...remainingParts] = normalizedValue.split(':');
  const normalizedPlanId = normalizePlanId(firstPart);

  if (['7d', '30d'].includes(normalizedPlanId)) {
    return {
      planId: normalizedPlanId,
      modelSlug: sanitizeModelSlug(remainingParts.join(':')) || 'home',
    };
  }

  return {
    planId: '',
    modelSlug: sanitizeModelSlug(normalizedValue) || 'home',
  };
}

function buildStartPayload(modelSlug = 'home', planId = '') {
  const safeModelSlug = sanitizeModelSlug(modelSlug) || 'home';
  const normalizedPlanId = normalizePlanId(planId);

  if (!normalizedPlanId) {
    return safeModelSlug;
  }

  return `plan-${normalizedPlanId}-${safeModelSlug}`;
}

function parseStartPayload(value) {
  const normalizedValue = toText(value);
  const planMatch = normalizedValue.match(/^plan-(7d|30d)-(.+)$/i);

  if (planMatch) {
    return {
      planId: normalizePlanId(planMatch[1]),
      target: sanitizeModelSlug(planMatch[2]) || 'home',
    };
  }

  return {
    planId: '',
    target: sanitizeModelSlug(normalizedValue) || 'home',
  };
}

function formatDateTimeBR(value) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return '';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(timestamp));
}

function formatDateBR(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function getPublicPlanDurationDays(payment, options) {
  const paymentPlan = getPaymentPlanForPayment(payment, options);
  const normalizedPlanId = normalizePlanId(payment?.planId || paymentPlan?.id);

  if (normalizedPlanId === '7d') {
    return 7;
  }

  if (normalizedPlanId === '30d') {
    return 30;
  }

  const durationText = toText(payment?.planDurationLabel) || toText(paymentPlan?.durationLabel);
  const match = durationText.match(/(\d{1,3})/);
  return match ? Number(match[1]) : 0;
}

function getPublicPlanExpiryDate(payment, options) {
  const durationDays = getPublicPlanDurationDays(payment, options);

  if (!durationDays) {
    return '';
  }

  const date = new Date();
  date.setDate(date.getDate() + durationDays);
  return formatDateBR(date);
}

function formatAccessDuration(durationMs) {
  const totalSeconds = Math.max(1, Math.round(Number(durationMs || 0) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds} segundo${totalSeconds === 1 ? '' : 's'}`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} minuto${totalMinutes === 1 ? '' : 's'}`;
  }

  const totalHours = Math.round(totalMinutes / 60);

  if (totalHours < 48) {
    return `${totalHours} hora${totalHours === 1 ? '' : 's'}`;
  }

  const totalDays = Math.round(totalHours / 24);
  return `${totalDays} dia${totalDays === 1 ? '' : 's'}`;
}

function getPaymentWindowExpiryIso(payment, ttlMs) {
  const defaultExpiry = new Date(Date.now() + Math.max(60000, Number(ttlMs || 0))).toISOString();
  const paymentExpiry = toText(payment?.pixExpiresAt);

  if (paymentExpiry) {
    return paymentExpiry;
  }

  const dueTimestamp = Date.parse(toText(payment?.dueAt));
  const localTimestamp = Date.now() + Math.max(60000, Number(ttlMs || 0));

  if (Number.isFinite(dueTimestamp)) {
    return new Date(Math.min(dueTimestamp, localTimestamp)).toISOString();
  }

  return defaultExpiry;
}

function escapeHtml(value) {
  return toText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCpfDigits(value) {
  return toText(value).replace(/\D+/g, '');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toText(value));
}

function isValidCpf(value) {
  const cpf = normalizeCpfDigits(value);

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const digits = cpf.split('').map((digit) => Number(digit));
  const calcCheckDigit = (limit) => {
    const sum = digits
      .slice(0, limit - 1)
      .reduce((total, digit, index) => total + digit * (limit - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calcCheckDigit(10) === digits[9] && calcCheckDigit(11) === digits[10];
}

function mapPaymentStatusToLocal(status) {
  const normalizedStatus = toText(status).toUpperCase();

  if (isSyncPayPaidStatus(normalizedStatus)) {
    return 'paid';
  }

  if (
    [
      'AGUARDANDO_PAGAMENTO',
      'PENDING',
      'WAITING_PAYMENT',
      'WAITING',
      'CREATED',
      'MED',
    ].includes(normalizedStatus)
  ) {
    return 'pending';
  }

  if (['EXPIRED', 'CANCELLED', 'CANCELED', 'FAILED', 'REFUNDED'].includes(normalizedStatus)) {
    return 'failed';
  }

  return normalizedStatus ? normalizedStatus.toLowerCase() : 'pending';
}

function getPreviewUsage(customer, previewWindowMs) {
  const windowMs = Math.max(1000, Number(previewWindowMs || 0));
  const windowStartedAt = Date.parse(toText(customer?.previewUsageWindowStartedAt));
  const usageCount =
    Number.isFinite(windowStartedAt) && Date.now() - windowStartedAt < windowMs
      ? Math.max(0, Number(customer?.previewUsageCount || 0))
      : 0;
  const remaining = Math.max(0, 2 - usageCount);

  return {
    windowStartedAt: Number.isFinite(windowStartedAt) && Date.now() - windowStartedAt < windowMs
      ? new Date(windowStartedAt).toISOString()
      : '',
    count: usageCount,
    remaining,
    canUse: remaining > 0,
  };
}

function buildStartKeyboard(
  options,
  previewUsage = { canUse: true },
  previewButtonLabel = 'Ver previas',
  hasActiveAccess = false,
  modelSlug = 'home',
) {
  const rows = [];

  if (previewUsage.canUse) {
    rows.push([{ text: `👀 ${previewButtonLabel}`, callback_data: 'show-previews' }]);
  }

  if (options.paymentConfig.enabled) {
    const plans = getPaymentPlans(options);

    for (const plan of plans) {
      rows.push([
        {
          text: `💎 ${buildPaymentLabel(plan)}`,
          callback_data: `pay:${normalizePlanId(plan.id)}:${sanitizeModelSlug(modelSlug) || 'home'}`,
        },
      ]);
    }
  }

  if (hasActiveAccess) {
    rows.push([{ text: '🔓 Meu acesso', callback_data: 'my-access' }]);
  }

  rows.push([{ text: '🌐 Abrir site', url: buildHomeUrl(options.siteUrl) }]);

  return {
    inline_keyboard: rows,
  };
}

async function buildStartKeyboardForChat(
  chatId,
  options,
  previewButtonLabel = 'Ver previas',
  modelSlug = 'home',
) {
  const customer = await options.billingStore.getCustomer(chatId);
  const activeSubscription = await options.billingStore.getActiveSubscription(chatId);
  return buildStartKeyboard(
    options,
    getPreviewUsage(customer, options.paymentConfig.previewUsageWindowMs),
    previewButtonLabel,
    Boolean(activeSubscription),
    modelSlug,
  );
}

function buildPaymentKeyboard(payment, paymentConfig) {
  const rows = [
    [{ text: '✅ Ja paguei, verificar', callback_data: `verify:${payment.id}` }],
    ...(paymentConfig.simulationEnabled
      ? [[{ text: '🧪 Simular pagamento', callback_data: `simulate-pay:${payment.id}` }]]
      : []),
    [{ text: '📋 Copiar PIX', callback_data: `copy-pix:${payment.id}` }],
    [{ text: '📷 Ver QRCode', callback_data: `show-qr:${payment.id}` }],
    [{ text: '❌ Cancelar', callback_data: `cancel:${payment.id}` }],
  ];

  if (payment.paymentLink) {
    rows.unshift([{ text: '🧾 Abrir cobranca', url: payment.paymentLink }]);
  }

  return {
    inline_keyboard: rows,
  };
}

function buildAccessKeyboard(subscription, siteUrl) {
  const rows = [];

  if (subscription?.inviteLink) {
    rows.push([{ text: '🔓 Entrar no grupo privado', url: subscription.inviteLink }]);
  }

  rows.push([{ text: '🌐 Abrir site', url: buildHomeUrl(siteUrl) }]);

  return {
    inline_keyboard: rows,
  };
}

function buildSiteKeyboard(siteUrl) {
  return {
    inline_keyboard: [[{ text: '🌐 Abrir site', url: buildHomeUrl(siteUrl) }]],
  };
}

const telegramBotCommands = [
  { command: 'start', description: '🚀 Iniciar' },
  { command: 'suporte', description: '🆘 Suporte' },
  { command: 'assinatura', description: '🔓 Meu Acesso' },
  { command: 'site', description: '🌐 Acessar Site' },
];

function shuffleArray(items) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

const previewRecentHistoryLimit = 18;

function buildPreviewMediaKey(item) {
  const modelSlug = toText(item?.modelSlug);
  const mediaId = toText(item?.id);
  const assetUrl =
    toText(item?.src) || toText(item?.thumbnail) || toText(item?.assetUrl) || toText(item?.coverImage);

  return [modelSlug, toText(item?.type), mediaId || assetUrl].filter(Boolean).join('|');
}

function getPreviewRecentKeys(customer) {
  return new Set(
    Array.isArray(customer?.previewRecentMediaKeys)
      ? customer.previewRecentMediaKeys.map((item) => toText(item)).filter(Boolean)
      : [],
  );
}

async function rememberPreviewMediaItems(chatId, items, options) {
  const nextKeys = items.map((item) => buildPreviewMediaKey(item)).filter(Boolean);

  if (nextKeys.length === 0) {
    return null;
  }

  const customer = (await options.billingStore.getCustomer(chatId)) || {};
  const currentKeys = Array.isArray(customer.previewRecentMediaKeys)
    ? customer.previewRecentMediaKeys.map((item) => toText(item)).filter(Boolean)
    : [];
  const mergedKeys = [...nextKeys, ...currentKeys.filter((item) => !nextKeys.includes(item))].slice(
    0,
    previewRecentHistoryLimit,
  );

  return options.billingStore.upsertCustomer(chatId, {
    previewRecentMediaKeys: mergedKeys,
  });
}

function getMediaRecencyScore(item) {
  const id = toText(item?.id);
  const match = id.match(/^media-(\d{10,})-/);

  if (match) {
    return Number(match[1] || 0);
  }

  return 0;
}

function shuffleWithPreviewVariety(items, recentPreviewKeys = new Set()) {
  const shuffledItems = shuffleArray(items);

  if (recentPreviewKeys.size === 0) {
    return shuffledItems;
  }

  const freshItems = [];
  const repeatedItems = [];

  for (const item of shuffledItems) {
    if (recentPreviewKeys.has(buildPreviewMediaKey(item))) {
      repeatedItems.push(item);
      continue;
    }

    freshItems.push(item);
  }

  return [...freshItems, ...repeatedItems];
}

function getRandomModelMediaSelection(model, recentPreviewKeys = new Set()) {
  const gallery = Array.isArray(model.gallery) ? model.gallery : [];
  const videos = shuffleWithPreviewVariety(
    gallery.filter((item) => item.type === 'video' && toText(item.src)),
    recentPreviewKeys,
  );
  const images = shuffleWithPreviewVariety(
    gallery.filter((item) => item.type === 'image' && toText(item.thumbnail)),
    recentPreviewKeys,
  );

  const pickedVideos = videos.slice(0, 2);
  const pickedImages = images.slice(0, 1);
  const selectedIds = new Set([...pickedVideos, ...pickedImages].map((item) => item.id));
  const selection = [...pickedVideos, ...pickedImages];

  if (pickedImages.length === 0 && toText(model.coverImage)) {
    selection.push({
      id: `${model.id}-cover-fallback`,
      type: 'image',
      thumbnail: model.coverImage,
      title: `${model.name} capa`,
    });
  }

  if (selection.length < 3 && pickedImages.length === 0 && toText(model.profileImage)) {
    selection.push({
      id: `${model.id}-profile-fallback`,
      type: 'image',
      thumbnail: model.profileImage,
      title: `${model.name} perfil`,
    });
  }

  const remainingMedia = shuffleWithPreviewVariety(
    gallery.filter(
      (item) =>
        !selectedIds.has(item.id) &&
        (item.type === 'video' ? toText(item.src) : toText(item.thumbnail)),
    ),
    recentPreviewKeys,
  );

  for (const item of remainingMedia) {
    if (selection.length >= 3) {
      break;
    }

    selection.push(item);
  }

  return selection.slice(0, 3);
}

function pickDistinctMedia(items, count, excludedModelSlugs = new Set(), recentPreviewKeys = new Set()) {
  const shuffledItems = shuffleWithPreviewVariety(items, recentPreviewKeys);
  const selected = [];
  const usedModelSlugs = new Set(excludedModelSlugs);

  for (const item of shuffledItems) {
    if (selected.length >= count) {
      break;
    }

    const modelSlug = toText(item.modelSlug);

    if (modelSlug && usedModelSlugs.has(modelSlug)) {
      continue;
    }

    selected.push(item);

    if (modelSlug) {
      usedModelSlugs.add(modelSlug);
    }
  }

  if (selected.length >= count) {
    return selected;
  }

  for (const item of shuffledItems) {
    if (selected.length >= count) {
      break;
    }

    if (selected.some((selectedItem) => selectedItem.id === item.id)) {
      continue;
    }

    selected.push(item);
  }

  return selected;
}

function getRandomSitewideMediaSelection(siteContent, recentPreviewKeys = new Set()) {
  const models = Array.isArray(siteContent?.models) ? siteContent.models : [];
  const videos = [];
  const images = [];

  for (const model of models) {
    const modelSlug = getModelRouteSlug(model);
    const gallery = Array.isArray(model.gallery) ? model.gallery : [];

    for (const item of gallery) {
      if (item.type === 'video' && toText(item.src)) {
        videos.push({ ...item, modelSlug, modelName: model.name });
      }

      if (item.type === 'image' && toText(item.thumbnail)) {
        images.push({ ...item, modelSlug, modelName: model.name });
      }
    }
  }

  const selectedVideos = pickDistinctMedia(videos, 2, new Set(), recentPreviewKeys);
  const selectedImages = pickDistinctMedia(
    images,
    1,
    new Set(selectedVideos.map((item) => toText(item.modelSlug)).filter(Boolean)),
    recentPreviewKeys,
  );

  return [...selectedVideos, ...selectedImages];
}

async function consumePreviewUsage(chatId, options) {
  const currentCustomer = (await options.billingStore.getCustomer(chatId)) || {};
  const currentUsage = getPreviewUsage(currentCustomer, options.paymentConfig.previewUsageWindowMs);

  if (!currentUsage.canUse) {
    return {
      allowed: false,
      usage: currentUsage,
      customer: currentCustomer,
    };
  }

  const nextWindowStartedAt = currentUsage.count > 0 && currentUsage.windowStartedAt
    ? currentUsage.windowStartedAt
    : new Date().toISOString();

  const nextCustomer = await options.billingStore.upsertCustomer(chatId, {
    previewUsageDate: '',
    previewUsageCount: currentUsage.count + 1,
    previewUsageWindowStartedAt: nextWindowStartedAt,
  });

  return {
    allowed: true,
    usage: getPreviewUsage(nextCustomer, options.paymentConfig.previewUsageWindowMs),
    customer: nextCustomer,
  };
}

function buildModelKeyboard(model, siteUrl, groupUrl) {
  const options =
    typeof siteUrl === 'object' && siteUrl !== null
      ? siteUrl
      : {
          siteUrl,
          groupUrl,
          paymentConfig: {
            enabled: false,
            amount: 0,
          },
        };
  const rows = [];

  if (options.paymentConfig?.enabled) {
    const plans = getPaymentPlans(options);

    for (const plan of plans) {
      rows.push([
        {
          text: `💎 ${buildPaymentLabel(plan)}`,
          callback_data: `pay:${normalizePlanId(plan.id)}:${getModelRouteSlug(model)}`,
        },
      ]);
    }
  }

  rows.push([
    {
      text: 'Abrir pagina da modelo',
      url: buildModelUrl(options.siteUrl, model),
    },
  ]);
  rows.push([{ text: 'Voltar aos modelos', callback_data: 'list-models' }]);

  return {
    inline_keyboard: rows,
  };
}

function createTelegramFileCache(cacheFilePath) {
  let cache = {};
  let isLoaded = false;
  let writeQueue = Promise.resolve();
  let cacheFileUpdatedAtMs = 0;

  function normalizeCacheEntry(entry) {
    if (!entry) {
      return {
        fileId: '',
        signature: '',
        legacy: false,
      };
    }

    if (typeof entry === 'string') {
      return {
        fileId: toText(entry),
        signature: '',
        legacy: true,
      };
    }

    if (typeof entry === 'object') {
      return {
        fileId: toText(entry.fileId || entry.file_id || entry.id),
        signature: toText(entry.signature),
        legacy: false,
      };
    }

    return {
      fileId: '',
      signature: '',
      legacy: false,
    };
  }

  async function ensureLoaded() {
    if (isLoaded || !cacheFilePath) {
      return;
    }

    isLoaded = true;

    try {
      const raw = await fs.readFile(cacheFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = parsed && typeof parsed === 'object' ? parsed : {};
      const stats = await fs.stat(cacheFilePath);
      cacheFileUpdatedAtMs = Number(stats.mtimeMs || 0);
    } catch {
      cache = {};
      cacheFileUpdatedAtMs = 0;
    }
  }

  return {
    async getEntry(assetUrl) {
      const normalizedAssetUrl = toText(assetUrl);

      if (!normalizedAssetUrl) {
        return {
          fileId: '',
          signature: '',
          legacy: false,
          cacheFileUpdatedAtMs: 0,
        };
      }

      await ensureLoaded();
      return {
        ...normalizeCacheEntry(cache[normalizedAssetUrl]),
        cacheFileUpdatedAtMs,
      };
    },
    async get(assetUrl) {
      const entry = await this.getEntry(assetUrl);
      return entry.fileId;
    },
    async delete(assetUrl) {
      const normalizedAssetUrl = toText(assetUrl);

      if (!normalizedAssetUrl || !cacheFilePath) {
        return;
      }

      await ensureLoaded();

      if (!(normalizedAssetUrl in cache)) {
        return;
      }

      delete cache[normalizedAssetUrl];
      writeQueue = writeQueue
        .then(async () => {
          await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
          await fs.writeFile(cacheFilePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
          cacheFileUpdatedAtMs = Date.now();
        })
        .catch((error) => {
          console.error('Falha ao limpar cache de arquivos do Telegram:', error);
        });

      await writeQueue;
    },
    async set(assetUrl, fileId, metadata = {}) {
      const normalizedAssetUrl = toText(assetUrl);
      const normalizedFileId = toText(fileId);
      const normalizedSignature = toText(metadata.signature);

      if (!normalizedAssetUrl || !normalizedFileId || !cacheFilePath) {
        return;
      }

      await ensureLoaded();

      const currentEntry = normalizeCacheEntry(cache[normalizedAssetUrl]);

      if (
        currentEntry.fileId === normalizedFileId &&
        currentEntry.signature === normalizedSignature
      ) {
        return;
      }

      cache[normalizedAssetUrl] = {
        fileId: normalizedFileId,
        signature: normalizedSignature,
        updatedAt: new Date().toISOString(),
      };
      writeQueue = writeQueue
        .then(async () => {
          await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
          await fs.writeFile(cacheFilePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
          cacheFileUpdatedAtMs = Date.now();
        })
        .catch((error) => {
          console.error('Falha ao salvar cache de arquivos do Telegram:', error);
        });

      await writeQueue;
    },
  };
}

async function getLocalAssetSignatureInfo(assetUrl, resolveLocalAssetPath, preferredFilePath = '') {
  const candidatePaths = [toText(preferredFilePath)];

  if (typeof resolveLocalAssetPath === 'function') {
    candidatePaths.push(toText(resolveLocalAssetPath(assetUrl)));
  }

  for (const candidatePath of candidatePaths.filter(Boolean)) {
    try {
      const stats = await fs.stat(candidatePath);
      return {
        signature: `${Number(stats.size || 0)}:${Math.round(Number(stats.mtimeMs || 0))}`,
        mtimeMs: Math.round(Number(stats.mtimeMs || 0)),
        filePath: candidatePath,
      };
    } catch {
      // Continua tentando outros caminhos possiveis.
    }
  }

  return {
    signature: '',
    mtimeMs: 0,
    filePath: '',
  };
}

async function computeLocalAssetSignature(assetUrl, resolveLocalAssetPath, preferredFilePath = '') {
  const info = await getLocalAssetSignatureInfo(
    assetUrl,
    resolveLocalAssetPath,
    preferredFilePath,
  );
  return info.signature;
}

async function getValidCachedFileId(
  assetUrl,
  resolveLocalAssetPath,
  telegramFileCache,
  preferredFilePath = '',
) {
  const normalizedAssetUrl = toText(assetUrl);

  if (!normalizedAssetUrl) {
    return '';
  }

  const cacheEntry = await telegramFileCache?.getEntry?.(normalizedAssetUrl);
  const cachedFileId = toText(cacheEntry?.fileId);

  if (!cachedFileId) {
    return '';
  }

  const currentSignatureInfo = await getLocalAssetSignatureInfo(
    normalizedAssetUrl,
    resolveLocalAssetPath,
    preferredFilePath,
  );
  const currentSignature = currentSignatureInfo.signature;

  if (!currentSignature) {
    return cachedFileId;
  }

  if (!toText(cacheEntry?.signature)) {
    if (
      Boolean(cacheEntry?.legacy) &&
      Number(cacheEntry?.cacheFileUpdatedAtMs || 0) > 0 &&
      currentSignatureInfo.mtimeMs > Number(cacheEntry?.cacheFileUpdatedAtMs || 0) + 1000
    ) {
      await telegramFileCache?.delete?.(normalizedAssetUrl);
      return '';
    }

    return cachedFileId;
  }

  if (toText(cacheEntry?.signature) !== currentSignature) {
    await telegramFileCache?.delete?.(normalizedAssetUrl);
    return '';
  }

  return cachedFileId;
}

async function storeTelegramCachedFileId(
  telegramFileCache,
  assetUrl,
  fileId,
  resolveLocalAssetPath,
  preferredFilePath = '',
) {
  const normalizedFileId = toText(fileId);

  if (!normalizedFileId) {
    return;
  }

  const signature = await computeLocalAssetSignature(
    assetUrl,
    resolveLocalAssetPath,
    preferredFilePath,
  );

  await telegramFileCache?.set?.(assetUrl, normalizedFileId, { signature });
}

async function telegramRequest(token, method, payload) {
  const response = await fetch(`${telegramApiBase}/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Falha ao chamar ${method}.`);
  }

  return data.result;
}

async function telegramMultipartRequest(token, method, buildFormData) {
  const formData = new FormData();
  await buildFormData(formData);

  const response = await fetch(`${telegramApiBase}/bot${token}/${method}`, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Falha ao chamar ${method}.`);
  }

  return data.result;
}

async function configureTelegramCommands(token) {
  await telegramRequest(token, 'setMyCommands', {
    commands: telegramBotCommands,
  });

  await telegramRequest(token, 'setChatMenuButton', {
    menu_button: {
      type: 'commands',
    },
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createUploadBlob(filePath) {
  return openAsBlob(filePath);
}

function getTelegramUploadLimitBytes(mediaType) {
  return toText(mediaType).toLowerCase() === 'image'
    ? telegramPhotoUploadLimitBytes
    : telegramOtherUploadLimitBytes;
}

function getTelegramUploadTooBigMessage() {
  return 'Arquivo acima do limite aceito pelo Bot do Telegram para esse tipo de envio.';
}

async function assertTelegramUploadWithinLimit(mediaSource, mediaType = 'video') {
  if (mediaSource?.kind !== 'local' || !mediaSource?.filePath) {
    return;
  }

  const stats = await fs.stat(mediaSource.filePath);

  if (Number(stats.size || 0) > getTelegramUploadLimitBytes(mediaType)) {
    throw new Error(getTelegramUploadTooBigMessage());
  }
}

function extractTelegramFileId(message) {
  if (Array.isArray(message?.photo) && message.photo.length > 0) {
    return toText(message.photo[message.photo.length - 1]?.file_id);
  }

  if (message?.video?.file_id) {
    return toText(message.video.file_id);
  }

  if (message?.document?.file_id) {
    return toText(message.document.file_id);
  }

  return '';
}

async function resolveTelegramMediaSource(
  assetUrl,
  siteUrl,
  resolveLocalAssetPath,
  telegramFileCache,
  skipCache = false,
) {
  const normalizedAssetUrl = toText(assetUrl);

  if (!normalizedAssetUrl) {
    return null;
  }

  const localAssetPath = resolveLocalAssetPath?.(normalizedAssetUrl);
  const cachedFileId = skipCache
    ? ''
    : await getValidCachedFileId(
        normalizedAssetUrl,
        resolveLocalAssetPath,
        telegramFileCache,
        localAssetPath,
      );

  if (cachedFileId) {
    return {
      kind: 'file-id',
      value: cachedFileId,
      assetUrl: normalizedAssetUrl,
    };
  }

  if (shouldPreferRemoteMedia(siteUrl)) {
    return {
      kind: 'remote',
      value: buildAbsoluteAssetUrl(siteUrl, normalizedAssetUrl),
      assetUrl: normalizedAssetUrl,
    };
  }

  if (localAssetPath && (await pathExists(localAssetPath))) {
    return {
      kind: 'local',
      filePath: localAssetPath,
      filename: path.basename(localAssetPath),
      assetUrl: normalizedAssetUrl,
    };
  }

  return {
    kind: 'remote',
    value: buildAbsoluteAssetUrl(siteUrl, normalizedAssetUrl),
    assetUrl: normalizedAssetUrl,
  };
}

function isTelegramInvalidCachedFileError(error) {
  const message = toText(error instanceof Error ? error.message : String(error)).toLowerCase();

  return (
    message.includes('wrong file identifier') ||
    message.includes('wrong file_id') ||
    message.includes('wrong remote file identifier') ||
    message.includes('file reference') ||
    message.includes('file is temporarily unavailable')
  );
}

async function validateTelegramCachedFile(
  token,
  assetUrl,
  telegramFileCache,
  resolveLocalAssetPath = null,
) {
  const normalizedAssetUrl = toText(assetUrl);
  const cacheEntry = await telegramFileCache?.getEntry?.(normalizedAssetUrl);
  const cachedFileId = toText(cacheEntry?.fileId);

  if (!cachedFileId) {
    return {
      ok: true,
      cached: false,
      reason: 'not-cached',
    };
  }

  const currentSignatureInfo = await getLocalAssetSignatureInfo(
    normalizedAssetUrl,
    resolveLocalAssetPath,
    '',
  );
  const currentSignature = currentSignatureInfo.signature;

  if (
    currentSignature &&
    !toText(cacheEntry?.signature) &&
    Boolean(cacheEntry?.legacy) &&
    Number(cacheEntry?.cacheFileUpdatedAtMs || 0) > 0 &&
    currentSignatureInfo.mtimeMs > Number(cacheEntry?.cacheFileUpdatedAtMs || 0) + 1000
  ) {
    await telegramFileCache?.delete?.(normalizedAssetUrl);

    return {
      ok: true,
      cached: false,
      reason: 'cache-content-changed',
    };
  }

  if (
    currentSignature &&
    toText(cacheEntry?.signature) &&
    toText(cacheEntry?.signature) !== currentSignature
  ) {
    await telegramFileCache?.delete?.(normalizedAssetUrl);

    return {
      ok: true,
      cached: false,
      reason: 'cache-content-changed',
    };
  }

  try {
    await telegramRequest(token, 'getFile', {
      file_id: cachedFileId,
    });

    if (currentSignature && !toText(cacheEntry?.signature)) {
      await telegramFileCache?.set?.(normalizedAssetUrl, cachedFileId, {
        signature: currentSignature,
      });
    }

    return {
      ok: true,
      cached: true,
      reason: 'already-cached',
      fileId: cachedFileId,
    };
  } catch (error) {
    if (isTelegramInvalidCachedFileError(error)) {
      await telegramFileCache?.delete?.(normalizedAssetUrl);

      return {
        ok: true,
        cached: false,
        reason: 'cache-invalidated',
      };
    }

    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'cache-validation-failed',
    };
  }
}

async function rebuildFreshMediaSource(mediaSource, mediaRetryOptions) {
  const assetUrl = toText(mediaSource?.assetUrl);

  if (!assetUrl || !mediaRetryOptions) {
    return mediaSource;
  }

  return resolveTelegramMediaSource(
    assetUrl,
    mediaRetryOptions.siteUrl,
    mediaRetryOptions.resolveLocalAssetPath,
    mediaRetryOptions.telegramFileCache,
    true,
  );
}

async function resolveTelegramMediaSourceForCacheWarm(assetUrl, options, skipCache = false) {
  const normalizedAssetUrl = toText(assetUrl);

  if (!normalizedAssetUrl) {
    return null;
  }

  const localAssetPath = options.resolveLocalAssetPath?.(normalizedAssetUrl);
  const cachedFileId = skipCache
    ? ''
    : await getValidCachedFileId(
        normalizedAssetUrl,
        options.resolveLocalAssetPath,
        options.telegramFileCache,
        localAssetPath,
      );

  if (cachedFileId) {
    return {
      kind: 'file-id',
      value: cachedFileId,
      assetUrl: normalizedAssetUrl,
    };
  }

  if (localAssetPath && (await pathExists(localAssetPath))) {
    return {
      kind: 'local',
      filePath: localAssetPath,
      filename: path.basename(localAssetPath),
      assetUrl: normalizedAssetUrl,
    };
  }

  return resolveTelegramMediaSource(
    normalizedAssetUrl,
    options.siteUrl,
    options.resolveLocalAssetPath,
    options.telegramFileCache,
    true,
  );
}

async function buildPreviewMediaSources(items, options) {
  return Promise.all(
    items.map(async (item) => {
      const mediaSource = await resolveTelegramMediaSource(
        item.type === 'video' ? item.src : item.thumbnail,
        options.siteUrl,
        options.resolveLocalAssetPath,
        options.telegramFileCache,
      );

      if (!mediaSource) {
        return null;
      }

      return {
        type: item.type === 'video' ? 'video' : 'photo',
        media: mediaSource,
        supports_streaming: item.type === 'video',
        width: Number.isFinite(Number(item.width)) ? Number(item.width) : undefined,
        height: Number.isFinite(Number(item.height)) ? Number(item.height) : undefined,
      };
    }),
  ).then((results) => results.filter(Boolean));
}

async function estimatePreviewLoadingSeconds(mediaSources) {
  let seconds = 2;

  for (const item of mediaSources) {
    const mediaKind = toText(item?.media?.kind);

    if (mediaKind === 'file-id') {
      seconds += item.type === 'video' ? 0.8 : 0.5;
      continue;
    }

    if (mediaKind === 'remote') {
      seconds += item.type === 'video' ? 1.8 : 1.1;
      continue;
    }

    if (mediaKind === 'local') {
      let sizeMb = 0;

      try {
        const stats = await fs.stat(item.media.filePath);
        sizeMb = Math.max(0, Number(stats.size || 0) / (1024 * 1024));
      } catch {
        sizeMb = 0;
      }

      seconds += item.type === 'video' ? 3 + sizeMb / 6 : 1.5 + sizeMb / 12;
    }
  }

  return Math.max(3, Math.min(25, Math.ceil(seconds)));
}

function buildPreviewLoadingText(
  remainingSeconds,
  loadingLabel = 'prévia(s)',
  loadingPrefix = 'Carregando',
) {
  return `⏳ ${loadingPrefix} ${loadingLabel}...\nTempo restante aprox.: ${Math.max(
    1,
    Math.ceil(remainingSeconds),
  )}s`;
}

async function createPreviewLoadingController(
  token,
  chatId,
  mediaSources,
  loadingLabel = 'prévia(s)',
  loadingPrefix = 'Carregando',
  loadedLabel = '✅ Conteúdo carregado.',
) {
  const estimatedSeconds = await estimatePreviewLoadingSeconds(mediaSources);
  const loadingMessage = await sendPlainText(
    token,
    chatId,
    buildPreviewLoadingText(estimatedSeconds, loadingLabel, loadingPrefix),
  );
  const messageId = Number.isInteger(loadingMessage?.message_id)
    ? loadingMessage.message_id
    : 0;

  if (!messageId) {
    return {
      async stop() {},
    };
  }

  let stopped = false;
  let remainingSeconds = estimatedSeconds;
  let isUpdating = false;
  const intervalId = setInterval(() => {
    if (stopped || isUpdating) {
      return;
    }

    remainingSeconds = Math.max(1, remainingSeconds - 1);
    isUpdating = true;

    editMessageText(
      token,
      chatId,
      messageId,
      buildPreviewLoadingText(remainingSeconds, loadingLabel, loadingPrefix),
    )
      .catch(() => {})
      .finally(() => {
        isUpdating = false;
      });
  }, 1000);

  return {
    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(intervalId);

      try {
        await deleteMessage(token, chatId, messageId);
      } catch {
        try {
          await editMessageText(token, chatId, messageId, loadedLabel);
          await deleteMessage(token, chatId, messageId);
        } catch {
          // Ignora falha ao limpar indicador temporario.
        }
      }
    },
  };
}

async function sendPreviewMediaSelection(
  token,
  chatId,
  items,
  options,
  loadingOptions = {},
) {
  const mediaSources = await buildPreviewMediaSources(items, options);

  if (mediaSources.length === 0) {
    return null;
  }

  const loadingController = await createPreviewLoadingController(
    token,
    chatId,
      mediaSources,
      loadingOptions.loadingLabel || 'prévia(s)',
      loadingOptions.loadingPrefix || 'Carregando',
      loadingOptions.loadedLabel || '✅ Conteúdo carregado.',
  );

  try {
    const mediaRetryOptions = {
      siteUrl: options.siteUrl,
      resolveLocalAssetPath: options.resolveLocalAssetPath,
      telegramFileCache: options.telegramFileCache,
      allowRetry: true,
    };

    if (mediaSources.length === 1) {
      const [singleItem] = mediaSources;

      if (singleItem.type === 'video') {
        return await sendVideo(
          token,
          chatId,
          singleItem.media,
          loadingOptions.caption || '',
          {
            ...(singleItem.width ? { width: singleItem.width } : {}),
            ...(singleItem.height ? { height: singleItem.height } : {}),
          },
          options.telegramFileCache,
          mediaRetryOptions,
        );
      }

      return await sendPhoto(
        token,
        chatId,
        singleItem.media,
        loadingOptions.caption || '',
        {},
        options.telegramFileCache,
        mediaRetryOptions,
      );
    }

    return await sendMediaGroup(
      token,
      chatId,
      mediaSources,
      options.telegramFileCache,
      mediaRetryOptions,
    );
  } finally {
    await loadingController.stop();
  }
}

function applyTelegramRichText(text, parseMode) {
  const content = typeof text === 'string' ? text : '';

  if (!content || parseMode !== 'HTML') {
    return content;
  }

  return content
    .replace(/\*([^*\n][\s\S]*?)\*/g, '<b>$1</b>')
    .replace(/_([^_\n][\s\S]*?)_/g, '<i>$1</i>')
    .replace(/`([^`\n]+?)`/g, '<code>$1</code>');
}

async function sendText(token, chatId, text, extra = {}) {
  const {
    parseMode = 'HTML',
    disableWebPagePreview = true,
    ...rest
  } = extra;
  const payload = {
    chat_id: chatId,
    text: applyTelegramRichText(text, parseMode),
    disable_web_page_preview: disableWebPagePreview,
    ...rest,
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  return telegramRequest(token, 'sendMessage', payload);
}

async function editMessageText(token, chatId, messageId, text, extra = {}) {
  const {
    parseMode = 'HTML',
    disableWebPagePreview = true,
    ...rest
  } = extra;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: applyTelegramRichText(text, parseMode),
    disable_web_page_preview: disableWebPagePreview,
    ...rest,
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  return telegramRequest(token, 'editMessageText', payload);
}

async function sendHtmlText(token, chatId, html, extra = {}) {
  return sendText(token, chatId, html, { ...extra, parseMode: 'HTML' });
}

async function sendPlainText(token, chatId, text, extra = {}) {
  return sendText(token, chatId, text, { ...extra, parseMode: null });
}

async function sendPhoto(
  token,
  chatId,
  photoSource,
  caption,
  extra = {},
  telegramFileCache,
  mediaRetryOptions = null,
) {
  if (photoSource?.kind === 'local') {
    await assertTelegramUploadWithinLimit(photoSource, 'image');
    const result = await telegramMultipartRequest(token, 'sendPhoto', async (formData) => {
      formData.append('chat_id', String(chatId));
      if (caption) {
        formData.append('caption', applyTelegramRichText(caption, 'HTML'));
        formData.append('parse_mode', 'HTML');
      }
      formData.append('photo', await createUploadBlob(photoSource.filePath), photoSource.filename);

      for (const [key, value] of Object.entries(extra)) {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    });

    await storeTelegramCachedFileId(
      telegramFileCache,
      photoSource?.assetUrl,
      extractTelegramFileId(result),
      mediaRetryOptions?.resolveLocalAssetPath,
      photoSource?.filePath,
    );
    return result;
  }

  try {
    const result = await telegramRequest(token, 'sendPhoto', {
      chat_id: chatId,
      photo: photoSource?.value,
      ...(caption
        ? {
            caption: applyTelegramRichText(caption, 'HTML'),
            parse_mode: 'HTML',
          }
        : {}),
      ...extra,
    });

    await storeTelegramCachedFileId(
      telegramFileCache,
      photoSource?.assetUrl,
      extractTelegramFileId(result),
      mediaRetryOptions?.resolveLocalAssetPath,
    );
    return result;
  } catch (error) {
    if (
      photoSource?.kind === 'file-id' &&
      mediaRetryOptions?.allowRetry !== false &&
      isTelegramInvalidCachedFileError(error)
    ) {
      await telegramFileCache?.delete?.(photoSource?.assetUrl);
      const freshSource = await rebuildFreshMediaSource(photoSource, mediaRetryOptions);
      return sendPhoto(
        token,
        chatId,
        freshSource,
        caption,
        extra,
        telegramFileCache,
        {
          ...mediaRetryOptions,
          allowRetry: false,
        },
      );
    }

    throw error;
  }
}

async function sendPhotoBuffer(token, chatId, buffer, filename, caption, extra = {}) {
  return telegramMultipartRequest(token, 'sendPhoto', async (formData) => {
    formData.append('chat_id', String(chatId));

    if (caption) {
      formData.append('caption', applyTelegramRichText(caption, 'HTML'));
      formData.append('parse_mode', 'HTML');
    }

    formData.append('photo', new Blob([buffer]), filename);

    for (const [key, value] of Object.entries(extra)) {
      formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  });
}

async function sendVideo(
  token,
  chatId,
  videoSource,
  caption = '',
  extra = {},
  telegramFileCache,
  mediaRetryOptions = null,
) {
  if (videoSource?.kind === 'local') {
    await assertTelegramUploadWithinLimit(videoSource, 'video');
    const result = await telegramMultipartRequest(token, 'sendVideo', async (formData) => {
      formData.append('chat_id', String(chatId));
      if (caption) {
        formData.append('caption', applyTelegramRichText(caption, 'HTML'));
        formData.append('parse_mode', 'HTML');
      }
      formData.append('supports_streaming', 'true');
      formData.append('video', await createUploadBlob(videoSource.filePath), videoSource.filename);

      for (const [key, value] of Object.entries(extra)) {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    });

    await storeTelegramCachedFileId(
      telegramFileCache,
      videoSource?.assetUrl,
      extractTelegramFileId(result),
      mediaRetryOptions?.resolveLocalAssetPath,
      videoSource?.filePath,
    );
    return result;
  }

  try {
    const result = await telegramRequest(token, 'sendVideo', {
      chat_id: chatId,
      video: videoSource?.value,
      supports_streaming: true,
      ...(caption
        ? {
            caption: applyTelegramRichText(caption, 'HTML'),
            parse_mode: 'HTML',
          }
        : {}),
      ...extra,
    });

    await storeTelegramCachedFileId(
      telegramFileCache,
      videoSource?.assetUrl,
      extractTelegramFileId(result),
      mediaRetryOptions?.resolveLocalAssetPath,
    );
    return result;
  } catch (error) {
    if (
      videoSource?.kind === 'file-id' &&
      mediaRetryOptions?.allowRetry !== false &&
      isTelegramInvalidCachedFileError(error)
    ) {
      await telegramFileCache?.delete?.(videoSource?.assetUrl);
      const freshSource = await rebuildFreshMediaSource(videoSource, mediaRetryOptions);
      return sendVideo(
        token,
        chatId,
        freshSource,
        caption,
        extra,
        telegramFileCache,
        {
          ...mediaRetryOptions,
          allowRetry: false,
        },
      );
    }

    throw error;
  }
}

async function sendMediaGroup(
  token,
  chatId,
  mediaSources,
  telegramFileCache,
  mediaRetryOptions = null,
) {
  const hasLocalFile = mediaSources.some((item) => item.media?.kind === 'local');

  try {
    if (!hasLocalFile) {
      const result = await telegramRequest(token, 'sendMediaGroup', {
        chat_id: chatId,
        media: mediaSources.map((item) => ({
          type: item.type,
          media: item.media?.value,
          ...(item.supports_streaming ? { supports_streaming: true } : {}),
          ...(item.width ? { width: item.width } : {}),
          ...(item.height ? { height: item.height } : {}),
        })),
      });

      await Promise.all(
        result.map((message, index) =>
          storeTelegramCachedFileId(
            telegramFileCache,
            mediaSources[index]?.media?.assetUrl,
            extractTelegramFileId(message),
            mediaRetryOptions?.resolveLocalAssetPath,
          ),
        ),
      );

      return result;
    }

    const result = await telegramMultipartRequest(token, 'sendMediaGroup', async (formData) => {
      formData.append('chat_id', String(chatId));

      const mediaPayload = [];

      for (let index = 0; index < mediaSources.length; index += 1) {
        const item = mediaSources[index];

        if (item.media?.kind === 'local') {
          await assertTelegramUploadWithinLimit(
            item.media,
            item.type === 'photo' ? 'image' : 'video',
          );
          const attachmentName = `file${index}`;
          formData.append(
            attachmentName,
            await createUploadBlob(item.media.filePath),
            item.media.filename,
          );
          mediaPayload.push({
            type: item.type,
            media: `attach://${attachmentName}`,
            ...(item.supports_streaming ? { supports_streaming: true } : {}),
            ...(item.width ? { width: item.width } : {}),
            ...(item.height ? { height: item.height } : {}),
          });
          continue;
        }

        mediaPayload.push({
          type: item.type,
          media: item.media?.value,
          ...(item.supports_streaming ? { supports_streaming: true } : {}),
          ...(item.width ? { width: item.width } : {}),
          ...(item.height ? { height: item.height } : {}),
        });
      }

      formData.append('media', JSON.stringify(mediaPayload));
    });

    await Promise.all(
      result.map((message, index) =>
        storeTelegramCachedFileId(
          telegramFileCache,
          mediaSources[index]?.media?.assetUrl,
          extractTelegramFileId(message),
          mediaRetryOptions?.resolveLocalAssetPath,
          mediaSources[index]?.media?.kind === 'local'
            ? mediaSources[index]?.media?.filePath
            : '',
        ),
      ),
    );

    return result;
  } catch (error) {
    const cachedItems = mediaSources.filter((item) => item.media?.kind === 'file-id');

    if (
      cachedItems.length > 0 &&
      mediaRetryOptions?.allowRetry !== false &&
      isTelegramInvalidCachedFileError(error)
    ) {
      await Promise.all(
        cachedItems.map((item) => telegramFileCache?.delete?.(item.media?.assetUrl)),
      );

      const freshMediaSources = await Promise.all(
        mediaSources.map(async (item) => ({
          ...item,
          media: await rebuildFreshMediaSource(item.media, mediaRetryOptions),
        })),
      );

      return sendMediaGroup(token, chatId, freshMediaSources, telegramFileCache, {
        ...mediaRetryOptions,
        allowRetry: false,
      });
    }

    throw error;
  }
}

async function warmMediaAssetToTelegramCache(token, assetUrl, mediaType, options) {
  const cacheChatId = toText(options?.cacheChatId);

  if (!cacheChatId) {
    return {
      ok: false,
      reason: 'cache-chat-disabled',
    };
  }

  let mediaSource = await resolveTelegramMediaSourceForCacheWarm(
    assetUrl,
    options,
  );

  if (!mediaSource) {
    return {
      ok: false,
      reason: 'asset-not-found',
    };
  }

  if (mediaSource.kind === 'file-id') {
    const validation = await validateTelegramCachedFile(
      token,
      assetUrl,
      options.telegramFileCache,
      options.resolveLocalAssetPath,
    );

    if (!validation.ok) {
      return validation;
    }

    if (validation.cached) {
      return {
        ok: true,
        cached: true,
        reason: 'already-cached',
      };
    }

    mediaSource = await resolveTelegramMediaSourceForCacheWarm(
      assetUrl,
      options,
      true,
    );
  }

  const mediaRetryOptions = {
    siteUrl: options.siteUrl,
    resolveLocalAssetPath: options.resolveLocalAssetPath,
    telegramFileCache: options.telegramFileCache,
    allowRetry: true,
  };

  const message =
    mediaType === 'video'
      ? await sendVideo(
          token,
          cacheChatId,
          mediaSource,
          '',
          {},
          options.telegramFileCache,
          mediaRetryOptions,
        )
      : await sendPhoto(
          token,
          cacheChatId,
          mediaSource,
          '',
          {},
          options.telegramFileCache,
          mediaRetryOptions,
        );

  if (Number.isInteger(message?.message_id)) {
    try {
      await deleteMessage(token, cacheChatId, message.message_id);
    } catch {
      // Se a exclusao falhar, a cache ainda continua valida.
    }
  }

  return {
    ok: true,
    cached: false,
    fileId: extractTelegramFileId(message),
  };
}

async function checkMediaAssetTelegramCache(token, assetUrl, _mediaType, options) {
  const normalizedAssetUrl = toText(assetUrl);

  if (!normalizedAssetUrl) {
    return {
      ok: false,
      reason: 'asset-not-found',
    };
  }

  const validation = await validateTelegramCachedFile(
    token,
    normalizedAssetUrl,
    options.telegramFileCache,
    options.resolveLocalAssetPath,
  );

  if (!validation.ok) {
    return validation;
  }

  if (validation.cached) {
    return {
      ok: true,
      cached: true,
      reason: 'already-cached',
    };
  }

  return {
    ok: true,
    cached: false,
    reason: validation.reason || 'not-cached',
  };
}

async function answerCallbackQuery(token, callbackQueryId, text = '', extra = {}) {
  return telegramRequest(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    ...extra,
  });
}

async function deleteMessage(token, chatId, messageId) {
  return telegramRequest(token, 'deleteMessage', {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function editMessageReplyMarkup(token, chatId, messageId, replyMarkup) {
  return telegramRequest(token, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

function findModelByInput(models, input) {
  const normalizedInput = sanitizeModelSlug(input);

  return (
    models.find((model) => getModelRouteSlug(model) === normalizedInput) ||
    models.find((model) => getFirstNameSlug(model) === normalizedInput) ||
    models.find((model) => sanitizeModelSlug(model.name) === normalizedInput) ||
    null
  );
}

async function syncTelegramCustomer(billingStore, chatId, telegramUser) {
  if (!billingStore || !telegramUser) {
    return null;
  }

  return billingStore.upsertCustomer(chatId, {
    telegramUserId: telegramUser.id,
    firstName: toText(telegramUser.first_name),
    lastName: toText(telegramUser.last_name),
    username: toText(telegramUser.username),
    fullName:
      [toText(telegramUser.first_name), toText(telegramUser.last_name)].filter(Boolean).join(' ') ||
      toText(telegramUser.username),
  });
}

async function sendActiveSubscriptionMessage(token, chatId, subscription, options) {
  if (!subscription) {
    return sendText(
      token,
      chatId,
      '🔐 Voce ainda nao tem um acesso ativo.\n\n💳 Gere o Pix para liberar sua entrada no grupo privado.',
      {
        reply_markup: await buildStartKeyboardForChat(chatId, options),
      },
    );
  }

  const modelLine = subscription.modelName ? `👤 Origem: ${subscription.modelName}\n` : '';
  const planLine = subscription.planName
    ? `💎 Plano: ${subscription.planName}${subscription.displayAmount ? ` • ${formatCurrencyBRL(subscription.displayAmount)}` : ''}\n`
    : subscription.planDurationLabel
      ? `💎 Plano: ${subscription.planDurationLabel}\n`
      : '';

  return sendText(
    token,
    chatId,
    `🔓 *Meu acesso*\n\n${planLine}${modelLine}✅ Seu acesso ao grupo privado esta liberado.\n\n👇 Use o botao abaixo para entrar no grupo privado.`,
    {
      reply_markup: buildAccessKeyboard(subscription, options.siteUrl),
    },
  );
}

async function sendPaymentIntroVideo(token, chatId, payment, options) {
  const paymentPlan = getPaymentPlanForPayment(payment, options);
  const publicAmount = Number(payment.displayAmount || paymentPlan?.displayAmount || payment.amount || 0);
  const planName =
    toText(payment.planName) ||
    toText(paymentPlan?.name) ||
    (toText(payment.planDurationLabel) ? `Plano ${toText(payment.planDurationLabel)}` : 'Plano VIP');
  const publicPlanExpiryDate = getPublicPlanExpiryDate(payment, options);

  return sendPreviewMediaSelection(
    token,
    chatId,
    [
      {
        type: 'video',
        src: '/uploads/bot/intro2.mp4',
        width: 1080,
        height: 1920,
      },
    ],
    options,
    {
      loadingLabel: 'PIX',
      loadingPrefix: 'Gerando',
      loadedLabel: '✅ PIX gerado.',
      caption: [
        `💰 Valor: ${formatCurrencyBRL(publicAmount)}`,
        `💎 ${planName}${publicPlanExpiryDate ? ` (${publicPlanExpiryDate})` : ''}`,
        payment.modelName ? `👤 Modelo: ${payment.modelName}` : '',
        '✅ Acesso imediato',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  );
}

async function createPaymentQrBuffer(paymentCode) {
  return QRCode.toBuffer(paymentCode, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 900,
    color: {
      dark: '#101010',
      light: '#ffffff',
    },
  });
}

function decodePixCodeFromBase64(paymentCodeBase64) {
  const normalized = toText(paymentCodeBase64);

  if (!normalized) {
    return '';
  }

  try {
    return Buffer.from(normalized, 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
}

function decodeQrImageBuffer(paymentCodeBase64) {
  const normalized = toText(paymentCodeBase64);

  if (!normalized) {
    return null;
  }

  try {
    const buffer = Buffer.from(normalized, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

async function sendPixInstructions(token, chatId, payment, options) {
  const paymentCode =
    toText(payment.paymentCode) || decodePixCodeFromBase64(payment.paymentCodeBase64);
  const dueText = payment.pixExpiresAt
    ? formatDateTimeBR(payment.pixExpiresAt)
    : payment.dueAt
      ? formatDateTimeBR(payment.dueAt)
      : '';
  const sentMessageIds = [];

  try {
    const introMessage = await sendPaymentIntroVideo(token, chatId, payment, options);
    const introMessages = Array.isArray(introMessage) ? introMessage : [introMessage];

    for (const message of introMessages) {
      if (Number.isInteger(message?.message_id)) {
        sentMessageIds.push(message.message_id);
      }
    }
  } catch (error) {
    logBot('Falha ao enviar video introdutorio do Pix.', {
      chatId,
      paymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const pixMessage = await sendHtmlText(
    token,
    chatId,
    [
      '<b>💳 PIX Gerado</b>',
      paymentCode ? `<code>${escapeHtml(paymentCode)}</code>` : '',
      dueText ? `<b>⏰ Validade:</b> ${escapeHtml(dueText)}` : '',
      !paymentCode ? 'A Syncpay nao retornou o codigo Pix.' : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    {
    reply_markup: buildPaymentKeyboard(payment, options.paymentConfig),
    },
  );

  if (Number.isInteger(pixMessage?.message_id)) {
    sentMessageIds.push(pixMessage.message_id);
  }

  await options.billingStore.updatePayment(payment.id, {
    paymentMessageIds: Array.from(
      new Set([...(Array.isArray(payment.paymentMessageIds) ? payment.paymentMessageIds : []), ...sentMessageIds]),
    ),
  });

  return pixMessage;
}

async function appendPaymentMessageIds(billingStore, payment, messageIds) {
  const validMessageIds = messageIds
    .map((messageId) => Number(messageId))
    .filter((messageId) => Number.isInteger(messageId) && messageId > 0);

  if (validMessageIds.length === 0) {
    return payment;
  }

  return (
    (await billingStore.updatePayment(payment.id, {
      paymentMessageIds: Array.from(
        new Set([
          ...(Array.isArray(payment.paymentMessageIds) ? payment.paymentMessageIds : []),
          ...validMessageIds,
        ]),
      ),
    })) || payment
  );
}

function getPaymentReminderPlanLabel(payment, options) {
  const paymentPlan = getPaymentPlanForPayment(payment, options);
  const normalizedPlanId = normalizePlanId(payment?.planId || paymentPlan?.id);

  if (normalizedPlanId === '7d') {
    return '7 dias';
  }

  if (normalizedPlanId === '30d') {
    return '1 mes';
  }

  return (
    toText(payment?.planDurationLabel) ||
    toText(paymentPlan?.durationLabel) ||
    toText(payment?.planName) ||
    toText(paymentPlan?.name) ||
    'seu plano'
  );
}

function buildPendingPaymentReminderText(payment, options) {
  const planLabel = getPaymentReminderPlanLabel(payment, options);

  return [
    '⚠️ Notamos que voce ainda nao concluiu o pagamento.',
    '',
    `Para garantir acesso ao <b>AllPrivacyVIP - ${escapeHtml(planLabel)}</b>, finalize seu pagamento o quanto antes. Assim que o pagamento for aprovado, o acesso sera liberado imediatamente!`,
    '',
    '✅ Realize o pagamento agora para nao perder essa oportunidade! ✅',
  ].join('\n');
}

async function sendPaymentCopyCode(token, chatId, paymentId, options, callbackId = '') {
  const payment = await options.billingStore.getPayment(paymentId);

  if (!payment || payment.chatId !== String(chatId)) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Nao encontrei esse Pix.', {
        show_alert: true,
      });
      return null;
    }

    return sendPlainText(token, chatId, 'Nao encontrei esse pagamento para o seu chat.');
  }

  const paymentCode =
    toText(payment.paymentCode) || decodePixCodeFromBase64(payment.paymentCodeBase64);

  if (!paymentCode) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Esse Pix nao tem codigo disponivel.', {
        show_alert: true,
      });
      return null;
    }

    return sendPlainText(token, chatId, 'Esse Pix nao tem codigo copia e cola disponivel agora.');
  }

  if (callbackId) {
    await answerCallbackQuery(token, callbackId, '✅ Chave PIX copiada.');
  }

  const copyMessage = await sendPlainText(
    token,
    chatId,
    '✅ Chave PIX copiada.',
  );

  if (Number.isInteger(copyMessage?.message_id)) {
    await appendPaymentMessageIds(options.billingStore, payment, [copyMessage.message_id]);
  }

  return copyMessage;
}

async function sendPaymentQrCode(token, chatId, paymentId, options, callbackId = '') {
  const payment = await options.billingStore.getPayment(paymentId);

  if (!payment || payment.chatId !== String(chatId)) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Nao encontrei esse Pix.', {
        show_alert: true,
      });
      return null;
    }

    return sendPlainText(token, chatId, 'Nao encontrei esse pagamento para o seu chat.');
  }

  const paymentCode =
    toText(payment.paymentCode) || decodePixCodeFromBase64(payment.paymentCodeBase64);

  if (!paymentCode) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Esse Pix nao tem QRCode disponivel.', {
        show_alert: true,
      });
      return null;
    }

    return sendPlainText(token, chatId, 'Esse Pix nao tem QRCode disponivel agora.');
  }

  if (callbackId) {
    await answerCallbackQuery(token, callbackId, 'Abrindo QRCode...');
  }

  const qrImageBuffer = await createPaymentQrBuffer(paymentCode);
  const expiryText = payment.pixExpiresAt
    ? formatDateTimeBR(payment.pixExpiresAt)
    : payment.dueAt
      ? formatDateTimeBR(payment.dueAt)
      : '';

  const qrMessage = await sendPhotoBuffer(
    token,
    chatId,
    qrImageBuffer,
    `${payment.id}-qrcode.png`,
    [
      '📷 *QRCode do PIX*',
      expiryText ? `⏰ Validade: ${expiryText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  );

  if (Number.isInteger(qrMessage?.message_id)) {
    await appendPaymentMessageIds(options.billingStore, payment, [qrMessage.message_id]);
  }

  return qrMessage;
}

async function deletePaymentMessages(token, payment, options) {
  const messageIds = Array.isArray(payment?.paymentMessageIds) ? payment.paymentMessageIds : [];

  for (const messageId of messageIds) {
    try {
      await deleteMessage(token, payment.chatId, messageId);
    } catch (error) {
      logBot('Falha ao apagar mensagem de Pix.', {
        paymentId: payment.id,
        chatId: payment.chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (messageIds.length > 0) {
    await options.billingStore.updatePayment(payment.id, {
      paymentMessageIds: [],
    });
  }
}

async function createGroupInviteLink(token, payment, expiresAt, options) {
  const expirationTimestamp = Date.parse(expiresAt);
  const paymentPlan = getPaymentPlanForPayment(payment, options);
  const fallbackExpiresAt = Math.floor(
    (Date.now() + Number(paymentPlan?.durationMs || options.paymentConfig.durationMs || 30000)) /
      1000,
  );

  return telegramRequest(token, 'createChatInviteLink', {
    chat_id: options.paymentConfig.privateGroupChatId,
    name: `AllPrivacy ${payment.id.slice(-8)}`,
    creates_join_request: true,
    expire_date: Number.isFinite(expirationTimestamp)
      ? Math.floor(expirationTimestamp / 1000)
      : fallbackExpiresAt,
  });
}

async function handleChatJoinRequest(token, joinRequest, options) {
  const chatId = String(joinRequest?.chat?.id ?? '');
  const telegramUserId = Number(joinRequest?.from?.id || 0);
  const inviteLink = toText(joinRequest?.invite_link?.invite_link);

  if (!chatId || !telegramUserId) {
    return;
  }

  if (
    !options.paymentConfig.privateGroupChatId ||
    chatId !== String(options.paymentConfig.privateGroupChatId)
  ) {
    return;
  }

  const subscription = await options.billingStore.getActiveSubscriptionByTelegramUserId(telegramUserId);
  const inviteMatches = !inviteLink || !subscription?.inviteLink || subscription.inviteLink === inviteLink;

  if (subscription && inviteMatches) {
    await telegramRequest(token, 'approveChatJoinRequest', {
      chat_id: options.paymentConfig.privateGroupChatId,
      user_id: telegramUserId,
    });

    logBot('Solicitacao de entrada aprovada.', {
      chatId,
      telegramUserId,
      subscriptionId: subscription.id,
    });

    await sendPlainText(
      token,
      subscription.chatId,
      `Entrada aprovada. Seu acesso fica liberado ate ${formatDateTimeBR(subscription.expiresAt)}.`,
    );
    return;
  }

  await telegramRequest(token, 'declineChatJoinRequest', {
    chat_id: options.paymentConfig.privateGroupChatId,
    user_id: telegramUserId,
  });

  logBot('Solicitacao de entrada recusada.', {
    chatId,
    telegramUserId,
    motivo: subscription ? 'invite-mismatch' : 'no-active-subscription',
  });

  try {
    await sendPlainText(
      token,
      telegramUserId,
      '🚫 Nao encontrei um acesso ativo para liberar sua entrada agora.\n\n💳 Gere ou confirme o Pix no bot e tente novamente.',
      {
        reply_markup: await buildStartKeyboardForChat(telegramUserId, options),
      },
    );
  } catch (error) {
    logBot('Nao foi possivel avisar usuario sobre entrada recusada.', {
      chatId,
      telegramUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function finalizeApprovedPayment(token, payment, options, origin) {
  let currentPayment = payment;
  const nowIso = new Date().toISOString();
  const paymentPlan = getPaymentPlanForPayment(currentPayment, options);

  if (!currentPayment) {
    return null;
  }

  if (!currentPayment.paidAt || currentPayment.status !== 'paid') {
    currentPayment =
      (await options.billingStore.updatePayment(currentPayment.id, {
        status: 'paid',
        paidAt: currentPayment.paidAt || nowIso,
      })) || currentPayment;
  }

  let subscription = await options.billingStore.getActiveSubscription(currentPayment.chatId);

  if (!currentPayment.grantedAt) {
    subscription = await options.billingStore.grantSubscription({
      chatId: currentPayment.chatId,
      telegramUserId: currentPayment.telegramUserId,
      paymentId: currentPayment.id,
      planId: currentPayment.planId,
      planName: currentPayment.planName || paymentPlan?.name,
      planDurationLabel: currentPayment.planDurationLabel || paymentPlan?.durationLabel,
      displayAmount: currentPayment.displayAmount || paymentPlan?.displayAmount,
      modelSlug: currentPayment.modelSlug,
      modelName: currentPayment.modelName,
      durationMs: Number(paymentPlan?.durationMs || 30_000),
      inviteLink: '',
      inviteLinkExpiresAt: '',
    });

    currentPayment =
      (await options.billingStore.updatePayment(currentPayment.id, {
        status: 'paid',
        paidAt: currentPayment.paidAt || nowIso,
        grantedAt: nowIso,
      })) || currentPayment;
  }

  subscription =
    subscription || (await options.billingStore.getActiveSubscription(currentPayment.chatId));

  if (!subscription) {
    return currentPayment;
  }

  let inviteLink = toText(currentPayment.inviteLink) || toText(subscription.inviteLink);

  if (!inviteLink) {
    if (options.paymentConfig.privateGroupChatId) {
      try {
        const invite = await createGroupInviteLink(
          token,
          currentPayment,
          subscription.expiresAt,
          options,
        );
        inviteLink = toText(invite.invite_link);
        const inviteLinkExpiresAt =
          typeof invite.expire_date === 'number'
            ? new Date(invite.expire_date * 1000).toISOString()
            : subscription.expiresAt;

        subscription =
          (await options.billingStore.updateSubscription(subscription.id, {
            inviteLink,
            inviteLinkCreatedAt: nowIso,
            inviteLinkExpiresAt,
          })) || subscription;
      } catch (error) {
        logBot('Pagamento aprovado, mas o convite privado falhou.', {
          paymentId: currentPayment.id,
          chatId: currentPayment.chatId,
          error: error instanceof Error ? error.message : String(error),
        });

      if (origin !== 'webhook-silent') {
        await sendPlainText(
          token,
          currentPayment.chatId,
          '✅ Pagamento confirmado, mas nao consegui gerar o link do grupo agora.\n\nToque em "Ja paguei, verificar" novamente em alguns segundos.',
        );
      }

        return currentPayment;
      }
    } else if (options.groupUrl) {
      inviteLink = options.groupUrl;
      subscription =
        (await options.billingStore.updateSubscription(subscription.id, {
          inviteLink,
          inviteLinkCreatedAt: nowIso,
          inviteLinkExpiresAt: subscription.expiresAt,
        })) || subscription;
    }
  }

  currentPayment =
    (await options.billingStore.updatePayment(currentPayment.id, {
      status: 'paid',
      paidAt: currentPayment.paidAt || nowIso,
      grantedAt: currentPayment.grantedAt || nowIso,
      deliveredAt: currentPayment.deliveredAt || nowIso,
      inviteLink,
    })) || currentPayment;

  await deletePaymentMessages(token, currentPayment, options);

  if (origin !== 'webhook-silent') {
    await sendText(
      token,
      currentPayment.chatId,
      `✅ *Pagamento aprovado*\n\n🔓 Seu acesso ao grupo privado foi liberado no plano *${toText(
        currentPayment.planName || paymentPlan?.name || currentPayment.planDurationLabel || paymentPlan?.durationLabel,
      )}*.\n💰 Valor do plano: *${formatCurrencyBRL(
        Number(currentPayment.displayAmount || paymentPlan?.displayAmount || 0),
      )}*.`,
      {
        reply_markup: buildAccessKeyboard(
          { ...subscription, inviteLink },
          options.siteUrl,
        ),
      },
    );
  }

  return currentPayment;
}

async function cancelPendingPayment(token, chatId, paymentId, options, callbackId = '') {
  const payment = await options.billingStore.getPayment(paymentId);

  if (!payment || payment.chatId !== String(chatId)) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Nao encontrei esse Pix.');
      return null;
    }

    return sendPlainText(token, chatId, 'Nao encontrei esse pagamento para o seu chat.');
  }

  const cancellation = await options.billingStore.updatePaymentIfStatus(
    payment.id,
    ['draft', 'pending', 'created', 'waiting_payment'],
    {
      status: 'cancelled',
      syncpayPayload: {
        ...(payment.syncpayPayload && typeof payment.syncpayPayload === 'object'
          ? payment.syncpayPayload
          : {}),
        cancelledAt: new Date().toISOString(),
        cancelledBy: 'user',
      },
    },
  );
  const nextPayment = cancellation.payment || payment;

  if (!cancellation.matched) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Esse Pix ja foi finalizado.');
      return null;
    }

    return null;
  }

  await deletePaymentMessages(token, nextPayment, options);

  if (callbackId) {
    await answerCallbackQuery(token, callbackId, 'Pix cancelado.');
  }

  return sendPlainText(
    token,
    chatId,
    '❌ Pix cancelado.\n\nQuando quiser, gere uma nova cobranca.',
    {
      reply_markup: await buildStartKeyboardForChat(chatId, options),
    },
  );
}

async function settlePaymentFromWebhookPayload(token, payment, payload, options, origin) {
  if (!payment) {
    return null;
  }

  const transactionId = toText(
    payload?.transactionId ??
      payload?.orderUUID ??
      payload?.payment?.charges?.[0]?.uuid ??
      payload?.idtransaction ??
      payload?.idTransaction ??
      payload?.id_transaction,
  );
  const paymentCode = toText(
    payload?.paymentCode ?? payload?.paymentcode ?? payload?.payment?.charges?.[0]?.pixPayload,
  );
  const paymentCodeBase64 = toText(
    payload?.paymentCodeBase64 ?? payload?.payment?.charges?.[0]?.pixQrCode,
  );
  const paymentLink = toText(payload?.paymentLink ?? payload?.data?.url);
  const dueAt = toText(
    payload?.dueAt ??
      payload?.dateDue ??
      payload?.date_due ??
      payload?.data_registro ??
      payload?.payment?.charges?.[0]?.expireAt,
  );
  const paymentStatus = toText(
    payload?.status ?? payload?.situacao ?? payload?.state ?? payload?.payment?.status,
  );

  let nextPayment =
    (await options.billingStore.updatePayment(payment.id, {
      status: mapPaymentStatusToLocal(paymentStatus),
      syncpayTransactionId: transactionId || payment.syncpayTransactionId,
      paymentCode: paymentCode || payment.paymentCode,
      paymentCodeBase64: paymentCodeBase64 || payment.paymentCodeBase64,
      paymentLink: paymentLink || payment.paymentLink,
      dueAt: dueAt || payment.dueAt,
      syncpayPayload: payload,
      paidAt:
        isSyncPayPaidStatus(paymentStatus) && !payment.paidAt
          ? new Date().toISOString()
          : payment.paidAt,
    })) || payment;

  if (isSyncPayPaidStatus(paymentStatus)) {
    nextPayment = (await finalizeApprovedPayment(token, nextPayment, options, origin)) || nextPayment;
  }

  return nextPayment;
}

async function resolvePaymentCustomerData(chatId, telegramUser, customer, options) {
  const configuredCustomer = options.paymentConfig.testCustomer || {};

  return {
    name:
      toText(configuredCustomer.name) ||
      [toText(customer.firstName), toText(customer.lastName)].filter(Boolean).join(' ') ||
      [toText(telegramUser?.first_name), toText(telegramUser?.last_name)].filter(Boolean).join(' ') ||
      toText(customer.fullName) ||
      'Cliente AllPrivacy',
    email:
      toText(configuredCustomer.email) ||
      toText(customer.email) ||
      `telegram+${String(chatId)}@allprivacy.site`,
  };
}

async function createOrReusePixPayment(
  token,
  chatId,
  telegramUser,
  model,
  planId,
  options,
  forceNew = false,
) {
  const selectedPlan = getPaymentPlan(options, planId);

  if (!options.paymentConfig.enabled || !selectedPlan) {
    return sendText(
      token,
      chatId,
      'Os pagamentos por Pix ainda nao estao configurados. Defina a API ou ative o modo de teste para liberar este fluxo.',
    );
  }

  const activeSubscription = await options.billingStore.getActiveSubscription(chatId);

  if (activeSubscription) {
    return sendActiveSubscriptionMessage(token, chatId, activeSubscription, options);
  }

  const customer = (await options.billingStore.getCustomer(chatId)) || {};
  const paymentCustomer = await resolvePaymentCustomerData(
    chatId,
    telegramUser,
    customer,
    options,
  );
  const targetModelSlug = model ? getModelRouteSlug(model) : 'home';
  const targetPlanId = normalizePlanId(selectedPlan.id) || normalizePlanId(options.paymentConfig.defaultPlanId) || '30d';

  if (!forceNew) {
    const pendingPayment = await options.billingStore.findPendingPayment(
      chatId,
      targetModelSlug,
      targetPlanId,
    );

    if (pendingPayment?.paymentCode) {
      await deletePaymentMessages(token, pendingPayment, options);
      return sendPixInstructions(token, chatId, pendingPayment, options);
    }
  }

  const stalePayments = await options.billingStore.listPendingPaymentsForChat(chatId, targetModelSlug);

  for (const stalePayment of stalePayments) {
    await options.billingStore.updatePayment(stalePayment.id, {
      status: 'replaced',
      syncpayPayload: {
        ...(stalePayment.syncpayPayload && typeof stalePayment.syncpayPayload === 'object'
          ? stalePayment.syncpayPayload
          : {}),
        replacedAt: new Date().toISOString(),
        replacedBy: forceNew ? 'repay' : 'new-plan',
      },
    });

    await deletePaymentMessages(token, stalePayment, options);
  }

  const payment = await options.billingStore.createPayment({
    chatId: String(chatId),
    telegramUserId: telegramUser?.id || customer.telegramUserId,
    planId: targetPlanId,
    planName: selectedPlan.name,
    planDurationLabel: selectedPlan.durationLabel,
    displayAmount: selectedPlan.displayAmount,
    modelSlug: targetModelSlug,
    modelName: model?.name || '',
    amount: selectedPlan.chargeAmount,
    status: 'draft',
  });

  if (options.paymentConfig.fakePixEnabled) {
    const createdPayment = buildFakePixPaymentResult(payment, options);
    const nextPayment =
      (await options.billingStore.updatePayment(payment.id, {
        status: createdPayment.status,
        syncpayTransactionId: createdPayment.transactionId,
        paymentCode: createdPayment.paymentCode,
        paymentCodeBase64: createdPayment.paymentCodeBase64,
        paymentLink: createdPayment.paymentLink,
        dueAt: createdPayment.dueAt,
        pixExpiresAt: createdPayment.pixExpiresAt,
        syncpayPayload: createdPayment.raw,
      })) || payment;

    logBot('Pix falso gerado para testes.', {
      chatId,
      paymentId: nextPayment.id,
      transactionId: nextPayment.syncpayTransactionId,
      model: nextPayment.modelName || 'home',
      plan: targetPlanId,
    });

    await options.billingStore.clearConversation(chatId);
    return sendPixInstructions(token, chatId, nextPayment, options);
  }

  try {
    const createdPayment = await options.paymentClient.createPixPayment({
      amount: selectedPlan.chargeAmount,
      customer: {
        name: paymentCustomer.name,
        email: paymentCustomer.email,
      },
      externalReference: payment.externalReference,
      postbackUrl: options.paymentConfig.webhookUrl,
      itemTitle: `Acesso AllPrivacy - ${model?.name || 'Grupo VIP'}`,
      itemDescription: `${selectedPlan.name} - ${selectedPlan.durationLabel}`,
    });

    const nextPayment =
      (await options.billingStore.updatePayment(payment.id, {
        status: mapPaymentStatusToLocal(createdPayment.status),
        syncpayTransactionId: createdPayment.transactionId,
        paymentCode: createdPayment.paymentCode,
        paymentCodeBase64: createdPayment.paymentCodeBase64,
        paymentLink: createdPayment.paymentLink,
        dueAt: createdPayment.dueAt,
        pixExpiresAt: getPaymentWindowExpiryIso(createdPayment, options.paymentConfig.pixTtlMs),
        syncpayPayload: createdPayment.raw,
      })) || payment;

    logBot('Pix Syncpay criado.', {
      chatId,
      paymentId: nextPayment.id,
      transactionId: nextPayment.syncpayTransactionId,
      model: nextPayment.modelName || 'home',
      plan: targetPlanId,
    });

    await options.billingStore.clearConversation(chatId);
    return sendPixInstructions(token, chatId, nextPayment, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha desconhecida ao gerar Pix.';

    await options.billingStore.updatePayment(payment.id, {
      status: 'failed',
      syncpayPayload: {
        error: message,
      },
    });

    logBot('Falha ao criar Pix Syncpay.', {
      chatId,
      paymentId: payment.id,
      error: message,
    });

    return sendPlainText(
      token,
      chatId,
      `Nao consegui gerar o Pix agora.\n\n${message}`,
    );
  }
}

async function verifyPendingPayment(token, chatId, paymentId, options, callbackId = '') {
  const payment = await options.billingStore.getPayment(paymentId);

  if (!payment || payment.chatId !== String(chatId)) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Nao encontrei esse pagamento.');
      return null;
    }
    return sendPlainText(token, chatId, 'Nao encontrei esse pagamento para o seu chat.');
  }

  if (isFakePixPayment(payment)) {
    if (callbackId) {
      await answerCallbackQuery(
        token,
        callbackId,
        options.paymentConfig.simulationEnabled
          ? 'Pix de teste pendente. Use Simular pagamento.'
          : 'Pix de teste pendente.',
      );
      return null;
    }

    return sendPlainText(
      token,
      chatId,
      options.paymentConfig.simulationEnabled
        ? 'Esse e um Pix de teste. Use o botao de simular pagamento para concluir o fluxo.'
        : 'Esse e um Pix de teste pendente.',
    );
  }

  if (!payment.syncpayTransactionId) {
    const normalizedPlanId =
      normalizePlanId(payment.planId) ||
      normalizePlanId(options.paymentConfig.defaultPlanId) ||
      '30d';
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Esse Pix nao tem transacao valida.');
      return null;
    }
    return sendPlainText(
      token,
      chatId,
      'Esse Pix ainda nao tem um id de transacao valido na Syncpay. Gere um novo Pix.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Gerar novo Pix',
                callback_data: `repay:${normalizedPlanId}:${payment.modelSlug || 'home'}`,
              },
            ],
          ],
        },
      },
    );
  }

  try {
    const statusPayload = await options.paymentClient.getTransactionStatus(
      payment.syncpayTransactionId,
    );
    const nextPayment = await settlePaymentFromWebhookPayload(
      token,
      payment,
      statusPayload,
      options,
      'manual-check',
    );

    if (nextPayment?.status === 'paid' || nextPayment?.deliveredAt) {
      if (callbackId) {
        await answerCallbackQuery(token, callbackId, 'Pagamento confirmado.');
      }
      return null;
    }

    const currentStatus =
      toText(statusPayload.status) || toText(statusPayload.raw?.situacao) || 'aguardando';
    const expiryText = nextPayment?.pixExpiresAt
      ? formatDateTimeBR(nextPayment.pixExpiresAt)
      : nextPayment?.dueAt
        ? formatDateTimeBR(nextPayment.dueAt)
        : '';

    if (callbackId) {
      await answerCallbackQuery(
        token,
        callbackId,
        expiryText
          ? `Ainda aguardando pagamento. Valido ate ${expiryText}.`
          : `Ainda aguardando pagamento. Status: ${currentStatus}.`,
      );
      return null;
    }

    return sendPlainText(token, chatId, `Ainda nao apareceu confirmacao de pagamento na Syncpay.\n\nStatus atual: ${currentStatus}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar a Syncpay.';

    logBot('Falha na verificacao manual do Pix.', {
      chatId,
      paymentId,
      error: message,
    });

    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Nao consegui consultar agora.', {
        show_alert: true,
      });
      return null;
    }

    return sendPlainText(token, chatId, `Nao consegui consultar a Syncpay agora.\n\n${message}`);
  }
}

async function simulatePaymentApproval(token, chatId, paymentId, options, callbackId = '') {
  if (!options.paymentConfig.simulationEnabled) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Simulacao desativada.', {
        show_alert: true,
      });
      return null;
    }

    return null;
  }

  const payment = await options.billingStore.getPayment(paymentId);

  if (!payment || payment.chatId !== String(chatId)) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Nao encontrei esse Pix.');
      return null;
    }

    return sendPlainText(token, chatId, 'Nao encontrei esse pagamento para o seu chat.');
  }

  const simulationLock = await options.billingStore.updatePaymentIfStatus(
    payment.id,
    ['draft', 'pending', 'created', 'waiting_payment'],
    {
      status: 'processing-test',
      syncpayPayload: {
        ...(payment.syncpayPayload && typeof payment.syncpayPayload === 'object'
          ? payment.syncpayPayload
          : {}),
        simulatedAt: new Date().toISOString(),
        simulatedBy: 'bot-test-mode',
      },
    },
  );
  const nextPayment = simulationLock.payment || payment;

  if (!simulationLock.matched) {
    if (callbackId) {
      await answerCallbackQuery(token, callbackId, 'Esse Pix ja foi finalizado.');
      return null;
    }

    return null;
  }

  if (callbackId) {
    await answerCallbackQuery(token, callbackId, 'Aprovando teste...');
  }

  return settlePaymentFromWebhookPayload(
    token,
    nextPayment,
    {
      transactionId: nextPayment.syncpayTransactionId || `sim-${nextPayment.id}`,
      paymentCode: nextPayment.paymentCode,
      paymentCodeBase64: nextPayment.paymentCodeBase64,
      paymentLink: nextPayment.paymentLink,
      dueAt: nextPayment.dueAt,
      status: 'PAID',
      paidAt: new Date().toISOString(),
      simulated: true,
    },
    options,
    'simulation',
  );
}

async function handleConversationReply(token, message, conversation, readSiteContent, options) {
  const chatId = message.chat?.id;
  const text = toText(message.text);

  if (!chatId || !text) {
    return;
  }

  const siteContent = await readSiteContent();
  const model =
    conversation?.modelSlug && conversation.modelSlug !== 'home'
      ? findModelByInput(siteContent.models, conversation.modelSlug)
      : null;

  if (conversation.step === paymentConversationStepEmail) {
    if (!isValidEmail(text)) {
      return sendPlainText(
        token,
        chatId,
        'Esse email parece invalido. Me envie novamente no formato nome@dominio.com.',
      );
    }

    await options.billingStore.upsertCustomer(chatId, { email: text });
    await options.billingStore.setConversation(chatId, {
      step: paymentConversationStepCpf,
      modelSlug: conversation.modelSlug,
      modelName: conversation.modelName,
    });

    return sendPlainText(
      token,
      chatId,
      'Perfeito. Agora me envie seu CPF com 11 numeros para eu gerar o Pix.',
    );
  }

  if (conversation.step === paymentConversationStepCpf) {
    if (!isValidCpf(text)) {
      return sendPlainText(
        token,
        chatId,
        'O CPF nao passou na validacao. Envie novamente com 11 numeros validos.',
      );
    }

    await options.billingStore.upsertCustomer(chatId, { cpf: normalizeCpfDigits(text) });
    await options.billingStore.clearConversation(chatId);
    return createOrReusePixPayment(
      token,
      chatId,
      message.from,
      model,
      options.paymentConfig.defaultPlanId,
      options,
    );
  }

  return null;
}

async function processPaymentWebhookPayload(token, payload, options) {
  const externalReference = toText(
    payload?.externalreference ??
      payload?.externalReference ??
      payload?.metadata?.external_reference ??
      payload?.data?.src,
  );
  const transactionId = toText(
    payload?.idtransaction ??
      payload?.idTransaction ??
      payload?.transactionId ??
      payload?.orderUUID ??
      payload?.payment?.charges?.[0]?.uuid,
  );
  const payment =
    (externalReference && (await options.billingStore.findPaymentByExternalReference(externalReference))) ||
    (transactionId && (await options.billingStore.findPaymentByTransactionId(transactionId)));

  if (!payment) {
    logBot('Webhook de pagamento recebido sem pagamento local correspondente.', {
      externalReference,
      transactionId,
      status: toText(payload?.status),
    });

    return {
      ok: false,
      paymentId: '',
      reason: 'payment-not-found',
    };
  }

  const nextPayment = await settlePaymentFromWebhookPayload(
    token,
    payment,
    {
      ...payload,
      transactionId,
    },
    options,
    'webhook',
  );

  return {
    ok: true,
    paymentId: payment.id,
    paid: nextPayment?.status === 'paid' || Boolean(nextPayment?.deliveredAt),
  };
}

async function autoVerifyPendingPayments(token, options) {
  if (!options.paymentConfig.enabled) {
    return;
  }

  const pendingPayments = await options.billingStore.listPendingPayments();

  for (const payment of pendingPayments) {
    if (isFakePixPayment(payment)) {
      continue;
    }

    try {
      const statusPayload = await options.paymentClient.getTransactionStatus(
        payment.syncpayTransactionId,
      );

      await settlePaymentFromWebhookPayload(
        token,
        payment,
        statusPayload,
        options,
        'auto-check',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (
        !message.includes('orderUUID ausente') &&
        !message.includes('idTransaction ausente')
      ) {
        logBot('Falha na verificacao automatica do Pix.', {
          paymentId: payment.id,
          chatId: payment.chatId,
          error: message,
        });
      }
    }
  }
}

async function sendPendingPaymentReminders(token, options) {
  if (!options.paymentConfig.enabled || options.paymentConfig.pixReminderMs <= 0) {
    return;
  }

  const pendingPayments = await options.billingStore.listPendingPayments();
  const now = Date.now();

  for (const payment of pendingPayments) {
    const reminderSentAt = toText(payment?.syncpayPayload?.paymentReminderSentAt);

    if (reminderSentAt) {
      continue;
    }

    const createdTimestamp = Date.parse(toText(payment.createdAt));
    const expiresTimestamp = Date.parse(toText(payment.pixExpiresAt));

    if (!Number.isFinite(createdTimestamp)) {
      continue;
    }

    if (Number.isFinite(expiresTimestamp) && expiresTimestamp <= now) {
      continue;
    }

    if (createdTimestamp + Number(options.paymentConfig.pixReminderMs || 0) > now) {
      continue;
    }

    try {
      const reminderMessage = await sendHtmlText(
        token,
        payment.chatId,
        buildPendingPaymentReminderText(payment, options),
      );

      let nextPayment =
        (await options.billingStore.updatePayment(payment.id, {
          syncpayPayload: {
            ...(payment.syncpayPayload && typeof payment.syncpayPayload === 'object'
              ? payment.syncpayPayload
              : {}),
            paymentReminderSentAt: new Date().toISOString(),
          },
        })) || payment;

      if (Number.isInteger(reminderMessage?.message_id)) {
        nextPayment =
          (await appendPaymentMessageIds(
            options.billingStore,
            nextPayment,
            [reminderMessage.message_id],
          )) || nextPayment;
      }
    } catch (error) {
      logBot('Falha ao enviar lembrete automatico do Pix.', {
        paymentId: payment.id,
        chatId: payment.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function expirePendingPixPayments(token, options) {
  if (!options.paymentConfig.enabled) {
    return;
  }

  const pendingPayments = await options.billingStore.listPendingPayments();
  const now = Date.now();

  for (const payment of pendingPayments) {
    const expiresTimestamp = Date.parse(toText(payment.pixExpiresAt));

    if (!Number.isFinite(expiresTimestamp) || expiresTimestamp > now) {
      continue;
    }

    try {
      if (payment.syncpayTransactionId && !isFakePixPayment(payment)) {
        const statusPayload = await options.paymentClient.getTransactionStatus(
          payment.syncpayTransactionId,
        );
        const refreshedPayment = await settlePaymentFromWebhookPayload(
          token,
          payment,
          statusPayload,
          options,
          'auto-check',
        );

        if (refreshedPayment?.status === 'paid' || refreshedPayment?.deliveredAt) {
          continue;
        }
      }
    } catch (error) {
      logBot('Falha ao validar Pix antes de expirar localmente.', {
        paymentId: payment.id,
        chatId: payment.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const expiredPayment =
      (await options.billingStore.updatePayment(payment.id, {
        status: 'expired',
        syncpayPayload: {
          ...(payment.syncpayPayload && typeof payment.syncpayPayload === 'object'
            ? payment.syncpayPayload
            : {}),
          localExpiredAt: new Date().toISOString(),
          localExpiredBy: 'payment-window',
        },
      })) || payment;

    await deletePaymentMessages(token, expiredPayment, options);
    await sendPlainText(
      token,
      expiredPayment.chatId,
      '⏳ Tempo de pagamento expirado.',
      {
        reply_markup: await buildStartKeyboardForChat(expiredPayment.chatId, options),
      },
    );
  }
}

async function expireSubscriptions(token, options) {
  if (!options.paymentConfig.privateGroupChatId) {
    return;
  }

  const expiredSubscriptions = await options.billingStore.listExpiredSubscriptions();

  for (const subscription of expiredSubscriptions) {
    try {
      await telegramRequest(token, 'banChatMember', {
        chat_id: options.paymentConfig.privateGroupChatId,
        user_id: subscription.telegramUserId,
        until_date: Math.floor(Date.now() / 1000) + 60,
        revoke_messages: false,
      });
    } catch (error) {
      logBot('Falha ao banir usuario expirado do grupo.', {
        subscriptionId: subscription.id,
        chatId: subscription.chatId,
        userId: subscription.telegramUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await telegramRequest(token, 'unbanChatMember', {
        chat_id: options.paymentConfig.privateGroupChatId,
        user_id: subscription.telegramUserId,
        only_if_banned: true,
      });
    } catch (error) {
      logBot('Falha ao limpar ban do usuario expirado.', {
        subscriptionId: subscription.id,
        chatId: subscription.chatId,
        userId: subscription.telegramUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await options.billingStore.updateSubscription(subscription.id, {
      status: 'expired',
      removedAt: new Date().toISOString(),
      removedReason: 'expired',
    });

    await sendPlainText(
      token,
      subscription.chatId,
      `⌛ Seu acesso ${subscription.planName ? `do ${subscription.planName}` : subscription.planDurationLabel ? `de ${subscription.planDurationLabel}` : 'ao grupo privado'} terminou.\n\nQuando quiser renovar, gere um novo Pix aqui no bot.`,
      {
        reply_markup: await buildStartKeyboardForChat(subscription.chatId, options),
      },
    );
  }
}

async function sendModelList(token, chatId, siteContent, siteUrl) {
  if (!siteContent.models.length) {
    return sendText(
      token,
      chatId,
      'Nenhuma modelo cadastrada ainda. Assim que voce adicionar pelo painel, elas aparecem aqui.',
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Abrir site', url: buildHomeUrl(siteUrl) }]],
        },
      },
    );
  }

  return sendText(token, chatId, 'Escolha uma modelo para abrir a pagina individual:', {
    reply_markup: {
      inline_keyboard: splitModelsIntoRows(siteContent.models, siteUrl),
    },
  });
}

async function sendModelDetails(token, chatId, model, options) {
  const caption = buildModelCaption(model);
  const replyMarkup = buildModelKeyboard(model, options);
  const customer = (await options.billingStore.getCustomer(chatId)) || {};
  const mediaPreview = getRandomModelMediaSelection(model, getPreviewRecentKeys(customer));
  const selectedSummary = mediaPreview.map((item) => item.type).join(', ');

  logBot('Enviando previas da modelo.', {
    chatId,
    model: model.name,
    totalMidias: mediaPreview.length,
    selecao: selectedSummary,
  });

  if (mediaPreview.length > 0) {
    await sendPreviewMediaSelection(token, chatId, mediaPreview, options);
    await rememberPreviewMediaItems(chatId, mediaPreview, options);
  } else if (model.coverImage) {
    const coverSource = await resolveTelegramMediaSource(
      model.coverImage,
      options.siteUrl,
      options.resolveLocalAssetPath,
      options.telegramFileCache,
    );

    await sendPhoto(
      token,
      chatId,
      coverSource,
      '',
      {},
      options.telegramFileCache,
      {
        siteUrl: options.siteUrl,
        resolveLocalAssetPath: options.resolveLocalAssetPath,
        telegramFileCache: options.telegramFileCache,
        allowRetry: true,
      },
    );
  }

  return sendText(
    token,
    chatId,
    `${caption}\n\nSeparei *3 previas aleatorias* dessa modelo.\n\n${buildPaymentPlansIntro(
      options,
      '💎 Planos disponiveis:',
    )}\n\nEscolha uma opcao abaixo para gerar o Pix.`,
    { reply_markup: replyMarkup },
  );
}

async function sendSitewidePreviews(token, chatId, siteContent, options) {
  const customer = (await options.billingStore.getCustomer(chatId)) || {};
  const mediaPreview = getRandomSitewideMediaSelection(siteContent, getPreviewRecentKeys(customer));

  logBot('Enviando previas globais.', {
    chatId,
    totalMidias: mediaPreview.length,
    selecao: mediaPreview.map((item) => `${item.type}:${item.modelName || item.modelSlug || 'site'}`).join(', '),
  });

  if (mediaPreview.length === 0) {
    return sendPlainText(token, chatId, '🌐 Acesse o site para ver mais previas.', {
      reply_markup: await buildStartKeyboardForChat(chatId, options),
    });
  }

  await sendPreviewMediaSelection(token, chatId, mediaPreview, options);
  await rememberPreviewMediaItems(chatId, mediaPreview, options);

  return null;
}

async function handleMessage(token, message, readSiteContent, options) {
  const chatId = message.chat?.id;
  const text = toText(message.text);

  if (!chatId) {
    return;
  }

  await syncTelegramCustomer(options.billingStore, chatId, message.from);
  const conversation = await options.billingStore.getConversation(chatId);

  if (conversation && text && !text.startsWith('/')) {
    logBot('Resposta de conversa recebida.', {
      chatId,
      step: conversation.step,
    });
    return handleConversationReply(token, message, conversation, readSiteContent, options);
  }

  if (!text || !text.startsWith('/')) {
    return;
  }

  const siteContent = await readSiteContent();
  const [command, ...args] = text.split(/\s+/);
  const normalizedCommand = command.toLowerCase();
  const startPayload = args.join(' ');

  logBot('Mensagem recebida.', {
    chatId,
    command: normalizedCommand,
    payload: startPayload,
  });

  if (normalizedCommand === '/start') {
    const { planId: requestedPlanId, target: requestedTarget } = parseStartPayload(
      startPayload.replace(/^ref[:-]/i, ''),
    );
    const referencedModel =
      requestedTarget && requestedTarget !== 'home'
        ? findModelByInput(siteContent.models, requestedTarget)
        : null;

    if (requestedPlanId) {
      logBot('Referencia identificada no /start.', {
        chatId,
        payload: startPayload,
        model: referencedModel?.name || 'home',
        planId: requestedPlanId,
      });
      return createOrReusePixPayment(
        token,
        chatId,
        message.from,
        referencedModel,
        requestedPlanId,
        options,
      );
    }

    if (referencedModel) {
      logBot('Referencia identificada no /start.', {
        chatId,
        payload: startPayload,
        model: referencedModel.name,
      });
      return sendModelDetails(token, chatId, referencedModel, options);
    }

    const activeSubscription = await options.billingStore.getActiveSubscription(chatId);

    if (activeSubscription) {
      return sendActiveSubscriptionMessage(token, chatId, activeSubscription, options);
    }

    return sendText(
      token,
      chatId,
      `*AllPrivacy*\n\n👀 Veja previas no bot.\n${buildPaymentPlansIntro(options)}`,
      {
        reply_markup: await buildStartKeyboardForChat(chatId, options),
      },
    );
  }

  if (normalizedCommand === '/modelos') {
    return sendModelList(token, chatId, siteContent, options.siteUrl);
  }

  if (normalizedCommand === '/modelo') {
    const query = args.join(' ');

    if (!query) {
      return sendText(
        token,
        chatId,
        'Use `/modelo nome` ou `/modelo mel` para abrir uma modelo especifica.',
      );
    }

    const model = findModelByInput(siteContent.models, query);

    if (!model) {
      logBot('Modelo nao encontrada para comando /modelo.', {
        chatId,
        query,
      });
      return sendText(
        token,
        chatId,
        'Nao encontrei essa modelo. Use `/modelos` para ver a lista atual.',
      );
    }

    logBot('Modelo encontrada para comando /modelo.', {
      chatId,
      query,
      model: model.name,
    });
    return sendModelDetails(token, chatId, model, options);
  }

  if (normalizedCommand === '/pagar') {
    const possiblePlanId = normalizePlanId(args[0] || '');
    const selectedPlanId = ['7d', '30d'].includes(possiblePlanId) ? possiblePlanId : '';
    const query = selectedPlanId ? args.slice(1).join(' ') : args.join(' ');
    const model = query ? findModelByInput(siteContent.models, query) : null;
    return createOrReusePixPayment(
      token,
      chatId,
      message.from,
      model,
      selectedPlanId,
      options,
    );
  }

  if (normalizedCommand === '/assinatura') {
    const activeSubscription = await options.billingStore.getActiveSubscription(chatId);
    return sendActiveSubscriptionMessage(token, chatId, activeSubscription, options);
  }

  if (normalizedCommand === '/site') {
    return sendText(
      token,
      chatId,
      '🌐 *AllPrivacy*\n\nAcesse o site oficial para ver mais previas e conhecer as modelos.',
      {
        reply_markup: buildSiteKeyboard(options.siteUrl),
      },
    );
  }

  if (normalizedCommand === '/suporte') {
    const activeSubscription = await options.billingStore.getActiveSubscription(chatId);
    const supportText = activeSubscription
      ? '🆘 *Suporte*\n\nSe tiver problema para entrar no grupo, toque em *Meu acesso* ou use /assinatura para consultar sua validade atual.'
      : '🆘 *Suporte*\n\nSe o pagamento ainda nao apareceu, toque em *Ja paguei, verificar* no Pix gerado.\n\nSe precisar de mais previas ou informacoes, use /site.';

    return sendText(
      token,
      chatId,
      supportText,
      {
        reply_markup: await buildStartKeyboardForChat(chatId, options),
      },
    );
  }

  if (normalizedCommand === '/grupo') {
    const activeSubscription = await options.billingStore.getActiveSubscription(chatId);

    if (activeSubscription) {
      return sendActiveSubscriptionMessage(token, chatId, activeSubscription, options);
    }

    return sendText(
      token,
      chatId,
      `🔐 A entrada no grupo privado e liberada apos o Pix.\n\n${buildPaymentPlansIntro(
        options,
      )}`,
      {
        reply_markup: await buildStartKeyboardForChat(chatId, options),
      },
    );
  }

  return sendText(
    token,
    chatId,
    '📌 Comandos disponiveis:\n/start\n/suporte\n/assinatura\n/site',
  );
}

async function handleCallbackQuery(token, callbackQuery, readSiteContent, options) {
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const sourceMessageId = callbackQuery.message?.message_id;
  const data = toText(callbackQuery.data);

  if (!callbackId || !chatId) {
    return;
  }

  await syncTelegramCustomer(options.billingStore, chatId, callbackQuery.from);
  const siteContent = await readSiteContent();

  logBot('Callback recebido.', {
    chatId,
    data,
  });

  if (data === 'list-models') {
    await answerCallbackQuery(token, callbackId);
    return sendModelList(token, chatId, siteContent, options.siteUrl);
  }

  if (data === 'my-access') {
    await answerCallbackQuery(token, callbackId);
    const activeSubscription = await options.billingStore.getActiveSubscription(chatId);
    return sendActiveSubscriptionMessage(token, chatId, activeSubscription, options);
  }

  if (data === 'show-previews') {
    const previewResult = await consumePreviewUsage(chatId, options);

    if (Number.isInteger(sourceMessageId)) {
      try {
        await deleteMessage(token, chatId, sourceMessageId);
      } catch (error) {
        logBot('Falha ao apagar menu antigo das previas.', {
          chatId,
          sourceMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!previewResult.allowed) {
      await answerCallbackQuery(token, callbackId, 'Acesse o site para mais previas.');
      return null;
    }

    await answerCallbackQuery(token, callbackId);
    await sendSitewidePreviews(token, chatId, siteContent, options);

    const previewUpsellText =
      '\u{1F513} <b>Tenha acesso completo e imediato entrando em nosso grupo VIP.</b>\n\n<i>\u{1F48E} Privacy, OnlyFans, XvideosRED, CloseFriends, TelegramVIP\n\u{1F48E} Cornos/Hotwife\n\u{1F48E} AmadorVIP\n\u{1F48E} Sexo em P\u00FAblico\n\u{1F48E} Famosinhas Vazadas\n\u{1F48E} C\u00E2meras Escondidas\n\u{1F48E} Atualiza\u00E7\u00F5es Di\u00E1rias\n\u{1F48E} Todo conte\u00FAdo separado por t\u00F3picos</i>\n\n\u{1F680} Escolha seu plano abaixo e tenha acesso imediato a <b>TUDO EM UM S\u00D3 LUGAR!</b>';

    if (!previewResult.usage.canUse) {
      await sendText(token, chatId, previewUpsellText);
      return sendPlainText(token, chatId, '\u{1F310} Acesse o site para mais pr\u00E9vias.', {
        reply_markup: await buildStartKeyboardForChat(chatId, options, 'Ver mais previas'),
      });
    }

    await sendText(token, chatId, previewUpsellText, {
      reply_markup: await buildStartKeyboardForChat(chatId, options, 'Ver mais previas'),
    });

    return null;
  }

  if (data.startsWith('model:')) {
    const model = findModelByInput(siteContent.models, data.replace(/^model:/, ''));

    if (!model) {
      logBot('Modelo nao encontrada para callback.', {
        chatId,
        data,
      });
      await answerCallbackQuery(token, callbackId, 'Modelo nao encontrada.');
      return;
    }

    logBot('Modelo encontrada para callback.', {
      chatId,
      data,
      model: model.name,
    });
    await answerCallbackQuery(token, callbackId);
    return sendModelDetails(token, chatId, model, options);
  }

  if (data.startsWith('pay:')) {
    const { planId, modelSlug } = parsePaymentActionPayload(data, 'pay');
    const model =
      modelSlug && modelSlug !== 'home' ? findModelByInput(siteContent.models, modelSlug) : null;
    await answerCallbackQuery(token, callbackId, 'Gerando Pix...');
    return createOrReusePixPayment(
      token,
      chatId,
      callbackQuery.from,
      model,
      planId,
      options,
    );
  }

  if (data.startsWith('repay:')) {
    const { planId, modelSlug } = parsePaymentActionPayload(data, 'repay');
    const model =
      modelSlug && modelSlug !== 'home' ? findModelByInput(siteContent.models, modelSlug) : null;
    await answerCallbackQuery(token, callbackId, 'Gerando novo Pix...');
    return createOrReusePixPayment(
      token,
      chatId,
      callbackQuery.from,
      model,
      planId,
      options,
      true,
    );
  }

  if (data.startsWith('verify:')) {
    const paymentId = data.replace(/^verify:/, '');
    return verifyPendingPayment(token, chatId, paymentId, options, callbackId);
  }

  if (data.startsWith('copy-pix:')) {
    const paymentId = data.replace(/^copy-pix:/, '');
    return sendPaymentCopyCode(token, chatId, paymentId, options, callbackId);
  }

  if (data.startsWith('show-qr:')) {
    const paymentId = data.replace(/^show-qr:/, '');
    return sendPaymentQrCode(token, chatId, paymentId, options, callbackId);
  }

  if (data.startsWith('simulate-pay:')) {
    const paymentId = data.replace(/^simulate-pay:/, '');
    return simulatePaymentApproval(token, chatId, paymentId, options, callbackId);
  }

  if (data.startsWith('cancel:')) {
    const paymentId = data.replace(/^cancel:/, '');
    return cancelPendingPayment(token, chatId, paymentId, options, callbackId);
  }

  await answerCallbackQuery(token, callbackId);
}

export function startTelegramBot({
  token,
  readSiteContent,
  siteUrl,
  groupUrl,
  cacheChatId,
  resolveLocalAssetPath,
  cacheFilePath,
  billingStore,
  paymentClient,
  paymentConfig,
}) {
  const normalizedToken = toText(token);

  if (!normalizedToken) {
    return {
      enabled: false,
      async checkMediaAssetCache() {
        return {
          ok: false,
          reason: 'bot-disabled',
        };
      },
      async warmMediaAsset() {
        return {
          ok: false,
          reason: 'bot-disabled',
        };
      },
      async handlePaymentWebhook() {
        return {
          ok: false,
          reason: 'bot-disabled',
        };
      },
      stop() {},
    };
  }

  let offset = 0;
  let isStopped = false;
  let pollingTimeout = null;
  let expirationInterval = null;
  let paymentVerificationInterval = null;
  let consecutivePollFailures = 0;
  const updateProcessingQueues = new Map();
  const telegramFileCache = createTelegramFileCache(cacheFilePath);

  const options = {
    siteUrl: buildHomeUrl(siteUrl),
    groupUrl: buildGroupUrl(groupUrl, siteUrl),
    cacheChatId: toText(cacheChatId),
    resolveLocalAssetPath,
    telegramFileCache,
    billingStore,
    paymentClient,
    paymentConfig: {
      enabled:
        (Boolean(paymentConfig?.fakePixEnabled) || Boolean(paymentClient?.enabled)) &&
        Array.isArray(paymentConfig?.plans) &&
        paymentConfig.plans.some((plan) => Number(plan?.chargeAmount || 0) > 0),
      plans: Array.isArray(paymentConfig?.plans)
        ? paymentConfig.plans
            .map((plan) => ({
              id: normalizePlanId(plan?.id),
              name: toText(plan?.name),
              durationLabel: toText(plan?.durationLabel),
              displayAmount: Number(plan?.displayAmount || 0),
              chargeAmount: Number(plan?.chargeAmount || 0),
              durationMs: Number(plan?.durationMs || 0),
            }))
            .filter((plan) => plan.id && plan.chargeAmount > 0)
        : [],
      defaultPlanId: normalizePlanId(paymentConfig?.defaultPlanId),
      simulationEnabled: Boolean(paymentConfig?.simulationEnabled),
      fakePixEnabled: Boolean(paymentConfig?.fakePixEnabled),
      previewUsageWindowMs: Math.max(1000, Number(paymentConfig?.previewUsageWindowMs || 24 * 60 * 60 * 1000)),
      pixTtlMs: Math.max(60000, Number(paymentConfig?.pixTtlMs || 8 * 60 * 1000)),
      pixReminderMs: Math.max(0, Number(paymentConfig?.pixReminderMs || 4 * 60 * 1000)),
      durationMs: Math.max(
        30 * 1000,
        ...(Array.isArray(paymentConfig?.plans) && paymentConfig.plans.length > 0
          ? paymentConfig.plans.map((plan) => Number(plan?.durationMs || 0))
          : [30 * 24 * 60 * 60 * 1000]),
      ),
      privateGroupChatId: toText(paymentConfig?.privateGroupChatId),
      webhookUrl: toText(paymentConfig?.webhookUrl),
      testCustomer:
        paymentConfig?.testCustomer && typeof paymentConfig.testCustomer === 'object'
          ? paymentConfig.testCustomer
          : {},
    },
  };

  logBot('Bot inicializado.', {
    siteUrl: options.siteUrl,
    groupUrl: options.groupUrl,
    cacheAtivo: Boolean(cacheFilePath),
    pagamentosAtivos: options.paymentConfig.enabled,
  });

  configureTelegramCommands(normalizedToken)
    .then(() => {
      logBot('Menu de comandos do Telegram configurado.');
    })
    .catch((error) => {
      console.error('Falha ao configurar menu de comandos do Telegram:', error);
    });

  async function processUpdate(update) {
    if (update.message) {
      await handleMessage(normalizedToken, update.message, readSiteContent, options);
    }

    if (update.callback_query) {
      await handleCallbackQuery(normalizedToken, update.callback_query, readSiteContent, options);
    }

    if (update.chat_join_request) {
      await handleChatJoinRequest(normalizedToken, update.chat_join_request, options);
    }
  }

  function getUpdateProcessingKey(update) {
    const messageChatId = toText(update?.message?.chat?.id);

    if (messageChatId) {
      return `message:${messageChatId}`;
    }

    const callbackChatId = toText(update?.callback_query?.message?.chat?.id);

    if (callbackChatId) {
      return `callback:${callbackChatId}`;
    }

    const joinRequestChatId = toText(update?.chat_join_request?.chat?.id);
    const joinRequestUserId = toText(update?.chat_join_request?.from?.id);

    if (joinRequestChatId || joinRequestUserId) {
      return `join:${joinRequestChatId || 'unknown'}:${joinRequestUserId || 'unknown'}`;
    }

    return `update:${toText(update?.update_id) || Date.now()}`;
  }

  function enqueueUpdateProcessing(update) {
    const queueKey = getUpdateProcessingKey(update);
    const previousTask = updateProcessingQueues.get(queueKey) || Promise.resolve();

    const nextTask = previousTask
      .catch(() => undefined)
      .then(async () => {
        if (isStopped) {
          return;
        }

        await processUpdate(update);
      })
      .catch((error) => {
        console.error('Falha ao processar update do Telegram:', {
          updateId: update?.update_id,
          queueKey,
          erro: error instanceof Error ? error.message : String(error),
        });
      });

    updateProcessingQueues.set(queueKey, nextTask);
    nextTask.finally(() => {
      if (updateProcessingQueues.get(queueKey) === nextTask) {
        updateProcessingQueues.delete(queueKey);
      }
    });
  }

  async function poll() {
    if (isStopped) {
      return;
    }

    let updateCount = 0;

    try {
      const updates = await telegramRequest(normalizedToken, 'getUpdates', {
        timeout: 25,
        offset,
        allowed_updates: ['message', 'callback_query', 'chat_join_request'],
      });

      if (consecutivePollFailures > 0) {
        logBot('Conexao com Telegram restabelecida.', {
          falhasAntesDaRecuperacao: consecutivePollFailures,
        });
      }

      consecutivePollFailures = 0;

      updateCount = updates.length;

      for (const update of updates) {
        offset = update.update_id + 1;
        enqueueUpdateProcessing(update);
      }
    } catch (error) {
      consecutivePollFailures += 1;
      const connectivityHint = getTelegramConnectivityHint(error, telegramApiBase);

      if (consecutivePollFailures === 1 || consecutivePollFailures % 10 === 0) {
        console.error('Bot Telegram falhou ao consultar updates:', {
          tentativa: consecutivePollFailures,
          erro: error instanceof Error ? error.message : String(error),
          codigo: getNetworkErrorCode(error),
          dica: connectivityHint || undefined,
        });
      }
    } finally {
      if (!isStopped) {
        const failureDelay =
          consecutivePollFailures > 0
            ? Math.min(10000, 500 * 2 ** Math.min(consecutivePollFailures - 1, 4))
            : 150;
        pollingTimeout = setTimeout(poll, updateCount > 0 ? 50 : failureDelay);
      }
    }
  }

  poll();
  const expirationCheckIntervalMs = Math.max(
    5000,
    Math.min(60000, Math.floor((options.paymentConfig.durationMs || 30000) / 3)),
  );
  expirationInterval = setInterval(() => {
    expireSubscriptions(normalizedToken, options).catch((error) => {
      console.error('Falha ao expirar assinaturas do Telegram:', error);
    });
  }, expirationCheckIntervalMs);
  paymentVerificationInterval = setInterval(() => {
    autoVerifyPendingPayments(normalizedToken, options)
      .then(() => sendPendingPaymentReminders(normalizedToken, options))
      .then(() => expirePendingPixPayments(normalizedToken, options))
      .catch((error) => {
        console.error('Falha ao verificar pagamentos pendentes:', error);
      });
  }, 10000);

  return {
    enabled: true,
    async checkMediaAssetCache(assetUrl, mediaType = 'image') {
      return checkMediaAssetTelegramCache(
        normalizedToken,
        assetUrl,
        toText(mediaType).toLowerCase() === 'video' ? 'video' : 'image',
        options,
      );
    },
    async warmMediaAsset(assetUrl, mediaType = 'image') {
      return warmMediaAssetToTelegramCache(
        normalizedToken,
        assetUrl,
        toText(mediaType).toLowerCase() === 'video' ? 'video' : 'image',
        options,
      );
    },
    async handlePaymentWebhook(payload) {
      return processPaymentWebhookPayload(normalizedToken, payload, options);
    },
    stop() {
      isStopped = true;

      if (pollingTimeout) {
        clearTimeout(pollingTimeout);
      }

      if (expirationInterval) {
        clearInterval(expirationInterval);
      }

      if (paymentVerificationInterval) {
        clearInterval(paymentVerificationInterval);
      }
    },
  };
}
