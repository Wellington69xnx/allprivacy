import path from 'node:path';
import QRCode from 'qrcode';
import { openAsBlob, promises as fs } from 'node:fs';
import { isSyncPayPaidStatus } from './syncpay-client.mjs';

const telegramApiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
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
          text: `💳 ${buildPaymentLabel(plan)}`,
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
  const normalizedPlanId = normalizePlanId(payment.planId) || normalizePlanId(paymentConfig.defaultPlanId) || '30d';
  const rows = [
    [{ text: '✅ Ja paguei, verificar', callback_data: `verify:${payment.id}` }],
    ...(paymentConfig.simulationEnabled
      ? [[{ text: '🧪 Simular pagamento', callback_data: `simulate-pay:${payment.id}` }]]
      : []),
    [{ text: '🔄 Gerar novo Pix', callback_data: `repay:${normalizedPlanId}:${payment.modelSlug || 'home'}` }],
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

function getRandomModelMediaSelection(model) {
  const gallery = Array.isArray(model.gallery) ? model.gallery : [];
  const videos = shuffleArray(
    gallery.filter((item) => item.type === 'video' && toText(item.src)),
  );
  const images = shuffleArray(
    gallery.filter((item) => item.type === 'image' && toText(item.thumbnail)),
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

  const remainingMedia = shuffleArray(
    gallery.filter(
      (item) =>
        !selectedIds.has(item.id) &&
        (item.type === 'video' ? toText(item.src) : toText(item.thumbnail)),
    ),
  );

  for (const item of remainingMedia) {
    if (selection.length >= 3) {
      break;
    }

    selection.push(item);
  }

  return selection.slice(0, 3);
}

function pickDistinctMedia(items, count, excludedModelSlugs = new Set()) {
  const shuffledItems = shuffleArray(items);
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

function getRandomSitewideMediaSelection(siteContent) {
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

  const selectedVideos = pickDistinctMedia(videos, 2);
  const selectedImages = pickDistinctMedia(
    images,
    1,
    new Set(selectedVideos.map((item) => toText(item.modelSlug)).filter(Boolean)),
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
          text: `💳 ${buildPaymentLabel(plan)}`,
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

  async function ensureLoaded() {
    if (isLoaded || !cacheFilePath) {
      return;
    }

    isLoaded = true;

    try {
      const raw = await fs.readFile(cacheFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      cache = {};
    }
  }

  return {
    async get(assetUrl) {
      const normalizedAssetUrl = toText(assetUrl);

      if (!normalizedAssetUrl) {
        return '';
      }

      await ensureLoaded();
      return toText(cache[normalizedAssetUrl]);
    },
    async set(assetUrl, fileId) {
      const normalizedAssetUrl = toText(assetUrl);
      const normalizedFileId = toText(fileId);

      if (!normalizedAssetUrl || !normalizedFileId || !cacheFilePath) {
        return;
      }

      await ensureLoaded();

      if (cache[normalizedAssetUrl] === normalizedFileId) {
        return;
      }

      cache[normalizedAssetUrl] = normalizedFileId;
      writeQueue = writeQueue
        .then(async () => {
          await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
          await fs.writeFile(cacheFilePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
        })
        .catch((error) => {
          console.error('Falha ao salvar cache de arquivos do Telegram:', error);
        });

      await writeQueue;
    },
  };
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
) {
  const normalizedAssetUrl = toText(assetUrl);

  if (!normalizedAssetUrl) {
    return null;
  }

  const cachedFileId = await telegramFileCache?.get(normalizedAssetUrl);

  if (cachedFileId) {
    return {
      kind: 'file-id',
      value: cachedFileId,
      assetUrl: normalizedAssetUrl,
    };
  }

  const localAssetPath = resolveLocalAssetPath?.(normalizedAssetUrl);

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

async function sendText(token, chatId, text, extra = {}) {
  const {
    parseMode = 'Markdown',
    disableWebPagePreview = true,
    ...rest
  } = extra;
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: disableWebPagePreview,
    ...rest,
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  return telegramRequest(token, 'sendMessage', payload);
}

async function sendHtmlText(token, chatId, html, extra = {}) {
  return sendText(token, chatId, html, { ...extra, parseMode: 'HTML' });
}

async function sendPlainText(token, chatId, text, extra = {}) {
  return sendText(token, chatId, text, { ...extra, parseMode: null });
}

async function sendPhoto(token, chatId, photoSource, caption, extra = {}, telegramFileCache) {
  if (photoSource?.kind === 'local') {
    const result = await telegramMultipartRequest(token, 'sendPhoto', async (formData) => {
      formData.append('chat_id', String(chatId));
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'Markdown');
      }
      formData.append('photo', await createUploadBlob(photoSource.filePath), photoSource.filename);

      for (const [key, value] of Object.entries(extra)) {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    });

    await telegramFileCache?.set(photoSource.assetUrl, extractTelegramFileId(result));
    return result;
  }

  const result = await telegramRequest(token, 'sendPhoto', {
    chat_id: chatId,
    photo: photoSource?.value,
    ...(caption
      ? {
          caption,
          parse_mode: 'Markdown',
        }
      : {}),
    ...extra,
  });

  await telegramFileCache?.set(photoSource?.assetUrl, extractTelegramFileId(result));
  return result;
}

async function sendPhotoBuffer(token, chatId, buffer, filename, caption, extra = {}) {
  return telegramMultipartRequest(token, 'sendPhoto', async (formData) => {
    formData.append('chat_id', String(chatId));

    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'Markdown');
    }

    formData.append('photo', new Blob([buffer]), filename);

    for (const [key, value] of Object.entries(extra)) {
      formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  });
}

async function sendVideo(token, chatId, videoSource, caption = '', extra = {}, telegramFileCache) {
  if (videoSource?.kind === 'local') {
    const result = await telegramMultipartRequest(token, 'sendVideo', async (formData) => {
      formData.append('chat_id', String(chatId));
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'Markdown');
      }
      formData.append('supports_streaming', 'true');
      formData.append('video', await createUploadBlob(videoSource.filePath), videoSource.filename);

      for (const [key, value] of Object.entries(extra)) {
        formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    });

    await telegramFileCache?.set(videoSource.assetUrl, extractTelegramFileId(result));
    return result;
  }

  const result = await telegramRequest(token, 'sendVideo', {
    chat_id: chatId,
    video: videoSource?.value,
    supports_streaming: true,
    ...(caption
      ? {
          caption,
          parse_mode: 'Markdown',
        }
      : {}),
    ...extra,
  });

  await telegramFileCache?.set(videoSource?.assetUrl, extractTelegramFileId(result));
  return result;
}

async function sendMediaGroup(token, chatId, mediaSources, telegramFileCache) {
  const hasLocalFile = mediaSources.some((item) => item.media?.kind === 'local');

  if (!hasLocalFile) {
    const result = await telegramRequest(token, 'sendMediaGroup', {
      chat_id: chatId,
      media: mediaSources.map((item) => ({
        type: item.type,
        media: item.media?.value,
        ...(item.supports_streaming ? { supports_streaming: true } : {}),
      })),
    });

    await Promise.all(
      result.map((message, index) =>
        telegramFileCache?.set(
          mediaSources[index]?.media?.assetUrl,
          extractTelegramFileId(message),
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
        });
        continue;
      }

      mediaPayload.push({
        type: item.type,
        media: item.media?.value,
        ...(item.supports_streaming ? { supports_streaming: true } : {}),
      });
    }

    formData.append('media', JSON.stringify(mediaPayload));
  });

  await Promise.all(
    result.map((message, index) =>
      telegramFileCache?.set(
        mediaSources[index]?.media?.assetUrl,
        extractTelegramFileId(message),
      ),
    ),
  );

  return result;
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
  const paymentPlan = getPaymentPlanForPayment(payment, options);
  const paymentCode =
    toText(payment.paymentCode) || decodePixCodeFromBase64(payment.paymentCodeBase64);
  const qrImageBuffer = decodeQrImageBuffer(payment.paymentCodeBase64);
  const dueText = payment.pixExpiresAt
    ? formatDateTimeBR(payment.pixExpiresAt)
    : payment.dueAt
      ? formatDateTimeBR(payment.dueAt)
      : '';
  const modelText = payment.modelName ? `\n👤 Modelo: ${payment.modelName}` : '';
  const publicAmount = Number(payment.displayAmount || paymentPlan?.displayAmount || payment.amount || 0);
  const publicDuration = toText(payment.planDurationLabel) || toText(paymentPlan?.durationLabel) || 'acesso VIP';
  const planName = toText(payment.planName) || toText(paymentPlan?.name);
  const planText = planName ? `\n💎 Plano: *${planName}*` : '';
  const caption = `💳 Pix gerado para *acesso temporario*.\n💰 Valor: *${formatCurrencyBRL(
    publicAmount,
  )}*\n⏳ Periodo: *${publicDuration}*${planText}${modelText}`;

  const sentMessageIds = [];

  if (qrImageBuffer || paymentCode) {
    try {
      const qrBuffer = qrImageBuffer || (await createPaymentQrBuffer(paymentCode));
      const qrMessage = await sendPhotoBuffer(token, chatId, qrBuffer, `${payment.id}.png`, caption);
      if (Number.isInteger(qrMessage?.message_id)) {
        sentMessageIds.push(qrMessage.message_id);
      }
    } catch (error) {
      logBot('Falha ao gerar QR Code local.', {
        chatId,
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallbackMessage = await sendText(token, chatId, caption);
      if (Number.isInteger(fallbackMessage?.message_id)) {
        sentMessageIds.push(fallbackMessage.message_id);
      }
    }
  }

  const lines = [
    '<b>📋 Pix copia e cola</b>',
    paymentCode ? `<code>${escapeHtml(paymentCode)}</code>` : 'A Syncpay nao retornou o codigo Pix.',
    dueText ? `<b>⏰ Validade:</b> ${escapeHtml(dueText)}` : '',
    '<b>🤖 O bot verifica automaticamente.</b> Se quiser, voce tambem pode tocar em "Ja paguei, verificar".',
  ].filter(Boolean);

  const pixMessage = await sendHtmlText(token, chatId, lines.join('\n\n'), {
    reply_markup: buildPaymentKeyboard(payment, options.paymentConfig),
  });

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
    return sendPlainText(
      token,
      chatId,
      'Os pagamentos por Pix ainda nao estao configurados. Defina a API da Syncpay, o chat privado e o webhook para liberar este fluxo.',
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
      if (payment.syncpayTransactionId) {
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
  const mediaPreview = getRandomModelMediaSelection(model);
  const selectedSummary = mediaPreview.map((item) => item.type).join(', ');

  logBot('Enviando previas da modelo.', {
    chatId,
    model: model.name,
    totalMidias: mediaPreview.length,
    selecao: selectedSummary,
  });

  if (mediaPreview.length > 0) {
    for (const item of mediaPreview) {
      if (item.type === 'video') {
        const videoSource = await resolveTelegramMediaSource(
          item.src,
          options.siteUrl,
          options.resolveLocalAssetPath,
          options.telegramFileCache,
        );

        await sendVideo(
          token,
          chatId,
          videoSource,
          '',
          {},
          options.telegramFileCache,
        );
        continue;
      }

      const photoSource = await resolveTelegramMediaSource(
        item.thumbnail,
        options.siteUrl,
        options.resolveLocalAssetPath,
        options.telegramFileCache,
      );

      await sendPhoto(
        token,
        chatId,
        photoSource,
        '',
        {},
        options.telegramFileCache,
      );
    }
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
  const mediaPreview = getRandomSitewideMediaSelection(siteContent);

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

  for (const item of mediaPreview) {
    if (item.type === 'video') {
      const videoSource = await resolveTelegramMediaSource(
        item.src,
        options.siteUrl,
        options.resolveLocalAssetPath,
        options.telegramFileCache,
      );

      await sendVideo(token, chatId, videoSource, '', {}, options.telegramFileCache);
      continue;
    }

    const photoSource = await resolveTelegramMediaSource(
      item.thumbnail,
      options.siteUrl,
      options.resolveLocalAssetPath,
      options.telegramFileCache,
    );

    await sendPhoto(token, chatId, photoSource, '', {}, options.telegramFileCache);
  }

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

    if (!previewResult.usage.canUse) {
      return sendPlainText(token, chatId, '🌐 Acesse o site para mais previas.', {
        reply_markup: await buildStartKeyboardForChat(chatId, options),
      });
    }

    return sendText(
      token,
      chatId,
      '*AllPrivacy*\n\n👀 Veja mais previas.\n💳 Ou gere seu Pix para liberar o grupo privado.',
      {
        reply_markup: await buildStartKeyboardForChat(chatId, options, 'Ver mais previas'),
      },
    );
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
  const telegramFileCache = createTelegramFileCache(cacheFilePath);

  const options = {
    siteUrl: buildHomeUrl(siteUrl),
    groupUrl: buildGroupUrl(groupUrl, siteUrl),
    resolveLocalAssetPath,
    telegramFileCache,
    billingStore,
    paymentClient,
    paymentConfig: {
      enabled:
        Boolean(paymentClient?.enabled) &&
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
      previewUsageWindowMs: Math.max(1000, Number(paymentConfig?.previewUsageWindowMs || 24 * 60 * 60 * 1000)),
      pixTtlMs: Math.max(60000, Number(paymentConfig?.pixTtlMs || 5 * 60 * 1000)),
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
        await processUpdate(update);
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
      .then(() => expirePendingPixPayments(normalizedToken, options))
      .catch((error) => {
        console.error('Falha ao verificar pagamentos pendentes:', error);
      });
  }, 10000);

  return {
    enabled: true,
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
