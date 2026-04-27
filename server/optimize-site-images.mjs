import 'dotenv/config';
import sharp from 'sharp';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');
const uploadsDir = path.join(storageDir, 'uploads');
const siteContentPath = path.join(storageDir, 'site-content.json');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const deleteOriginals = args.has('--delete-originals');

const supportedImageExtensions = new Set([
  '.avif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
]);

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function resolveUploadPath(assetUrl) {
  const normalizedUrl = toText(assetUrl);

  if (!normalizedUrl.startsWith('/uploads/')) {
    return null;
  }

  const relativePath = decodeURIComponent(normalizedUrl.replace(/^\/uploads\//, ''))
    .split('/')
    .filter(Boolean)
    .join(path.sep);
  const resolvedPath = path.resolve(uploadsDir, relativePath);
  const resolvedUploadsDir = path.resolve(uploadsDir);

  if (
    resolvedPath !== resolvedUploadsDir &&
    !resolvedPath.startsWith(`${resolvedUploadsDir}${path.sep}`)
  ) {
    return null;
  }

  return resolvedPath;
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

function getProfile(kind, target = 'desktop') {
  if (kind === 'model-profile') {
    return {
      maxWidth: 420,
      maxHeight: 420,
      fit: 'cover',
      quality: 78,
    };
  }

  if (kind === 'model-cover') {
    return {
      maxWidth: 1280,
      maxHeight: 900,
      fit: 'inside',
      quality: 80,
    };
  }

  if (kind === 'hero-background') {
    return target === 'mobile'
      ? {
          maxWidth: 1000,
          maxHeight: 1600,
          fit: 'inside',
          quality: 80,
        }
      : {
          maxWidth: 1800,
          maxHeight: 1200,
          fit: 'inside',
          quality: 80,
        };
  }

  if (kind === 'group-proof') {
    return {
      maxWidth: 1400,
      maxHeight: 1400,
      fit: 'inside',
      quality: 82,
    };
  }

  return {
    maxWidth: 1600,
    maxHeight: 1600,
    fit: 'inside',
    quality: 84,
  };
}

function mergeProfiles(usages) {
  if (usages.length === 1) {
    return getProfile(usages[0].kind, usages[0].target);
  }

  const profiles = usages.map((usage) => getProfile(usage.kind, usage.target));

  return {
    maxWidth: Math.max(...profiles.map((profile) => profile.maxWidth)),
    maxHeight: Math.max(...profiles.map((profile) => profile.maxHeight)),
    fit: 'inside',
    quality: Math.max(...profiles.map((profile) => profile.quality)),
  };
}

function hasExceededProfile(metadata, profile) {
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);

  return (
    (profile.maxWidth && width > profile.maxWidth) ||
    (profile.maxHeight && height > profile.maxHeight)
  );
}

function addUsage(tasks, assetUrl, usage) {
  const normalizedUrl = toText(assetUrl);

  if (!normalizedUrl || !normalizedUrl.startsWith('/uploads/')) {
    return;
  }

  if (!tasks.has(normalizedUrl)) {
    tasks.set(normalizedUrl, []);
  }

  tasks.get(normalizedUrl).push(usage);
}

function collectOptimizationTasks(siteContent) {
  const tasks = new Map();

  for (const model of siteContent.models || []) {
    addUsage(tasks, model.profileImage, { kind: 'model-profile' });
    addUsage(tasks, model.coverImage, { kind: 'model-cover' });

    for (const item of model.gallery || []) {
      if (item.thumbnail && item.thumbnail !== item.src) {
        addUsage(tasks, item.thumbnail, { kind: 'model-media' });
      }

      if (item.type === 'image') {
        addUsage(tasks, item.thumbnail || item.src, { kind: 'model-media' });
      }
    }
  }

  for (const item of siteContent.groupProofItems || []) {
    addUsage(tasks, item.image, { kind: 'group-proof' });
  }

  for (const target of ['mobile', 'desktop']) {
    for (const item of siteContent.heroBackgrounds?.[target] || []) {
      addUsage(tasks, item.image, { kind: 'hero-background', target });
    }
  }

  return tasks;
}

function replaceAssetUrls(value, replacements) {
  if (typeof value === 'string') {
    return replacements.get(value) || value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceAssetUrls(item, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceAssetUrls(item, replacements)]),
    );
  }

  return value;
}

async function optimizeImage(assetUrl, usages) {
  const sourcePath = resolveUploadPath(assetUrl);

  if (!sourcePath) {
    return {
      status: 'skipped',
      reason: 'not-local',
      assetUrl,
      originalSize: 0,
      finalSize: 0,
    };
  }

  const extension = path.extname(sourcePath).toLowerCase();

  if (!supportedImageExtensions.has(extension) || extension === '.gif') {
    return {
      status: 'skipped',
      reason: 'unsupported',
      assetUrl,
      originalSize: 0,
      finalSize: 0,
    };
  }

  const originalStats = await fs.stat(sourcePath);
  const originalSize = Number(originalStats.size || 0);
  const profile = mergeProfiles(usages);
  const parsedPath = path.parse(sourcePath);
  const finalPath =
    extension === '.webp'
      ? sourcePath
      : await getUniqueFilePath(parsedPath.dir, `${parsedPath.name}.webp`);
  const tempOutputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}.optimized-${randomUUID()}.webp`,
  );

  try {
    const metadata = await sharp(sourcePath, { failOn: 'none', animated: false }).metadata();
    const dimensionsExceeded = hasExceededProfile(metadata, profile);

    await sharp(sourcePath, { failOn: 'none', animated: false })
      .rotate()
      .resize({
        width: profile.maxWidth,
        height: profile.maxHeight,
        fit: profile.fit,
        withoutEnlargement: true,
      })
      .webp({
        quality: profile.quality,
        effort: 4,
        smartSubsample: true,
      })
      .toFile(tempOutputPath);

    const optimizedStats = await fs.stat(tempOutputPath);
    const optimizedSize = Number(optimizedStats.size || 0);
    const shouldUseOptimized =
      optimizedSize < originalSize || (dimensionsExceeded && optimizedSize <= originalSize * 1.05);

    if (!shouldUseOptimized) {
      await fs.unlink(tempOutputPath);
      return {
        status: 'skipped',
        reason: 'already-small',
        assetUrl,
        originalSize,
        finalSize: originalSize,
      };
    }

    if (!dryRun) {
      if (path.resolve(finalPath) === path.resolve(sourcePath)) {
        await fs.unlink(sourcePath);
      } else if (deleteOriginals) {
        await fs.unlink(sourcePath);
      }

      try {
        await fs.unlink(finalPath);
      } catch (error) {
        if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
          throw error;
        }
      }

      await fs.rename(tempOutputPath, finalPath);
    } else {
      await fs.unlink(tempOutputPath);
    }

    const nextUrl = buildUploadUrlFromPath(finalPath);

    return {
      status: 'optimized',
      assetUrl,
      nextUrl,
      originalSize,
      finalSize: optimizedSize,
    };
  } catch (error) {
    try {
      await fs.unlink(tempOutputPath);
    } catch {
      // Ignora limpeza secundaria.
    }

    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'unknown-error',
      assetUrl,
      originalSize,
      finalSize: originalSize,
    };
  }
}

function formatMb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
}

const siteContent = JSON.parse(await fs.readFile(siteContentPath, 'utf8'));
const tasks = collectOptimizationTasks(siteContent);
const replacements = new Map();
const results = [];

console.log(
  `[site-images] ${dryRun ? 'Simulando' : 'Otimizando'} ${tasks.size} imagem(ns) referenciada(s).`,
);

for (const [assetUrl, usages] of tasks.entries()) {
  const result = await optimizeImage(assetUrl, usages);
  results.push(result);

  if (result.status === 'optimized' && result.nextUrl && result.nextUrl !== assetUrl) {
    replacements.set(assetUrl, result.nextUrl);
  }

  if (result.status === 'optimized') {
    console.log(
      `[site-images] OK ${formatMb(result.originalSize)} -> ${formatMb(result.finalSize)} | ${assetUrl}`,
    );
  } else if (result.status === 'failed') {
    console.log(`[site-images] FALHA ${assetUrl}: ${result.reason}`);
  }
}

if (!dryRun && replacements.size > 0) {
  const nextSiteContent = replaceAssetUrls(siteContent, replacements);
  await fs.writeFile(siteContentPath, `${JSON.stringify(nextSiteContent, null, 2)}\n`, 'utf8');
}

const optimized = results.filter((result) => result.status === 'optimized');
const failed = results.filter((result) => result.status === 'failed');
const originalTotal = results.reduce((total, result) => total + Number(result.originalSize || 0), 0);
const finalTotal = results.reduce((total, result) => total + Number(result.finalSize || 0), 0);

console.log(
  `[site-images] Concluido. Otimizadas: ${optimized.length}. Atualizadas no JSON: ${replacements.size}. Falhas: ${failed.length}.`,
);
console.log(
  `[site-images] Peso referenciado: ${formatMb(originalTotal)} -> ${formatMb(finalTotal)} | economia ${formatMb(Math.max(0, originalTotal - finalTotal))}.`,
);

if (dryRun) {
  console.log('[site-images] Dry-run ativo: nenhum arquivo ou JSON foi alterado.');
}
