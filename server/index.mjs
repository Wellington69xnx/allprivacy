import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBillingStore } from './billing-store.mjs';
import { createSyncPayClient } from './syncpay-client.mjs';
import { startTelegramBot } from './telegram-bot.mjs';
import { startCleanerBot } from './cleaner-bot.mjs';

const cleanerBotToken = process.env.CLEANER_BOT_TOKEN || '8399490615:AAGgWRT65BBjaou5ff4R5Qm2BMKzZ_k4q34';
const cleanerBotAdminIds = [8018785433, 7228335041];

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
const host = process.env.HOST || '0.0.0.0';
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
const pixTtlSeconds = Number(process.env.PIX_TTL_SECONDS || 8 * 60);
const pixTtlMs = Math.max(60, pixTtlSeconds) * 1000;
const pixReminderSeconds = Number(process.env.PIX_REMINDER_SECONDS || 4 * 60);
const pixReminderMs = Math.max(0, pixReminderSeconds) * 1000;
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
const adminPassword = '1234';
const authSecret = process.env.ADMIN_AUTH_SECRET || 'allprivacy-admin-local-secret';
const sessionMaxAgeSeconds = 60 * 60 * 12;
const uploadPlanKey = Symbol('allprivacy-upload-plan');
const fullContentCommentRateLimitWindowMs = 10 * 60 * 1000;
const fullContentCommentRateLimitMax = 5;
const fullContentCommentRateLimitStore = new Map();

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

function createRouteToken() {
  return randomUUID().replace(/-/g, '').slice(0, 12).toLowerCase();
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

function getRequestIpAddress(req) {
  const forwardedForHeader = req.headers['x-forwarded-for'];
  const forwardedFor = Array.isArray(forwardedForHeader)
    ? forwardedForHeader[0]
    : toText(forwardedForHeader);
  const firstForwardedIp = forwardedFor.split(',')[0]?.trim();
  return toText(req.ip) || toText(firstForwardedIp) || 'unknown';
}

function consumeFullContentCommentRateLimit(req) {
  const key = getRequestIpAddress(req);
  const now = Date.now();
  const currentEntries = (fullContentCommentRateLimitStore.get(key) || []).filter(
    (timestamp) => now - timestamp < fullContentCommentRateLimitWindowMs,
  );

  if (currentEntries.length >= fullContentCommentRateLimitMax) {
    const retryAt = currentEntries[0] + fullContentCommentRateLimitWindowMs;
    return {
      allowed: false,
      retryAfterMs: Math.max(0, retryAt - now),
    };
  }

  currentEntries.push(now);
  fullContentCommentRateLimitStore.set(key, currentEntries);

  if (fullContentCommentRateLimitStore.size > 3000) {
    for (const [entryKey, timestamps] of fullContentCommentRateLimitStore.entries()) {
      const nextTimestamps = timestamps.filter(
        (timestamp) => now - timestamp < fullContentCommentRateLimitWindowMs,
      );

      if (nextTimestamps.length === 0) {
        fullContentCommentRateLimitStore.delete(entryKey);
      } else {
        fullContentCommentRateLimitStore.set(entryKey, nextTimestamps);
      }
    }
  }

  return {
    allowed: true,
    retryAfterMs: 0,
  };
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

function escapeRegexPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getNextIndexedFilename(directory, baseFilename, extension, preferBareFirst = false) {
  let entries = [];

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw error;
    }
  }

  const normalizedBase = baseFilename.toLowerCase();
  const numberedPattern = new RegExp(
    `^${escapeRegexPattern(normalizedBase)} (\\d+)(?: \\d+)?$`,
  );
  let bareExists = false;
  let highestIndex = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const normalizedName = path.parse(entry.name).name.toLowerCase();

    if (normalizedName === normalizedBase) {
      bareExists = true;
      highestIndex = Math.max(highestIndex, 1);
      continue;
    }

    const match = normalizedName.match(numberedPattern);

    if (match) {
      highestIndex = Math.max(highestIndex, Number(match[1] || 0));
    }
  }

  if (preferBareFirst && !bareExists && highestIndex === 0) {
    return `${baseFilename}${extension}`;
  }

  return `${baseFilename} ${Math.max(1, highestIndex + 1)}${extension}`;
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
    trimStartSeconds:
      toText(query.trimStartSeconds) ||
      toText(req.headers['x-upload-trim-start-seconds']) ||
      toText(req.body?.trimStartSeconds),
    trimEndSeconds:
      toText(query.trimEndSeconds) ||
      toText(req.headers['x-upload-trim-end-seconds']) ||
      toText(req.body?.trimEndSeconds),
  };
}

function parseTrimSeconds(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, parsed);
}

function normalizeUploadTrimMeta(meta, mediaType) {
  if (mediaType !== 'video') {
    return null;
  }

  const startSeconds = parseTrimSeconds(meta?.trimStartSeconds);
  const endSeconds = parseTrimSeconds(meta?.trimEndSeconds);

  if (startSeconds === null && endSeconds === null) {
    return null;
  }

  const normalizedStartSeconds = startSeconds ?? 0;

  if (endSeconds === null || endSeconds <= normalizedStartSeconds + 0.05) {
    return null;
  }

  return {
    startSeconds: normalizedStartSeconds,
    endSeconds,
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
  const trimMeta = normalizeUploadTrimMeta(meta, mediaType);
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
  } else if (bucket === 'model-full-video') {
    directory = path.join(uploadsDir, 'full-content', modelFolder);
    baseFilename = `${modelDisplayName} conteudo completo`;
  } else if (bucket === 'hero-background') {
    directory = path.join(uploadsDir, 'hero-backgrounds', target);
    baseFilename = `background ${target}`;
  } else if (bucket === 'group-proof') {
    directory = path.join(uploadsDir, 'group-proofs');
    baseFilename = 'print grupo';
  }

  await fs.mkdir(directory, { recursive: true });

  const extension = trimMeta ? '.mp4' : resolveExtension(file.originalname, file.mimetype);
  const filename = await getNextIndexedFilename(
    directory,
    baseFilename,
    extension,
    bucket === 'model-profile' || bucket === 'model-cover',
  );

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

async function runFfmpeg(args) {
  await new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    process.on('error', (error) => {
      reject(error);
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(
        new Error(
          stderr.trim() || `Falha ao processar o video com ffmpeg (codigo ${String(code)}).`,
        ),
      );
    });
  });
}

async function trimUploadedVideo(filePath, trimMeta) {
  const clipDuration = Math.max(0.1, trimMeta.endSeconds - trimMeta.startSeconds);
  const parsedPath = path.parse(filePath);
  const tempOutputPath = path.join(parsedPath.dir, `${parsedPath.name}.trim-${randomUUID()}.mp4`);

  try {
    await runFfmpeg([
      '-y',
      '-i',
      filePath,
      '-ss',
      trimMeta.startSeconds.toFixed(3),
      '-t',
      clipDuration.toFixed(3),
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-pix_fmt',
      'yuv420p',
      tempOutputPath,
    ]);

    await fs.unlink(filePath);
    await fs.rename(tempOutputPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempOutputPath);
    } catch {
      // Ignora limpeza secundaria.
    }

    throw error;
  }
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

function resolveManagedUploadPath(assetUrl) {
  const localPath = resolveLocalUploadPath(assetUrl);

  if (!localPath) {
    return null;
  }

  const resolvedPath = path.resolve(localPath);
  const resolvedUploadsDir = path.resolve(uploadsDir);

  if (
    resolvedPath !== resolvedUploadsDir &&
    !resolvedPath.startsWith(`${resolvedUploadsDir}${path.sep}`)
  ) {
    return null;
  }

  return resolvedPath;
}

async function deleteManagedUploadAssets(assetUrls = []) {
  const managedPaths = new Set();
  let deleted = 0;

  for (const assetUrl of assetUrls) {
    const managedPath = resolveManagedUploadPath(assetUrl);

    if (!managedPath) {
      continue;
    }

    managedPaths.add(managedPath);
    const extension = path.extname(managedPath).toLowerCase();

    if (['.mp4', '.mov', '.webm', '.m4v'].includes(extension)) {
      managedPaths.add(path.join(path.dirname(managedPath), `${path.parse(managedPath).name}.thumb.jpg`));
    }
  }

  for (const managedPath of managedPaths) {
    try {
      await fs.unlink(managedPath);
      deleted += 1;
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  return deleted;
}

function isImageAssetUrl(assetUrl) {
  const extension = path.extname(toText(assetUrl)).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(extension);
}

function buildVideoThumbnailPath(filePath) {
  const parsedPath = path.parse(filePath);
  return path.join(parsedPath.dir, `${parsedPath.name}.thumb.jpg`);
}

async function generateVideoThumbnail(filePath) {
  const parsedPath = path.parse(filePath);
  const tempOutputPath = path.join(parsedPath.dir, `${parsedPath.name}.thumb-${randomUUID()}.jpg`);
  const finalOutputPath = buildVideoThumbnailPath(filePath);

  try {
    await runFfmpeg([
      '-y',
      '-i',
      filePath,
      '-ss',
      '0.000',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '-vf',
      "scale='min(720,iw)':-2",
      tempOutputPath,
    ]);

    try {
      await fs.unlink(finalOutputPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
        throw error;
      }
    }

    await fs.rename(tempOutputPath, finalOutputPath);
    return finalOutputPath;
  } catch (error) {
    try {
      await fs.unlink(tempOutputPath);
    } catch {
      // Ignora limpeza secundaria.
    }

    throw error;
  }
}

async function ensureVideoThumbnailForAsset(assetUrl, currentThumbnailUrl = '', options = {}) {
  const normalizedAssetUrl = toText(assetUrl);
  const normalizedThumbnailUrl = toText(currentThumbnailUrl);
  const managedVideoPath = resolveManagedUploadPath(normalizedAssetUrl);

  if (!managedVideoPath) {
    return {
      thumbnailUrl: normalizedThumbnailUrl || normalizedAssetUrl,
      changed: false,
    };
  }

  const resolvedThumbnailPath =
    normalizedThumbnailUrl && normalizedThumbnailUrl !== normalizedAssetUrl
      ? resolveManagedUploadPath(normalizedThumbnailUrl)
      : null;
  const hasResolvedThumbnailFile = resolvedThumbnailPath
    ? await pathExists(resolvedThumbnailPath)
    : false;
  const shouldRefreshThumbnail =
    Boolean(options?.force) ||
    !normalizedThumbnailUrl ||
    normalizedThumbnailUrl === normalizedAssetUrl ||
    !isImageAssetUrl(normalizedThumbnailUrl) ||
    !hasResolvedThumbnailFile;

  if (!shouldRefreshThumbnail) {
    return {
      thumbnailUrl: normalizedThumbnailUrl,
      changed: false,
    };
  }

  const generatedThumbnailPath = await generateVideoThumbnail(managedVideoPath);
  const nextThumbnailUrl = buildUploadUrlFromPath(generatedThumbnailPath);

  if (
    resolvedThumbnailPath &&
    hasResolvedThumbnailFile &&
    path.resolve(resolvedThumbnailPath) !== path.resolve(generatedThumbnailPath)
  ) {
    try {
      await fs.unlink(resolvedThumbnailPath);
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  return {
    thumbnailUrl: nextThumbnailUrl,
    changed: normalizedThumbnailUrl !== nextThumbnailUrl,
  };
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

  const relativeSourcePath = path.relative(uploadsDir, sourcePath);
  const relativeSegments = relativeSourcePath.split(path.sep).filter(Boolean);
  const firstSegment = relativeSegments[0] || '';

  // Arquivos ja organizados em subpastas nao devem ser "migrados" de novo a cada restart.
  // A migracao aqui existe so para ativos antigos soltos na raiz ou em _legacy-root.
  if (relativeSegments.length > 1 && firstSegment !== '_legacy-root') {
    movedAssets.set(normalizedUrl, normalizedUrl);
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
      fullContentVideos: [],
      gallery: [],
    };

    for (const item of model.fullContentVideos || []) {
      nextModel.fullContentVideos.push({
        ...item,
        videoUrl: await migrateAssetUrl(
          item.videoUrl,
          {
            bucket: 'model-full-video',
            modelName: model.name,
            mediaType: 'video',
          },
          movedAssets,
        ),
      });
    }

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
    favorite: Boolean(item.favorite),
  };
}

function normalizeModelFullContentVideo(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const videoUrl = toText(item.videoUrl);

  if (!videoUrl) {
    return null;
  }

  return {
    id: toText(item.id) || createId('full-content'),
    title: toText(item.title) || `Conteudo completo ${index + 1}`,
    routeToken: toText(item.routeToken) || createRouteToken(),
    videoUrl,
    views: Math.max(0, Number(item.views || 0) || 0),
    comments: Array.isArray(item.comments)
      ? item.comments
          .map((comment, commentIndex) =>
            normalizeModelFullContentComment(comment, commentIndex),
          )
          .filter(Boolean)
      : [],
  };
}

function normalizeModelFullContentComment(item, index = 0) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const name = toText(item.name);
  const message = toText(item.message);

  if (!name || !message) {
    return null;
  }

  const createdAt = toText(item.createdAt) || new Date().toISOString();

  return {
    id: toText(item.id) || createId(`full-comment-${index + 1}`),
    name: name.slice(0, 20),
    message: message.slice(0, 200),
    createdAt,
    likes: Math.max(0, Number(item.likes || 0) || 0),
    likedBy: Array.isArray(item.likedBy)
      ? item.likedBy.map((entry) => toText(entry)).filter(Boolean)
      : [],
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
    hiddenOnHome: Boolean(model.hiddenOnHome),
    accentFrom: toText(model.accentFrom) || accentPair[0],
    accentTo: toText(model.accentTo) || accentPair[1],
    profileImage,
    coverImage,
    fullContentVideos: Array.isArray(model.fullContentVideos)
      ? model.fullContentVideos
          .map((item, itemIndex) => normalizeModelFullContentVideo(item, itemIndex))
          .filter(Boolean)
      : model.fullContentVideo
        ? [normalizeModelFullContentVideo(model.fullContentVideo, 0)].filter(Boolean)
        : [],
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

async function ensureSiteContentVideoThumbnails(siteContent, options = {}) {
  const forcedAssetUrls = new Set(
    Array.isArray(options.forceAssetUrls)
      ? options.forceAssetUrls.map((assetUrl) => toText(assetUrl)).filter(Boolean)
      : [],
  );
  let changed = false;
  const nextContent = {
    ...siteContent,
    models: [],
  };

  for (const model of siteContent.models) {
    const nextGallery = [];

    for (const item of model.gallery) {
      if (item.type !== 'video') {
        nextGallery.push(item);
        continue;
      }

      const ensuredThumbnail = await ensureVideoThumbnailForAsset(item.src, item.thumbnail, {
        force: forcedAssetUrls.has(toText(item.src)),
      });
      const nextThumbnail = toText(ensuredThumbnail.thumbnailUrl) || toText(item.thumbnail) || toText(item.src);

      if (nextThumbnail !== toText(item.thumbnail)) {
        changed = true;
      }

      nextGallery.push({
        ...item,
        thumbnail: nextThumbnail,
      });
    }

    nextContent.models.push({
      ...model,
      gallery: nextGallery,
    });
  }

  return {
    siteContent: changed ? nextContent : siteContent,
    changed,
  };
}

const syncableModelImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const syncableModelVideoExtensions = new Set(['.mp4', '.mov', '.webm', '.m4v']);

function inferModelGalleryMediaType(filename) {
  const normalizedFilename = toText(filename).toLowerCase();

  if (
    normalizedFilename.includes('foto de perfil') ||
    normalizedFilename.includes('foto de capa')
  ) {
    return '';
  }

  const extension = path.extname(normalizedFilename);

  if (syncableModelVideoExtensions.has(extension)) {
    return 'video';
  }

  if (syncableModelImageExtensions.has(extension)) {
    return 'image';
  }

  return '';
}

async function syncSiteContentWithRecentUploads(siteContent, siteContentUpdatedAtMs = 0) {
  let changed = false;
  const nextContent = {
    ...siteContent,
    models: [],
  };

  for (const model of siteContent.models) {
    const modelDirectory = path.join(
      uploadsDir,
      sanitizeFolderSegment(toText(model.name), 'modelo'),
    );

    const referencedAssetUrls = new Set(
      [
        toText(model.profileImage),
        toText(model.coverImage),
        ...(model.fullContentVideos || []).map((item) => toText(item.videoUrl)),
        ...model.gallery.flatMap((item) => [toText(item.thumbnail), toText(item.src)]),
      ].filter(Boolean),
    );
    const nextGallery = [...model.gallery];

    try {
      const entries = await fs.readdir(modelDirectory, { withFileTypes: true });
      const filesWithStats = [];

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const mediaType = inferModelGalleryMediaType(entry.name);

        if (!mediaType) {
          continue;
        }

        const absolutePath = path.join(modelDirectory, entry.name);
        const stats = await fs.stat(absolutePath);

        if (Number(stats.mtimeMs || 0) <= Number(siteContentUpdatedAtMs || 0) + 1000) {
          continue;
        }

        filesWithStats.push({
          entry,
          absolutePath,
          mtimeMs: Number(stats.mtimeMs || 0),
          mediaType,
        });
      }

      filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs);

      let previewIndex = nextGallery.length + 1;

      for (const file of filesWithStats) {
        const assetUrl = buildUploadUrlFromPath(file.absolutePath);

        if (referencedAssetUrls.has(assetUrl)) {
          continue;
        }

        referencedAssetUrls.add(assetUrl);
        changed = true;
        nextGallery.push({
          id: createId('media'),
          type: file.mediaType,
          title: `Previa ${previewIndex}`,
          subtitle: '',
          thumbnail: assetUrl,
          src: file.mediaType === 'video' ? assetUrl : undefined,
        });
        previewIndex += 1;
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
        throw error;
      }
    }

    nextContent.models.push({
      ...model,
      gallery: nextGallery,
    });
  }

  return {
    changed,
    siteContent: nextContent,
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
    const normalized = normalizeSiteContent(JSON.parse(raw));
    const siteContentStats = await fs.stat(siteContentPath);
    const synced = await syncSiteContentWithRecentUploads(
      normalized,
      Number(siteContentStats.mtimeMs || 0),
    );
    const ensuredThumbnails = await ensureSiteContentVideoThumbnails(synced.siteContent);

    if (synced.changed || ensuredThumbnails.changed) {
      await fs.writeFile(
        siteContentPath,
        `${JSON.stringify(ensuredThumbnails.siteContent, null, 2)}\n`,
        'utf8',
      );
      return ensuredThumbnails.siteContent;
    }

    return ensuredThumbnails.siteContent;
  } catch {
    return cloneDefaultSiteContent();
  }
}

async function writeSiteContent(content) {
  await ensureStorage();

  const normalized = normalizeSiteContent(content);
  const ensuredThumbnails = await ensureSiteContentVideoThumbnails(normalized);

  await fs.writeFile(
    siteContentPath,
    `${JSON.stringify(ensuredThumbnails.siteContent, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `[site-content] salvo em disco com ${ensuredThumbnails.siteContent.models.length} modelo(s) e ${ensuredThumbnails.siteContent.models.reduce(
      (total, model) => total + model.gallery.length,
      0,
    )} midia(s).`,
  );

  return ensuredThumbnails.siteContent;
}

async function incrementModelFullContentView(routeToken) {
  const normalizedRouteToken = toText(routeToken).toLowerCase();

  if (!normalizedRouteToken) {
    return null;
  }

  const siteContent = await readSiteContent();
  let matchedPayload = null;

  const nextContent = {
    ...siteContent,
    models: siteContent.models.map((model) => {
      const nextFullContentVideos = (model.fullContentVideos || []).map((item) => {
        if (toText(item.routeToken).toLowerCase() !== normalizedRouteToken) {
          return item;
        }

        const nextViews = Math.max(0, Number(item.views || 0) || 0) + 1;
        matchedPayload = {
          modelId: model.id,
          contentId: item.id,
          views: nextViews,
        };

        return {
          ...item,
          views: nextViews,
        };
      });

      return {
        ...model,
        fullContentVideos: nextFullContentVideos,
      };
    }),
  };

  if (!matchedPayload) {
    return null;
  }

  await writeSiteContent(nextContent);
  return matchedPayload;
}

async function addModelFullContentComment(routeToken, name, message) {
  const normalizedRouteToken = toText(routeToken).toLowerCase();
  const normalizedName = toText(name).trim().slice(0, 20);
  const normalizedMessage = toText(message).trim().slice(0, 200);

  if (!normalizedRouteToken || !normalizedName || !normalizedMessage) {
    return null;
  }

  const nextComment = {
    id: createId('full-comment'),
    name: normalizedName,
    message: normalizedMessage,
    createdAt: new Date().toISOString(),
    likes: 0,
    likedBy: [],
  };

  const siteContent = await readSiteContent();
  let matchedComment = null;

  const nextContent = {
    ...siteContent,
    models: siteContent.models.map((model) => {
      const nextFullContentVideos = (model.fullContentVideos || []).map((item) => {
        if (toText(item.routeToken).toLowerCase() !== normalizedRouteToken) {
          return item;
        }

        matchedComment = nextComment;

        return {
          ...item,
          comments: [...(item.comments || []), nextComment],
        };
      });

      return {
        ...model,
        fullContentVideos: nextFullContentVideos,
      };
    }),
  };

  if (!matchedComment) {
    return null;
  }

  await writeSiteContent(nextContent);
  return matchedComment;
}

function createCommentLikeIdentity(req) {
  const rawIdentity = getRequestIpAddress(req);
  return createHmac('sha256', authSecret).update(rawIdentity).digest('hex').slice(0, 32);
}

async function addLikeToModelFullContentComment(routeToken, commentId, likeIdentity) {
  const normalizedRouteToken = toText(routeToken).toLowerCase();
  const normalizedCommentId = toText(commentId);
  const normalizedLikeIdentity = toText(likeIdentity);

  if (!normalizedRouteToken || !normalizedCommentId || !normalizedLikeIdentity) {
    return null;
  }

  const siteContent = await readSiteContent();
  let matchedComment = null;

  const nextContent = {
    ...siteContent,
    models: siteContent.models.map((model) => {
      const nextFullContentVideos = (model.fullContentVideos || []).map((item) => {
        if (toText(item.routeToken).toLowerCase() !== normalizedRouteToken) {
          return item;
        }

        return {
          ...item,
          comments: (item.comments || []).map((comment) => {
            if (toText(comment.id) !== normalizedCommentId) {
              return comment;
            }

            const likedBy = Array.isArray(comment.likedBy) ? comment.likedBy : [];

            if (likedBy.includes(normalizedLikeIdentity)) {
              const nextComment = {
                ...comment,
                likes: Math.max(0, (Number(comment.likes || 0) || 0) - 1),
                likedBy: likedBy.filter((entry) => entry !== normalizedLikeIdentity),
              };

              matchedComment = {
                ...nextComment,
                liked: false,
              };
              return nextComment;
            }

            const nextComment = {
              ...comment,
              likes: Math.max(0, Number(comment.likes || 0) || 0) + 1,
              likedBy: [...likedBy, normalizedLikeIdentity],
            };

            matchedComment = {
              ...nextComment,
              liked: true,
            };

            return nextComment;
          }),
        };
      });

      return {
        ...model,
        fullContentVideos: nextFullContentVideos,
      };
    }),
  };

  if (!matchedComment) {
    return null;
  }

  await writeSiteContent(nextContent);

  return matchedComment;
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

      addAsset(item.src || item.thumbnail, 'image');
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

async function resolveTelegramCacheAssetResult(telegramBot, asset, mode = 'warm') {
  const assetLabel = getTelegramCacheAssetLabel(asset.assetUrl);
  const precheckError = await getTelegramCacheAssetPrecheckError(asset.assetUrl, asset.mediaType);

  if (precheckError) {
    return {
      ok: false,
      item: {
        id: `item-${randomUUID()}`,
        groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
        assetLabel,
        assetUrl: asset.assetUrl,
        mediaType: asset.mediaType,
        status: 'failed',
        reason: precheckError,
      },
    };
  }

  const result =
    mode === 'check'
      ? await telegramBot.checkMediaAssetCache(asset.assetUrl, asset.mediaType)
      : await telegramBot.warmMediaAsset(asset.assetUrl, asset.mediaType);

  if (!result?.ok) {
    return {
      ok: false,
      item: {
        id: `item-${randomUUID()}`,
        groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
        assetLabel,
        assetUrl: asset.assetUrl,
        mediaType: asset.mediaType,
        status: 'failed',
        reason: normalizeTelegramCacheReason(result?.reason),
      },
    };
  }

  if (result.cached) {
    return {
      ok: true,
      item: {
        id: `item-${randomUUID()}`,
        groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
        assetLabel,
        assetUrl: asset.assetUrl,
        mediaType: asset.mediaType,
        status: 'cached',
      },
    };
  }

  return {
    ok: true,
    item: {
      id: `item-${randomUUID()}`,
      groupLabel: getTelegramCacheAssetGroupLabel(asset.assetUrl),
      assetLabel,
      assetUrl: asset.assetUrl,
      mediaType: asset.mediaType,
      status: mode === 'check' ? 'missing' : 'warmed',
    },
  };
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
        const result = await resolveTelegramCacheAssetResult(telegramBot, asset, jobStatus.mode);
        jobStatus.checked += 1;

        if (!result?.ok) {
          const normalizedReason = normalizeTelegramCacheReason(result?.item?.reason);
          jobStatus.failed += 1;
          jobStatus.failures.push({
            assetUrl: asset.assetUrl,
            mediaType: asset.mediaType,
            reason: normalizedReason,
          });
          jobStatus.items.push({ ...result.item, reason: normalizedReason });
          pushTelegramCacheWarmLog(
            jobStatus,
            'error',
            `Falha em ${assetLabel}: ${normalizedReason}`,
          );
          console.error(`[telegram-cache:${jobStatus.mode}] falha em ${assetLabel}: ${normalizedReason}`);
        } else if (result.item?.status === 'cached') {
          jobStatus.alreadyCached += 1;
          jobStatus.items.push(result.item);
          pushTelegramCacheWarmLog(jobStatus, 'info', `${assetLabel} ja estava em cache.`);
          console.log(`[telegram-cache:${jobStatus.mode}] ${assetLabel} ja estava em cache`);
        } else {
          if (isCheckOnly) {
            jobStatus.items.push(result.item);
            pushTelegramCacheWarmLog(jobStatus, 'info', `${assetLabel} ainda nao esta em cache.`);
            console.log(`[telegram-cache:${jobStatus.mode}] ${assetLabel} ainda nao esta em cache`);
          } else {
            jobStatus.warmed += 1;
            jobStatus.items.push(result.item);
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
app.set('trust proxy', true);

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

app.post('/api/full-content/view', async (req, res) => {
  const routeToken = toText(req.body?.routeToken);

  if (!routeToken) {
    res.status(400).json({ message: 'routeToken obrigatorio.' });
    return;
  }

  const result = await incrementModelFullContentView(routeToken);

  if (!result) {
    res.status(404).json({ message: 'Conteudo completo nao encontrado.' });
    return;
  }

  res.json({ ok: true, ...result });
});

app.post('/api/full-content/comment', async (req, res) => {
  const routeToken = toText(req.body?.routeToken);
  const name = toText(req.body?.name);
  const message = toText(req.body?.message);

  if (!routeToken || !name.trim() || !message.trim()) {
    res.status(400).json({ message: 'Nome, comentario e routeToken sao obrigatorios.' });
    return;
  }

  const rateLimitState = consumeFullContentCommentRateLimit(req);

  if (!rateLimitState.allowed) {
    const retryAfterMinutes = Math.max(
      1,
      Math.ceil(rateLimitState.retryAfterMs / (60 * 1000)),
    );
    res.status(429).json({
      message: `Limite de 5 comentarios a cada 10 minutos atingido. Tente novamente em cerca de ${retryAfterMinutes} minuto(s).`,
    });
    return;
  }

  const comment = await addModelFullContentComment(routeToken, name, message);

  if (!comment) {
    res.status(404).json({ message: 'Conteudo completo nao encontrado.' });
    return;
  }

  res.json({ ok: true, comment });
});

app.post('/api/full-content/comment-like', async (req, res) => {
  const routeToken = toText(req.body?.routeToken);
  const commentId = toText(req.body?.commentId);

  if (!routeToken || !commentId) {
    res.status(400).json({ message: 'routeToken e commentId sao obrigatorios.' });
    return;
  }

  const result = await addLikeToModelFullContentComment(
    routeToken,
    commentId,
    createCommentLikeIdentity(req),
  );

  if (!result) {
    res.status(404).json({ message: 'Comentario nao encontrado.' });
    return;
  }

  res.json({
    ok: true,
    liked: Boolean(result.liked),
    comment: {
      id: result.id,
      name: result.name,
      message: result.message,
      createdAt: result.createdAt,
      likes: Math.max(0, Number(result.likes || 0) || 0),
    },
  });
});

app.post('/api/admin/assets/delete', requireAdminAuth, async (req, res) => {
  const assetUrls = Array.isArray(req.body?.assetUrls) ? req.body.assetUrls : [];
  const normalizedAssetUrls = assetUrls.map((assetUrl) => toText(assetUrl)).filter(Boolean);

  const deleted = await deleteManagedUploadAssets(normalizedAssetUrls);

  res.json({
    ok: true,
    deleted,
  });
});

app.post('/api/admin/video/trim-existing', requireAdminAuth, async (req, res) => {
  const assetUrl = toText(req.body?.assetUrl);
  const trimMeta = normalizeUploadTrimMeta(
    {
      trimStartSeconds: req.body?.trimStartSeconds,
      trimEndSeconds: req.body?.trimEndSeconds,
    },
    'video',
  );

  if (!assetUrl || !trimMeta) {
    res.status(400).json({ message: 'assetUrl, trimStartSeconds e trimEndSeconds sao obrigatorios.' });
    return;
  }

  const managedPath = resolveManagedUploadPath(assetUrl);

  if (!managedPath) {
    res.status(400).json({ message: 'Esse video nao pertence aos uploads locais do projeto.' });
    return;
  }

  try {
    await fs.access(managedPath);
    await trimUploadedVideo(managedPath, trimMeta);
    const ensuredThumbnail = await ensureVideoThumbnailForAsset(assetUrl, '', { force: true });
    const siteContent = await readSiteContent();
    const nextSiteContent = {
      ...siteContent,
      models: siteContent.models.map((model) => ({
        ...model,
        gallery: model.gallery.map((item) =>
          item.type === 'video' && toText(item.src) === assetUrl
            ? {
                ...item,
                thumbnail: ensuredThumbnail.thumbnailUrl || item.thumbnail || assetUrl,
              }
            : item,
        ),
      })),
    };
    await writeSiteContent(nextSiteContent);
    res.json({
      ok: true,
      assetUrl,
      thumbnailUrl: ensuredThumbnail.thumbnailUrl || '',
    });
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : 'Nao foi possivel cortar o video selecionado.',
    });
  }
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

app.post('/api/admin/telegram-cache/warm-one', requireAdminAuth, async (req, res) => {
  const assetUrl = toText(req.body?.assetUrl);
  const mediaType = toText(req.body?.mediaType).toLowerCase() === 'video' ? 'video' : 'image';

  if (!assetUrl) {
    res.status(400).json({ message: 'assetUrl obrigatorio.' });
    return;
  }

  if (!telegramBot.enabled) {
    res.status(400).json({ message: 'Bot Telegram desativado no servidor.' });
    return;
  }

  if (!toText(telegramCacheChatId)) {
    res
      .status(400)
      .json({ message: 'TELEGRAM_CACHE_CHAT_ID nao configurado para o cache do Telegram.' });
    return;
  }

  try {
    const result = await resolveTelegramCacheAssetResult(
      telegramBot,
      { assetUrl, mediaType },
      'warm',
    );

    res.json({
      item: result.item,
      ok: result.ok,
    });
  } catch (error) {
    const reason = normalizeTelegramCacheReason(
      error instanceof Error ? error.message : 'cache_failed',
    );

    res.json({
      ok: false,
      message: reason,
      item: {
        id: `item-${randomUUID()}`,
        groupLabel: getTelegramCacheAssetGroupLabel(assetUrl),
        assetLabel: getTelegramCacheAssetLabel(assetUrl),
        assetUrl,
        mediaType,
        status: 'failed',
        reason,
      },
    });
  }
});

app.post('/api/upload', requireAdminAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).send('Nenhum arquivo recebido.');
    return;
  }

  const uploadMeta = readUploadMeta(req);
  const uploadedMediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  const trimMeta = normalizeUploadTrimMeta(uploadMeta, uploadedMediaType);
  const uploadedFilePath = path.join(req.file.destination, req.file.filename);

  try {
    if (trimMeta) {
      await trimUploadedVideo(uploadedFilePath, trimMeta);
    }
  } catch (error) {
    console.error('[upload] falha ao cortar video:', error);

    try {
      await fs.unlink(uploadedFilePath);
    } catch {
      // Arquivo ja pode ter sido removido.
    }

    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : 'Nao foi possivel cortar o video enviado.',
    });
    return;
  }

  const finalStats = await fs.stat(uploadedFilePath);
  const uploadedAssetUrl = buildUploadUrlFromPath(uploadedFilePath);
  const finalMimeType = trimMeta ? 'video/mp4' : req.file.mimetype;
  let thumbnailUrl = '';

  if (uploadedMediaType === 'video') {
    try {
      const ensuredThumbnail = await ensureVideoThumbnailForAsset(uploadedAssetUrl, '', {
        force: true,
      });
      thumbnailUrl = ensuredThumbnail.thumbnailUrl || '';
    } catch (error) {
      console.error('[upload] falha ao gerar thumbnail do video:', error);

      try {
        await fs.unlink(uploadedFilePath);
      } catch {
        // Arquivo ja pode ter sido removido.
      }

      res.status(500).json({
        message:
          error instanceof Error
            ? error.message
            : 'Nao foi possivel gerar a thumbnail do video enviado.',
      });
      return;
    }
  }

  console.log(
    `[upload] bucket=${toText(uploadMeta.bucket) || 'default'} model=${toText(uploadMeta.modelName) || '-'} file=${req.file.filename} type=${uploadedMediaType} url=${uploadedAssetUrl}`,
  );

  res.status(201).json({
    url: uploadedAssetUrl,
    filename: req.file.filename,
    mimeType: finalMimeType,
    size: finalStats.size,
    thumbnailUrl,
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
    pixReminderMs,
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

app.listen(port, host, () => {
  console.log(`AllPrivacy API pronta em http://localhost:${port} (bind ${host})`);

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

  const cleanerBot = startCleanerBot({ token: cleanerBotToken, adminIds: cleanerBotAdminIds });
  if (cleanerBot.enabled) {
    console.log('Cleaner Bot (remove forward tag) iniciado.');
  } else {
    console.log('Cleaner Bot desativado (sem token).');
  }
});
