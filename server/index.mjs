import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');
const uploadsDir = path.join(storageDir, 'uploads');
const siteContentPath = path.join(storageDir, 'site-content.json');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 3001);
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

app.put('/api/site-content', requireAdminAuth, async (req, res) => {
  const siteContent = await writeSiteContent(req.body);
  res.json({ siteContent });
});

app.post('/api/upload', requireAdminAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).send('Nenhum arquivo recebido.');
    return;
  }

  res.status(201).json({
    url: buildUploadUrlFromPath(path.join(req.file.destination, req.file.filename)),
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
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
const migratedSiteContent = await migrateSiteContentFiles(await readSiteContent());
await writeSiteContent(migratedSiteContent);
await moveLooseRootUploadsToLegacy();

app.listen(port, () => {
  console.log(`AllPrivacy API pronta em http://localhost:${port}`);
});
