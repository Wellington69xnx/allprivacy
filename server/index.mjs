import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBillingStore } from './billing-store.mjs';
import { createSyncPayClient } from './syncpay-client.mjs';
import { startTelegramBot } from './telegram-bot.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');
const uploadsDir = path.join(storageDir, 'uploads');
const siteContentPath = path.join(storageDir, 'site-content.json');
const billingStatePath = path.join(storageDir, 'billing-state.json');
const telegramFileCachePath = path.join(storageDir, 'telegram-file-cache.json');
const distDir = path.join(projectRoot, 'dist');
const telegramPhotoUploadLimitBytes = 10 * 1024 * 1024;
const telegramOtherUploadLimitBytes = 50 * 1024 * 1024;
const port = Number(process.env.PORT || 3001);
const sitePublicUrl = process.env.SITE_PUBLIC_URL || `http://localhost:${port}`;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramGroupUrl = process.env.TELEGRAM_GROUP_URL || sitePublicUrl;
const telegramPrivateGroupChatId = process.env.TELEGRAM_PRIVATE_GROUP_CHAT_ID || '';
const telegramCacheChatId = process.env.TELEGRAM_CACHE_CHAT_ID || '';
const syncPayApiKey = process.env.SYNC_PAY_API_KEY || '';
const syncPayApiKeyBase64 = process.env.SYNC_PAY_API_KEY_BASE64 || '';
const syncPayClientId = process.env.SYNC_PAY_CLIENT_ID || '';
const syncPayClientSecret = process.env.SYNC_PAY_CLIENT_SECRET || '';
const syncPayBaseUrl = process.env.SYNC_PAY_BASE_URL || 'https://api.syncpay.pro';
const syncPayWebhookSecret = process.env.SYNC_PAY_WEBHOOK_SECRET || '';
const paymentSimulationEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PAYMENT_SIMULATION_ENABLED || '').trim().toLowerCase(),
);
const paymentFakePixEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.PAYMENT_FAKE_PIX_ENABLED || '').trim().toLowerCase(),
);
const syncPayWebhookUrl =
  process.env.SYNC_PAY_WEBHOOK_URL ||
  `${sitePublicUrl.replace(/\/+$/, '')}/api/payments/syncpay/webhook${
    syncPayWebhookSecret
      ? `?secret=${encodeURIComponent(syncPayWebhookSecret)}`
      : ''
  }`;
const syncPayTestAmount7Days = Number(process.env.SYNC_PAY_TEST_AMOUNT_7D || process.env.SYNC_PAY_TEST_AMOUNT || 1.01);
const syncPayTestAmount30Days = Number(process.env.SYNC_PAY_TEST_AMOUNT_30D || 1.02);
const syncPayTestCustomerName = process.env.SYNC_PAY_TEST_CUSTOMER_NAME || '';
const syncPayTestCustomerEmail = process.env.SYNC_PAY_TEST_CUSTOMER_EMAIL || '';
const syncPayTestCustomerCpf = process.env.SYNC_PAY_TEST_CUSTOMER_CPF || '';
const syncPayTestCustomerPhone = process.env.SYNC_PAY_TEST_CUSTOMER_PHONE || '';
const subscriptionDuration7DaysSeconds = Number(process.env.SUBSCRIPTION_DURATION_SECONDS_7D || 30);
const subscriptionDuration30DaysSeconds = Number(process.env.SUBSCRIPTION_DURATION_SECONDS_30D || 60);
const previewUsageWindowSeconds = Number(process.env.PREVIEW_USAGE_WINDOW_SECONDS || 24 * 60 * 60);
const previewUsageWindowMs = Math.max(1, previewUsageWindowSeconds) * 1000;
const pixTtlSeconds = Number(process.env.PIX_TTL_SECONDS || 10 * 60);
const pixTtlMs = Math.max(60, pixTtlSeconds) * 1000;
const paymentPlans = [
  {
    id: '7d',
    name: 'Plano 7 dias',
    durationLabel: '7 dias',
    displayAmount: 9.99,
    chargeAmount: syncPayTestAmount7Days,
    durationMs: Math.max(1, subscriptionDuration7DaysSeconds) * 1000,
  },
  {
    id: '30d',
    name: 'Plano 30 dias',
    durationLabel: '30 dias',
    displayAmount: 19.99,
    chargeAmount: syncPayTestAmount30Days,
    durationMs: Math.max(1, subscriptionDuration30DaysSeconds) * 1000,
  },
];
const adminCookieName = 'allprivacy_admin';
const adminUsername = 'well69xnx';
const adminPassword = 'Download';
const authSecret = process.env.ADMIN_AUTH_SECRET || 'allprivacy-admin-local-secret';
const sessionMaxAgeSeconds = 60 * 60 * 12;
const uploadPlanKey = Symbol('allprivacy-upload-plan');

const defaultSiteContent = {
  models: [],
  groupProofItems: [],
  heroBackgrounds: {
    mobile: [],
    desktop: [],
  },
};

const accentPairs = [
  ['#ff2056', '#8b5cf6'],
  ['#ef4444', '#7c3aed'],
  ['#f43f5e', '#9333ea'],
  ['#dc2626', '#7e22ce'],
  ['#fb7185', '#6d28d9'],
];

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function formatCurrencyBRL(amount) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function cloneDefaultSiteContent() {
  return JSON.parse(JSON.stringify(defaultSiteContent));
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);

      return {
        ...cookies,
        [key]: decodeURIComponent(value),
      };
    }, {});
}

function createSessionToken(username) {
  const expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  const payload = `${username}.${expiresAt}`;
  const signature = createHmac('sha256', authSecret).update(payload).digest('hex');

  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token) {
    return false;
  }

  const [username, expiresAtValue, signature] = token.split('.');

  if (!username || !expiresAtValue || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtValue);

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const payload = `${username}.${expiresAt}`;
  const expectedSignature = createHmac('sha256', authSecret).update(payload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

function isAuthenticatedRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[adminCookieName];
  return verifySessionToken(token);
}

function requireAdminAuth(req, res, next) {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ message: 'Nao autorizado.' });
    return;
  }

  next();
}

function hasValidPaymentSecret(req) {
  const secret = toText(req.query?.secret);

  if (!syncPayWebhookSecret) {
    return true;
  }

  return secret === syncPayWebhookSecret;
}

function sanitizeFilename(originalName, mimeType) {
  const originalExtension = path.extname(originalName || '');
  const mimeExtension = mimeType?.split('/')[1] ? `.${mimeType.split('/')[1]}` : '';
  const extension = originalExtension || mimeExtension || '';
  const basename = path
    .basename(originalName || 'upload', originalExtension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return `${basename || 'asset'}-${Date.now()}-${randomUUID()}${extension}`;
}

function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sanitizeFolderSegment(value, fallback = 'item') {
  const normalized = stripAccents(toText(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return normalized || fallback;
}

function sanitizeDisplayName(value, fallback = 'Arquivo') {
  const normalized = stripAccents(toText(value))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return normalized || fallback;
}

function resolveExtension(originalName, mimeType) {
  const originalExtension = path.extname(toText(originalName)).toLowerCase();

  if (originalExtension) {
    return originalExtension;
  }

  const mimeSubtype = toText(mimeType).split('/')[1];

  if (!mimeSubtype) {
    return '.bin';
  }

  const normalizedSubtype = mimeSubtype.split(';')[0].trim().toLowerCase();

  if (normalizedSubtype === 'jpeg') {
    return '.jpg';
  }

  if (normalizedSubtype === 'quicktime') {
    return '.mov';
  }

  return `.${normalizedSubtype.replace(/[^a-z0-9]+/g, '') || 'bin'}`;
}

async function countFilesWithPrefix(directory, prefix) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter(
      (entry) =>
        entry.isFile() &&
        path.parse(entry.name).name.toLowerCase().startsWith(prefix.toLowerCase()),
    ).length;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

function buildUploadUrlFromPath(filePath) {
  const relativePath = path.relative(uploadsDir, filePath);
  const publicPath = relativePath
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `/uploads/${publicPath}`;
}

function readUploadMeta(req) {
  const query = req.query ?? {};

  return {
    bucket:
      toText(query.bucket) ||
      toText(req.headers['x-upload-bucket']) ||
      toText(req.body?.bucket),
    modelName:
      toText(query.modelName) ||
      toText(req.headers['x-upload-model-name']) ||
      toText(req.body?.modelName),
    target:
      toText(query.target) ||
      toText(req.headers['x-upload-target']) ||
      toText(req.body?.target),
    mediaType:
      toText(query.mediaType) ||
      toText(req.headers['x-upload-media-type']) ||
      toText(req.body?.mediaType),
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getUniqueFilePath(directory, preferredFilename) {
  const parsed = path.parse(preferredFilename);
  let candidatePath = path.join(directory, preferredFilename);

  if (!(await pathExists(candidatePath))) {
    return candidatePath;
  }

  let suffix = 2;

  while (await pathExists(candidatePath)) {
    candidatePath = path.join(directory, `${parsed.name} ${suffix}${parsed.ext}`);
    suffix += 1;
  }

  return candidatePath;
}

async function buildUploadPlanFromMeta(meta, file) {
  const bucket = toText(meta.bucket);
  const rawModelName = toText(meta.modelName);
  const modelFolder = sanitizeFolderSegment(rawModelName, 'modelo');
  const modelDisplayName = sanitizeDisplayName(rawModelName, 'Modelo');
  const target = toText(meta.target) === 'mobile' ? 'mobile' : 'desktop';
  const requestedMediaType = toText(meta.mediaType);
  const mediaType =
    requestedMediaType === 'video' || file.mimetype.startsWith('video/') ? 'video' : 'image';
  let directory = uploadsDir;
  let baseFilename = sanitizeDisplayName(
    path.parse(file.originalname || 'upload').name,
    'Arquivo',
  );

  if (bucket === 'model-profile') {
    directory = path.join(uploadsDir, modelFolder);
    baseFilename = `${modelDisplayName} foto de perfil`;
  } else if (bucket === 'model-cover') {
    directory = path.join(uploadsDir, modelFolder);
    baseFilename = `${modelDisplayName} foto de capa`;
  } else if (bucket === 'model-media') {
    directory = path.join(uploadsDir, modelFolder);
    baseFilename = `${modelDisplayName} ${mediaType === 'video' ? 'video' : 'imagem'}`;
  } else if (bucket === 'hero-background') {
    directory = path.join(uploadsDir, 'hero-backgrounds', target);
    baseFilename = `background ${target}`;
  } else if (bucket === 'group-proof') {
    directory = path.join(uploadsDir, 'group-proofs');
    baseFilename = 'print grupo';
  }

  await fs.mkdir(directory, { recursive: true });

  const extension = resolveExtension(file.originalname, file.mimetype);
  const existingCount = await countFilesWithPrefix(directory, baseFilename);
  const filename =
    bucket === 'model-profile' || bucket === 'model-cover'
      ? existingCount === 0
        ? `${baseFilename}${extension}`
        : `${baseFilename} ${existingCount + 1}${extension}`
      : `${baseFilename} ${existingCount + 1}${extension}`;

  return {
    directory,
    filename,
  };
}

async function buildUploadPlan(req, file) {
  return buildUploadPlanFromMeta(readUploadMeta(req), file);
}

async function getUploadPlan(req, file) {
  if (req[uploadPlanKey]) {
    return req[uploadPlanKey];
  }

  const uploadPlan = await buildUploadPlan(req, file);
  req[uploadPlanKey] = uploadPlan;
  return uploadPlan;
}

function resolveLocalUploadPath(assetUrl) {
  const normalizedUrl = toText(assetUrl);

  if (!normalizedUrl.startsWith('/uploads/')) {
    return null;
  }

  const relativePath = normalizedUrl
    .replace(/^\/uploads\//, '')
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join(path.sep);

  return path.join(uploadsDir, relativePath);
}

async function moveFileSafely(sourcePath, targetDirectory, preferredFilename) {
  await fs.mkdir(targetDirectory, { recursive: true });
  const preferredPath = path.join(targetDirectory, preferredFilename);
  const finalPath =
    path.resolve(sourcePath) === path.resolve(preferredPath)
      ? preferredPath
      : await getUniqueFilePath(targetDirectory, preferredFilename);

  if (path.resolve(sourcePath) === path.resolve(finalPath)) {
    return finalPath;
  }

  try {
    await fs.rename(sourcePath, finalPath);
  } catch {
    await fs.copyFile(sourcePath, finalPath);
    await fs.unlink(sourcePath);
  }

  return finalPath;
}

async function migrateAssetUrl(assetUrl, meta, movedAssets) {
  const normalizedUrl = toText(assetUrl);

  if (!normalizedUrl) {
    return normalizedUrl;
  }

  if (movedAssets.has(normalizedUrl)) {
    return movedAssets.get(normalizedUrl);
  }

  const sourcePath = resolveLocalUploadPath(normalizedUrl);

  if (!sourcePath || !(await pathExists(sourcePath))) {
    return normalizedUrl;
  }

  const uploadPlan = await buildUploadPlanFromMeta(meta, {
    originalname: path.basename(sourcePath),
    mimetype: '',
  });
  const finalPath = await moveFileSafely(sourcePath, uploadPlan.directory, uploadPlan.filename);
  const nextUrl = buildUploadUrlFromPath(finalPath);
  movedAssets.set(normalizedUrl, nextUrl);
  return nextUrl;
}

async function migrateSiteContentFiles(siteContent) {
  const nextContent = cloneDefaultSiteContent();
  const movedAssets = new Map();

  for (const model of siteContent.models) {
    const nextModel = {
      ...model,
      profileImage: await migrateAssetUrl(
        model.profileImage,
        {
          bucket: 'model-profile',
          modelName: model.name,
          mediaType: 'image',
        },
        movedAssets,
      ),
      coverImage: await migrateAssetUrl(
        model.coverImage,
        {
          bucket: 'model-cover',
          modelName: model.name,
          mediaType: 'image',
        },
        movedAssets,
      ),
      gallery: [],
    };

    for (const item of model.gallery) {
      if (item.type === 'video') {
        const nextSrc = await migrateAssetUrl(
          item.src,
          {
            bucket: 'model-media',
            modelName: model.name,
            mediaType: 'video',
          },
          movedAssets,
        );
        const nextThumbnail =
          toText(item.thumbnail) === toText(item.src)
            ? nextSrc
            : await migrateAssetUrl(
                item.thumbnail,
                {
                  bucket: 'model-media',
                  modelName: model.name,
                  mediaType: 'image',
                },
                movedAssets,
              );

        nextModel.gallery.push({
          ...item,
          src: nextSrc,
          thumbnail: nextThumbnail,
        });
      } else {
        nextModel.gallery.push({
          ...item,
          thumbnail: await migrateAssetUrl(
            item.thumbnail,
            {
              bucket: 'model-media',
              modelName: model.name,
              mediaType: 'image',
            },
            movedAssets,
          ),
        });
      }
    }

    nextContent.models.push(nextModel);
  }

  for (const item of siteContent.groupProofItems) {
    nextContent.groupProofItems.push({
      ...item,
      image: await migrateAssetUrl(
        item.image,
        {
          bucket: 'group-proof',
          mediaType: 'image',
        },
        movedAssets,
      ),
    });
  }

  for (const target of ['mobile', 'desktop']) {
    for (const item of siteContent.heroBackgrounds[target]) {
      nextContent.heroBackgrounds[target].push({
        ...item,
        image: await migrateAssetUrl(
          item.image,
          {
            bucket: 'hero-background',
            target,
            mediaType: 'image',
          },
          movedAssets,
        ),
      });
    }
  }

  return normalizeSiteContent(nextContent);
}

async function moveLooseRootUploadsToLegacy() {
  const entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  const legacyDir = path.join(uploadsDir, '_legacy-root');

  for (const entry of entries) {
    if (!entry.isFile() || entry.name === '.gitkeep') {
      continue;
    }

    const sourcePath = path.join(uploadsDir, entry.name);
    const finalPath = await getUniqueFilePath(legacyDir, entry.name);
    await fs.mkdir(legacyDir, { recursive: true });

    try {
      await fs.rename(sourcePath, finalPath);
    } catch {
      await fs.copyFile(sourcePath, finalPath);
      await fs.unlink(sourcePath);
    }
  }
}

function normalizeMedia(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const type = item.type === 'video' ? 'video' : 'image';
  const src = toText(item.src);
  const thumbnail = toText(item.thumbnail) || (type === 'video' ? src : '');

  if (type === 'image' && !thumbnail) {
    return null;
  }

  if (type === 'video' && !src) {
    return null;
  }

  return {
    id: toText(item.id) || createId('media'),
    type,
    title: toText(item.title) || 'Previa',
    subtitle: toText(item.subtitle),
    thumbnail,
    src: type === 'video' ? src : undefined,
  };
}

function normalizeModel(model, index = 0) {
  if (!model || typeof model !== 'object') {
    return null;
  }

  const name = toText(model.name);
  const profileImage = toText(model.profileImage);
  const coverImage = toText(model.coverImage);
  const accentPair = accentPairs[index % accentPairs.length] || accentPairs[0];

  if (!name || !profileImage || !coverImage) {
    return null;
  }

  return {
    id: toText(model.id) || createId('model'),
    name,
    handle: toText(model.handle),
    tagline: toText(model.tagline),
    accentFrom: toText(model.accentFrom) || accentPair[0],
    accentTo: toText(model.accentTo) || accentPair[1],
    profileImage,
    coverImage,
    gallery: Array.isArray(model.gallery)
      ? model.gallery.map(normalizeMedia).filter(Boolean)
      : [],
  };
}

function normalizeGroupProofItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const image = toText(item.image);

  if (!image) {
    return null;
  }

  return {
    id: toText(item.id) || createId('group'),
    title: toText(item.title) || 'Print do grupo',
    subtitle: toText(item.subtitle),
    image,
  };
}

function normalizeHeroBackgroundItem(item, fallbackTarget = 'desktop') {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const image = toText(item.image);

  if (!image) {
    return null;
  }

  return {
    id: toText(item.id) || createId('hero'),
    title: toText(item.title),
    image,
    target: item.target === 'mobile' ? 'mobile' : fallbackTarget,
  };
}

function normalizeSiteContent(payload) {
  if (!payload || typeof payload !== 'object') {
    return cloneDefaultSiteContent();
  }

  return {
    models: Array.isArray(payload.models)
      ? payload.models.map(normalizeModel).filter(Boolean)
      : [],
    groupProofItems: Array.isArray(payload.groupProofItems)
      ? payload.groupProofItems.map(normalizeGroupProofItem).filter(Boolean)
      : [],
    heroBackgrounds: {
      mobile: Array.isArray(payload.heroBackgrounds?.mobile)
        ? payload.heroBackgrounds.mobile
            .map((item) => normalizeHeroBackgroundItem(item, 'mobile'))
            .filter(Boolean)
        : [],
      desktop: Array.isArray(payload.heroBackgrounds?.desktop)
        ? payload.heroBackgrounds.desktop
            .map((item) => normalizeHeroBackgroundItem(item, 'desktop'))
            .filter(Boolean)
        : [],
    },
  };
}

async function ensureStorage() {
  await fs.mkdir(uploadsDir, { recursive: true });

  try {
    await fs.access(siteContentPath);
  } catch {
    await fs.writeFile(
      siteContentPath,
      `${JSON.stringify(defaultSiteContent, null, 2)}\n`,
      'utf8',
    );
  }
}

async function readSiteContent() {
  await ensureStorage();

  try {
    const raw = await fs.readFile(siteContentPath, 'utf8');
    return normalizeSiteContent(JSON.parse(raw));
  } catch {
    return cloneDefaultSiteContent();
  }
}

async function writeSiteContent(content) {
  await ensureStorage();

  const normalized = normalizeSiteContent(content);

  await fs.writeFile(siteContentPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

  return normalized;
}

function isBotCacheableExtension(extension) {
  const normalizedExtension = toText(extension).toLowerCase();
  return [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.mp4',
    '.mov',
    '.webm',
    '.m4v',
  ].includes(normalizedExtension);
}

async function collectTelegramCacheAssets(siteContent) {
  const assets = new Map();

  const addAsset = (assetUrl, mediaType) => {
    const normalizedUrl = toText(assetUrl);

    if (!normalizedUrl) {
      return;
    }

    const currentType = assets.get(normalizedUrl);

    if (!currentType || (currentType !== 'video' && mediaType === 'video')) {
      assets.set(normalizedUrl, mediaType === 'video' ? 'video' : 'image');
    }
  };

  for (const model of siteContent.models) {
    for (const item of model.gallery) {
      if (item.type === 'video') {
        addAsset(item.src, 'video');
        continue;
      }

      addAsset(item.thumbnail, 'image');
    }
  }

  const botUploadsDir = path.join(uploadsDir, 'bot');

  try {
    const botEntries = await fs.readdir(botUploadsDir, { withFileTypes: true });

    for (const entry of botEntries) {
      if (!entry.isFile() || !isBotCacheableExtension(path.extname(entry.name))) {
        continue;
      }

      const mediaType = ['.mp4', '.mov', '.webm', '.m4v'].includes(
        path.extname(entry.name).toLowerCase(),
      )
        ? 'video'
        : 'image';
      addAsset(buildUploadUrlFromPath(path.join(botUploadsDir, entry.name)), mediaType);
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw error;
    }
  }

  return Array.from(assets.entries()).map(([assetUrl, mediaType]) => ({
    assetUrl,
    mediaType,
  }));
}

const telegramCacheWarmJobs = new Map();
let activeTelegramCacheWarmJobId = null;

function trimTelegramCacheWarmLogs(logs = []) {
  return logs.slice(-18);
}

function getTelegramCacheAssetLabel(assetUrl) {
  const filename = toText(assetUrl).split('/').pop() || assetUrl;

  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function getTelegramCacheAssetGroupLabel(assetUrl) {
  const normalizedUrl = toText(assetUrl);
  const segments = normalizedUrl
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter(Boolean);

  const uploadsIndex = segments.indexOf('uploads');
  const firstFolder = uploadsIndex >= 0 ? segments[uploadsIndex + 1] : segments[0];

  if (!firstFolder) {
    return 'Outros';
  }

  if (firstFolder === 'bot') {
    return 'Bot';
  }

  return firstFolder
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getTelegramCacheUploadLimitBytes(mediaType) {
  return toText(mediaType).toLowerCase() === 'image'
    ? telegramPhotoUploadLimitBytes
    : telegramOtherUploadLimitBytes;
}

function getTelegramCacheTooBigMessage() {
  return 'Arquivo acima do limite aceito pelo Bot do Telegram para esse tipo de envio.';
}

async function getTelegramCacheAssetPrecheckError(assetUrl, mediaType) {
  const localPath = resolveLocalUploadPath(assetUrl);

  if (!localPath || !(await pathExists(localPath))) {
    return '';
  }

  const stats = await fs.stat(localPath);

  if (Number(stats.size || 0) > getTelegramCacheUploadLimitBytes(mediaType)) {
    return getTelegramCacheTooBigMessage();
  }

  return '';
}

function normalizeTelegramCacheReason(reason) {
  const normalizedReason = toText(reason);

  if (!normalizedReason) {
    return 'cache_failed';
  }

  if (
    normalizedReason.toLowerCase().includes('file is too big') ||
    normalizedReason.toLowerCase().includes('too big')
  ) {
    return getTelegramCacheTooBigMessage();
  }

  return normalizedReason;
}

function createTelegramCacheWarmStatus(jobId, mode = 'warm') {
  return {
    jobId,
    mode,
    state: 'running',
    total: 0,
    checked: 0,
    alreadyCached: 0,
    warmed: 0,
    failed: 0,
    failures: [],
    progressPercent: 0,
    currentStep: 'Preparando aquecimento do cache do Telegram...',
    currentAsset: '',
    message: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    items: [],
    logs: [
      {
        id: `log-${randomUUID()}`,
        level: 'info',
        message:
          mode === 'check'
            ? 'Job iniciado. Preparando verificacao das midias em cache.'
            : 'Job iniciado. Preparando lista de midias para cache.',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function pushTelegramCacheWarmLog(jobStatus, level, message) {
  const entry = {
    id: `log-${randomUUID()}`,
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  jobStatus.logs = trimTelegramCacheWarmLogs([...(jobStatus.logs || []), entry]);
}

function finalizeTelegramCacheWarmJob(jobStatus, state, message = '') {
  jobStatus.state = state;
  jobStatus.message = message;
  jobStatus.currentAsset = '';
  jobStatus.currentStep =
    state === 'completed'
      ? 'Cache do Telegram concluido.'
      : 'Falha ao concluir o cache do Telegram.';
  jobStatus.progressPercent = state === 'completed' ? 100 : jobStatus.progressPercent;
  jobStatus.finishedAt = new Date().toISOString();
}

function getTelegramCacheWarmStatus(jobId) {
  return jobId ? telegramCacheWarmJobs.get(jobId) || null : null;
}

async function runTelegramCacheWarmJob(jobStatus, telegramBot, readSiteContent) {
  try {
    const isCheckOnly = jobStatus.mode === 'check';
    const siteContent = await readSiteContent();
    const assets = await collectTelegramCacheAssets(siteContent);
    jobStatus.total = assets.length;
    jobStatus.progressPercent = assets.length === 0 ? 100 : 6;
    jobStatus.currentStep =
      assets.length === 0
        ? isCheckOnly
          ? 'Nenhuma midia elegivel encontrada para verificar.'
          : 'Nenhuma midia elegivel encontrada para cache.'
        : `Encontradas ${assets.length} midia(s) para verificar.`;
    pushTelegramCacheWarmLog(
      jobStatus,
      'info',
      assets.length === 0
        ? isCheckOnly
          ? 'Nenhuma midia elegivel para verificacao foi encontrada.'
          : 'Nenhuma midia elegivel para cache foi encontrada.'
        : isCheckOnly
          ? `${assets.length} midia(s) elegiveis encontradas. Iniciando verificacao do cache...`
          : `${assets.length} midia(s) elegiveis encontradas. Iniciando verificacao...`,
    );

    for (const [index, asset] of assets.entries()) {
      const assetLabel = getTelegramCacheAssetLabel(asset.assetUrl);
      jobStatus.currentAsset = assetLabel;
      jobStatus.currentStep = `Verificando ${index + 1}/${assets.length}: ${assetLabel}`;
      jobStatus.progressPercent = Math.max(
        6,
        Math.min(95, Math.round((index / Math.max(assets.length, 1)) * 100)),
      );
      pushTelegramCacheWarmLog(
        jobStatus,
        'info',
        `Verificando ${index + 1}/${assets.length}: ${assetLabel}`,
      );
      console.log(
        `[telegram-cache:${jobStatus.mode}] ${index + 1}/${assets.length} verificando ${assetLabel} (${asset.mediaType})`,
      );

      try {
        const precheckError = await getTelegramCacheAssetPrecheckError(
          asset.assetUrl,
          asset.mediaType,
        );

        if (precheckError) {
          jobStatus.checked += 1;
          jobStatus.failed += 1;
          jobStatus.failures.push({
            assetUrl: asset.assetUrl,
            mediaType: asset.mediaType,
            reason: precheckError,
          });
          jobStatus.items.push({
            id: `item-${randomUUID()}`,
            groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
            assetLabel,
            assetUrl: asset.assetUrl,
            mediaType: asset.mediaType,
            status: 'failed',
            reason: precheckError,
          });
          pushTelegramCacheWarmLog(jobStatus, 'error', `Falha em ${assetLabel}: ${precheckError}`);
          console.error(`[telegram-cache:${jobStatus.mode}] falha em ${assetLabel}: ${precheckError}`);
          jobStatus.progressPercent = Math.max(
            6,
            Math.min(98, Math.round((jobStatus.checked / Math.max(assets.length, 1)) * 100)),
          );
          continue;
        }

        const result = isCheckOnly
          ? await telegramBot.checkMediaAssetCache(asset.assetUrl, asset.mediaType)
          : await telegramBot.warmMediaAsset(asset.assetUrl, asset.mediaType);
        jobStatus.checked += 1;

        if (!result?.ok) {
          const normalizedReason = normalizeTelegramCacheReason(result?.reason);
          jobStatus.failed += 1;
          jobStatus.failures.push({
            assetUrl: asset.assetUrl,
            mediaType: asset.mediaType,
            reason: normalizedReason,
          });
          jobStatus.items.push({
            id: `item-${randomUUID()}`,
            groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
            assetLabel,
            assetUrl: asset.assetUrl,
            mediaType: asset.mediaType,
            status: 'failed',
            reason: normalizedReason,
          });
          pushTelegramCacheWarmLog(
            jobStatus,
            'error',
            `Falha em ${assetLabel}: ${normalizedReason}`,
          );
          console.error(`[telegram-cache:${jobStatus.mode}] falha em ${assetLabel}: ${normalizedReason}`);
        } else if (result.cached) {
          jobStatus.alreadyCached += 1;
          jobStatus.items.push({
            id: `item-${randomUUID()}`,
            groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
            assetLabel,
            assetUrl: asset.assetUrl,
            mediaType: asset.mediaType,
            status: 'cached',
          });
          pushTelegramCacheWarmLog(jobStatus, 'info', `${assetLabel} ja estava em cache.`);
          console.log(`[telegram-cache:${jobStatus.mode}] ${assetLabel} ja estava em cache`);
        } else {
          if (isCheckOnly) {
            jobStatus.items.push({
              id: `item-${randomUUID()}`,
              groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
              assetLabel,
              assetUrl: asset.assetUrl,
              mediaType: asset.mediaType,
              status: 'missing',
            });
            pushTelegramCacheWarmLog(jobStatus, 'info', `${assetLabel} ainda nao esta em cache.`);
            console.log(`[telegram-cache:${jobStatus.mode}] ${assetLabel} ainda nao esta em cache`);
          } else {
            jobStatus.warmed += 1;
            jobStatus.items.push({
              id: `item-${randomUUID()}`,
              groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
              assetLabel,
              assetUrl: asset.assetUrl,
              mediaType: asset.mediaType,
              status: 'warmed',
            });
            pushTelegramCacheWarmLog(jobStatus, 'success', `${assetLabel} enviado para cache.`);
            console.log(`[telegram-cache:${jobStatus.mode}] ${assetLabel} enviado para cache`);
          }
        }
      } catch (error) {
        const reason = normalizeTelegramCacheReason(
          error instanceof Error ? error.message : 'cache_failed',
        );
        jobStatus.checked += 1;
        jobStatus.failed += 1;
        jobStatus.failures.push({
          assetUrl: asset.assetUrl,
          mediaType: asset.mediaType,
          reason,
        });
        jobStatus.items.push({
          id: `item-${randomUUID()}`,
          groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
          assetLabel,
          assetUrl: asset.assetUrl,
          mediaType: asset.mediaType,
          status: 'failed',
          reason,
        });
        pushTelegramCacheWarmLog(jobStatus, 'error', `Falha em ${assetLabel}: ${reason}`);
        console.error(`[telegram-cache:${jobStatus.mode}] falha em ${assetLabel}:`, error);
      }

      jobStatus.progressPercent = Math.max(
        6,
        Math.min(98, Math.round((jobStatus.checked / Math.max(assets.length, 1)) * 100)),
      );
    }

    const finalMessage =
      jobStatus.mode === 'check'
        ? `Verificacao concluida. ${jobStatus.checked} verificada(s), ${jobStatus.alreadyCached} ja em cache, ${jobStatus.failed} falha(s) e ${Math.max(0, jobStatus.checked - jobStatus.alreadyCached - jobStatus.failed)} fora do cache.`
        : `Cache concluido. ${jobStatus.checked} verificada(s), ${jobStatus.alreadyCached} ja em cache, ${jobStatus.warmed} enviada(s) agora e ${jobStatus.failed} falha(s).`;
    finalizeTelegramCacheWarmJob(jobStatus, 'completed', finalMessage);
    pushTelegramCacheWarmLog(jobStatus, jobStatus.failed > 0 ? 'error' : 'success', finalMessage);
    console.log(`[telegram-cache:${jobStatus.mode}] ${finalMessage}`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Nao foi possivel concluir o cache do Telegram.';
    finalizeTelegramCacheWarmJob(jobStatus, 'failed', message);
    pushTelegramCacheWarmLog(jobStatus, 'error', message);
    console.error(`[telegram-cache:${jobStatus.mode}] falha geral no job:`, error);
  } finally {
    if (activeTelegramCacheWarmJobId === jobStatus.jobId) {
      activeTelegramCacheWarmJobId = null;
    }
  }
}

const billingStore = createBillingStore(billingStatePath);
const syncPayClient = createSyncPayClient({
  apiKey: syncPayApiKey,
  apiKeyBase64: syncPayApiKeyBase64,
  clientId: syncPayClientId,
  clientSecret: syncPayClientSecret,
  baseUrl: syncPayBaseUrl,
});

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      getUploadPlan(req, file)
        .then((plan) => {
          callback(null, plan.directory);
        })
        .catch((error) => {
          callback(error);
        });
    },
    filename(req, file, callback) {
      getUploadPlan(req, file)
        .then((plan) => {
          callback(null, plan.filename);
        })
        .catch((error) => {
          callback(error);
        });
    },
  }),
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
});

const app = express();

app.use(express.json({ limit: '20mb' }));
app.use('/uploads', express.static(uploadsDir));

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: isAuthenticatedRequest(req) });
});

app.post('/api/admin/login', (req, res) => {
  const username = toText(req.body?.username);
  const password = toText(req.body?.password);

  if (username !== adminUsername || password !== adminPassword) {
    res.status(401).json({ message: 'Credenciais invalidas.' });
    return;
  }

  res.cookie(adminCookieName, createSessionToken(username), {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: sessionMaxAgeSeconds * 1000,
    path: '/',
  });

  res.json({ authenticated: true });
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie(adminCookieName, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });
  res.json({ authenticated: false });
});

app.get('/api/site-content', async (_req, res) => {
  const siteContent = await readSiteContent();
  res.json({ siteContent });
});

app.get('/api/health', async (_req, res) => {
  const siteContent = await readSiteContent();

  res.json({
    ok: true,
    botEnabled: telegramBotToken.length > 0,
    paymentEnabled: syncPayClient.enabled && paymentPlans.some((plan) => plan.chargeAmount > 0),
    inviteDeliveryMode: telegramPrivateGroupChatId ? 'private-invite' : 'static-group-link',
    models: siteContent.models.length,
    uploadedHeroBackgrounds:
      siteContent.heroBackgrounds.mobile.length + siteContent.heroBackgrounds.desktop.length,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/payments/syncpay/webhook', async (req, res) => {
  if (!hasValidPaymentSecret(req)) {
    res.status(401).json({ ok: false, message: 'Webhook Syncpay sem segredo valido.' });
    return;
  }

  try {
    const result = await telegramBot.handlePaymentWebhook(req.body ?? {});
    res.json({ ok: true, result });
  } catch (error) {
    console.error('Falha ao processar webhook Syncpay:', error);
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : 'Falha ao processar webhook Syncpay.',
    });
  }
});

app.put('/api/site-content', requireAdminAuth, async (req, res) => {
  const siteContent = await writeSiteContent(req.body);
  res.json({ siteContent });
});

app.get('/api/admin/telegram-cache/warm-all', requireAdminAuth, (req, res) => {
  const jobId = toText(req.query?.jobId);

  if (!jobId) {
    res.status(400).json({ message: 'Informe o jobId do cache do Telegram.' });
    return;
  }

  const status = getTelegramCacheWarmStatus(jobId);

  if (!status) {
    res.status(404).json({ message: 'Job de cache do Telegram nao encontrado.' });
    return;
  }

  res.json({ status });
});

app.post('/api/admin/telegram-cache/warm-all', requireAdminAuth, async (req, res) => {
  const mode = toText(req.body?.mode) === 'check' ? 'check' : 'warm';

  if (mode === 'warm' && !telegramBot.enabled) {
    res.status(400).json({ message: 'Bot Telegram desativado no servidor.' });
    return;
  }

  if (mode === 'warm' && !toText(telegramCacheChatId)) {
    res
      .status(400)
      .json({ message: 'TELEGRAM_CACHE_CHAT_ID nao configurado para o cache do Telegram.' });
    return;
  }

  const runningJob = activeTelegramCacheWarmJobId
    ? getTelegramCacheWarmStatus(activeTelegramCacheWarmJobId)
    : null;

  if (runningJob && runningJob.state === 'running') {
    res.status(202).json({ status: runningJob, reused: true });
    return;
  }

  const jobStatus = createTelegramCacheWarmStatus(`telegram-cache-${randomUUID()}`, mode);
  telegramCacheWarmJobs.set(jobStatus.jobId, jobStatus);
  activeTelegramCacheWarmJobId = jobStatus.jobId;
  void runTelegramCacheWarmJob(jobStatus, telegramBot, readSiteContent);

  res.status(202).json({ status: jobStatus, reused: false });
});

app.post('/api/upload', requireAdminAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).send('Nenhum arquivo recebido.');
    return;
  }

  const uploadedAssetUrl = buildUploadUrlFromPath(path.join(req.file.destination, req.file.filename));
  const uploadedMediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

  res.status(201).json({
    url: uploadedAssetUrl,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });

  if (Number(req.file.size || 0) > getTelegramCacheUploadLimitBytes(uploadedMediaType)) {
    console.warn(
      `Pulando pre-cache automatico de ${req.file.filename}: ${getTelegramCacheTooBigMessage()}`,
    );
    return;
  }

  void telegramBot.warmMediaAsset?.(uploadedAssetUrl, uploadedMediaType).catch((error) => {
    const reason = normalizeTelegramCacheReason(
      error instanceof Error ? error.message : 'cache_failed',
    );
    console.error('Falha ao pre-cachear midia no Telegram:', reason);
  });
});

try {
  await fs.access(distDir);

  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/uploads).*/, (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      next();
      return;
    }

    res.sendFile(path.join(distDir, 'index.html'));
  });
} catch {
  // O dist pode nao existir durante o desenvolvimento.
}

await ensureStorage();
await billingStore.ensureStorage();
const migratedSiteContent = await migrateSiteContentFiles(await readSiteContent());
await writeSiteContent(migratedSiteContent);
await moveLooseRootUploadsToLegacy();

const telegramBot = startTelegramBot({
  token: telegramBotToken,
  readSiteContent,
  siteUrl: sitePublicUrl,
  groupUrl: telegramGroupUrl,
  resolveLocalAssetPath: resolveLocalUploadPath,
  cacheFilePath: telegramFileCachePath,
  billingStore,
  paymentClient: syncPayClient,
  cacheChatId: telegramCacheChatId,
  paymentConfig: {
    simulationEnabled: paymentSimulationEnabled,
    fakePixEnabled: paymentFakePixEnabled,
    plans: paymentPlans,
    defaultPlanId: '30d',
    previewUsageWindowMs,
    pixTtlMs,
    privateGroupChatId: telegramPrivateGroupChatId,
    webhookUrl: syncPayWebhookUrl,
    testCustomer: {
      name: syncPayTestCustomerName,
      email: syncPayTestCustomerEmail,
      cpf: syncPayTestCustomerCpf,
      phone: syncPayTestCustomerPhone,
    },
  },
});

app.listen(port, () => {
  console.log(`AllPrivacy API pronta em http://localhost:${port}`);

  if (telegramBot.enabled) {
    console.log('Bot Telegram iniciado com integracao ao conteudo do site.');

    if (paymentFakePixEnabled) {
      console.log('Modo de Pix falso habilitado para testes locais.');
    }

    if (!paymentFakePixEnabled && syncPayClient.enabled) {
      console.log(
        `Syncpay habilitado para Pix de teste nos planos ${paymentPlans
          .map((plan) => `${plan.id}:${formatCurrencyBRL(plan.chargeAmount)}`)
          .join(' | ')}.`,
      );
    } else if (!paymentFakePixEnabled) {
      console.log('Syncpay desativado. Defina SYNC_PAY_API_KEY para liberar pagamentos.');
    }
  } else {
    console.log(
      'Bot Telegram desativado. Defina TELEGRAM_BOT_TOKEN para ativar a integracao.',
    );
  }
});
