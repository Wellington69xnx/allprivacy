import dotenv from 'dotenv';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { stdin as processInput, stdout as processOutput } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env2', override: true, quiet: true });

const STATE_VERSION = 1;
const STATE_FLUSH_INTERVAL = 25;
const DEFAULT_EXPORT_DIR = 'storage/telegram-exports';
const PROGRESS_LOG_INTERVAL = 100;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value) {
  const numericValue = Number(String(value || '').replace(/[^\d-]+/g, ''));
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function sanitizePathSegment(value, fallbackValue) {
  const normalizedValue = toText(value) || fallbackValue;
  const sanitized = normalizedValue
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || fallbackValue;
}

function sanitizeFilename(filename, fallbackName) {
  const basename = path.basename(toText(filename) || fallbackName);
  return sanitizePathSegment(basename, fallbackName);
}

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercent(value) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return '0.0%';
  }

  return `${normalizedValue.toFixed(1)}%`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  return `${seconds}s`;
}

function toSlug(value, fallbackValue) {
  const sanitized = sanitizePathSegment(value, fallbackValue)
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || fallbackValue;
}

function getDefaultExtensionFromMime(mimeType, fallbackExtension) {
  const normalizedMimeType = toText(mimeType).toLowerCase();

  if (normalizedMimeType === 'image/jpeg') {
    return '.jpg';
  }

  if (normalizedMimeType === 'image/png') {
    return '.png';
  }

  if (normalizedMimeType === 'image/webp') {
    return '.webp';
  }

  if (normalizedMimeType === 'image/gif') {
    return '.gif';
  }

  if (normalizedMimeType === 'video/mp4') {
    return '.mp4';
  }

  if (normalizedMimeType === 'video/webm') {
    return '.webm';
  }

  if (normalizedMimeType === 'video/quicktime') {
    return '.mov';
  }

  if (normalizedMimeType === 'audio/mpeg') {
    return '.mp3';
  }

  if (normalizedMimeType === 'audio/ogg') {
    return '.ogg';
  }

  if (normalizedMimeType === 'audio/mp4') {
    return '.m4a';
  }

  if (normalizedMimeType === 'application/x-tgsticker') {
    return '.tgs';
  }

  const subtype = normalizedMimeType.split('/')[1];

  if (!subtype) {
    return fallbackExtension;
  }

  const normalizedSubtype = subtype.split(';')[0].replace(/[^a-z0-9]+/g, '');
  return normalizedSubtype ? `.${normalizedSubtype}` : fallbackExtension;
}

function formatTimestampForFilename(dateValue) {
  const date =
    dateValue instanceof Date
      ? dateValue
      : Number(dateValue)
        ? new Date(Number(dateValue) * 1000)
        : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function padMessageSequence(value) {
  return String(Math.max(0, Number(value || 0))).padStart(10, '0');
}

function normalizeMessageId(value) {
  const numericValue = Number(String(value || '').replace(/\D+/g, ''));
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function parseTelegramMessageLink(link) {
  const normalizedLink = toText(link).replace(/[),.;!?]+$/, '');

  if (!normalizedLink) {
    return null;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(normalizedLink);
  } catch {
    return null;
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');

  if (!['t.me', 'telegram.me'].includes(hostname)) {
    return null;
  }

  const pathParts = parsedUrl.pathname
    .split('/')
    .map((part) => toText(part))
    .filter(Boolean);

  if (pathParts.length === 0) {
    return null;
  }

  if (pathParts[0] === 'c') {
    const internalChatId = String(pathParts[1] || '').replace(/\D+/g, '');
    const messageId = normalizeMessageId(pathParts[pathParts.length - 1]);

    if (!internalChatId || !messageId) {
      return null;
    }

    return {
      rawLink: normalizedLink,
      fromChatId: `-100${internalChatId}`,
      messageId,
    };
  }

  const usernameOffset = pathParts[0] === 's' ? 1 : 0;
  const username = toText(pathParts[usernameOffset]).replace(/^@/, '');
  const messageId = normalizeMessageId(pathParts[pathParts.length - 1]);

  if (!username || !messageId) {
    return null;
  }

  return {
    rawLink: normalizedLink,
    fromChatId: `@${username}`,
    messageId,
  };
}

function normalizeChatReference(value) {
  const normalizedValue = toText(value);

  if (!normalizedValue) {
    return '';
  }

  const parsedMessageLink = parseTelegramMessageLink(normalizedValue);

  if (parsedMessageLink) {
    return parsedMessageLink.fromChatId;
  }

  let parsedUrl = null;

  try {
    parsedUrl = new URL(normalizedValue);
  } catch {
    parsedUrl = null;
  }

  if (parsedUrl) {
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');

    if (['t.me', 'telegram.me'].includes(hostname)) {
      const pathParts = parsedUrl.pathname
        .split('/')
        .map((part) => toText(part))
        .filter(Boolean);

      if (pathParts[0] === 'c' && pathParts[1]) {
        return `-100${String(pathParts[1]).replace(/\D+/g, '')}`;
      }

      if (pathParts[0] === 'joinchat' || String(pathParts[0] || '').startsWith('+')) {
        return normalizedValue;
      }

      const usernameOffset = pathParts[0] === 's' ? 1 : 0;
      const username = toText(pathParts[usernameOffset]).replace(/^@/, '');

      return username ? `@${username}` : '';
    }
  }

  if (/^-?\d+$/.test(normalizedValue)) {
    return normalizedValue;
  }

  return `@${normalizedValue.replace(/^@/, '')}`;
}

function printUsage() {
  console.log(`Uso:
  npm run telegram:dump -- --chat <@username|-100...|link> [--out <pasta>] [--limit <n>] [--after-id <id>] [--no-resume]
  npm run telegram:dump -- --list-chats

Exemplos:
  npm run telegram:dump -- --chat -1003822454468
  npm run telegram:dump -- --chat https://t.me/c/3822454468/15 --out E:\\MIDIAS\\grupo
  npm run telegram:dump -- --chat @meucanal --out storage\\meu-dump --after-id 1500
  npm run telegram:dump -- --list-chats

Observacoes:
  - A conta principal precisa estar no grupo/canal.
  - O exportador salva estado em disco e continua de onde parou por padrao.
  - Use --no-resume para ignorar o estado salvo daquele chat.`);
}

function parseCliArgs(argv) {
  const options = {
    chat: '',
    out: DEFAULT_EXPORT_DIR,
    limit: 0,
    afterId: 0,
    resume: true,
    help: false,
    listChats: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = toText(argv[index]);

    if (!token) {
      continue;
    }

    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }

    if (token === '--list-chats') {
      options.listChats = true;
      continue;
    }

    if (token === '--resume') {
      options.resume = true;
      continue;
    }

    if (token === '--no-resume') {
      options.resume = false;
      continue;
    }

    if (token === '--chat') {
      options.chat = toText(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--out') {
      options.out = toText(argv[index + 1]) || DEFAULT_EXPORT_DIR;
      index += 1;
      continue;
    }

    if (token === '--limit') {
      options.limit = normalizePositiveInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--after-id') {
      options.afterId = normalizePositiveInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (!token.startsWith('-') && !options.chat) {
      options.chat = token;
      continue;
    }

    throw new Error(`Argumento invalido: ${token}`);
  }

  return options;
}

function buildCleanerUserConfig() {
  const sessionFileEnv = toText(process.env.CLEANER_USER_SESSION_FILE);
  const sessionFilePath = sessionFileEnv
    ? path.isAbsolute(sessionFileEnv)
      ? sessionFileEnv
      : path.join(projectRoot, sessionFileEnv)
    : path.join(storageDir, 'cleaner-user.session');

  return {
    apiId: Number(process.env.CLEANER_USER_API_ID || 0),
    apiHash: toText(process.env.CLEANER_USER_API_HASH),
    phone: toText(process.env.CLEANER_USER_PHONE),
    session: toText(process.env.CLEANER_USER_SESSION),
    sessionFilePath,
  };
}

async function readSessionStringFromDisk(filePath) {
  if (!filePath) {
    return '';
  }

  try {
    return toText(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function writeSessionStringToDisk(filePath, sessionString) {
  const normalizedSessionString = toText(sessionString);

  if (!filePath || !normalizedSessionString) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, normalizedSessionString, 'utf8');
}

function isTerminalInteractive() {
  return Boolean(processInput.isTTY && processOutput.isTTY);
}

async function promptInTerminal(question) {
  if (!isTerminalInteractive()) {
    throw new Error(
      'Nao ha terminal interativo disponivel para autenticar a conta principal. Use /login no cleaner-bot ou rode este comando em um terminal interativo.',
    );
  }

  const readline = createInterface({
    input: processInput,
    output: processOutput,
  });

  try {
    return toText(await readline.question(question));
  } finally {
    readline.close();
  }
}

function normalizeTelegramError(error, fallbackMessage) {
  const explicitMessage =
    toText(error?.errorMessage) ||
    toText(error?.message) ||
    (error instanceof Error ? toText(error.message) : '');

  return explicitMessage || fallbackMessage || 'Falha desconhecida.';
}

function configureTelegramClient(client) {
  client.setLogLevel('none');
  client.onError = async (error) => {
    const reason = normalizeTelegramError(error, 'Falha desconhecida na conta principal.');

    if (reason === 'TIMEOUT') {
      return;
    }

    console.error(`[telegram-export] Erro na conta principal: ${reason}`);
  };
}

async function warmCleanerUserDialogs(client) {
  try {
    await client.getDialogs({ limit: 200 });
  } catch (error) {
    console.error(
      '[telegram-export] Falha ao aquecer dialogs da conta principal:',
      normalizeTelegramError(error, 'Falha desconhecida.'),
    );
  }
}

async function buildAuthorizedClient() {
  const cleanerUserConfig = buildCleanerUserConfig();

  if (!cleanerUserConfig.apiId || !cleanerUserConfig.apiHash) {
    throw new Error('Configure CLEANER_USER_API_ID e CLEANER_USER_API_HASH antes de usar o exportador.');
  }

  const sessionStringFromFile = cleanerUserConfig.sessionFilePath
    ? await readSessionStringFromDisk(cleanerUserConfig.sessionFilePath)
    : '';
  const sessionString = cleanerUserConfig.session || sessionStringFromFile || '';
  const client = new TelegramClient(
    new StringSession(sessionString),
    cleanerUserConfig.apiId,
    cleanerUserConfig.apiHash,
    {
      connectionRetries: 5,
      deviceModel: 'AllPrivacy Uploader',
      systemVersion: 'Windows',
      appVersion: 'AllPrivacy 1.0',
      langCode: 'pt',
      systemLangCode: 'pt-BR',
    },
  );

  configureTelegramClient(client);
  await client.connect();
  let authorized = await client.checkAuthorization();

  if (!authorized) {
    if (!isTerminalInteractive()) {
      throw new Error(
        'A sessao da conta principal ainda nao esta pronta. Use /login no cleaner-bot ou rode este comando em um terminal interativo.',
      );
    }

    await client.start({
      phoneNumber: async () =>
        cleanerUserConfig.phone || (await promptInTerminal('Numero da conta principal com +55: ')),
      phoneCode: async (isCodeViaApp) =>
        await promptInTerminal(
          isCodeViaApp
            ? 'Codigo recebido no app do Telegram: '
            : 'Codigo recebido por SMS/Telegram: ',
        ),
      password: async (hint) =>
        await promptInTerminal(
          hint
            ? `Senha 2FA da conta principal (${hint}): `
            : 'Senha 2FA da conta principal (se existir): ',
        ),
      onError: (error) => {
        console.error(
          '[telegram-export] Falha durante autenticacao:',
          normalizeTelegramError(error, 'Falha desconhecida.'),
        );
      },
    });

    authorized = await client.checkAuthorization();
  }

  if (!authorized) {
    await client.disconnect();
    throw new Error('Nao foi possivel autenticar a conta principal.');
  }

  await warmCleanerUserDialogs(client);
  await writeSessionStringToDisk(cleanerUserConfig.sessionFilePath, client.session.save());

  return client;
}

async function resolveTelegramEntity(client, chatReference) {
  const normalizedReference = toText(chatReference);
  const entityReference =
    normalizedReference.startsWith('@') || normalizedReference.startsWith('http')
      ? normalizedReference
      : Number(normalizedReference);

  try {
    const inputEntity = await client.getInputEntity(entityReference);
    let entity = null;

    try {
      entity = await client.getEntity(inputEntity);
    } catch {
      entity = null;
    }

    return {
      inputEntity,
      entity,
    };
  } catch {
    await warmCleanerUserDialogs(client);
  }

  try {
    const inputEntity = await client.getInputEntity(entityReference);
    let entity = null;

    try {
      entity = await client.getEntity(inputEntity);
    } catch {
      entity = null;
    }

    return {
      inputEntity,
      entity,
    };
  } catch {
    throw new Error(
      `Nao consegui acessar ${normalizedReference}. Confirme se a conta principal esta no grupo/canal e use @username, -100... ou um link de mensagem daquele chat.`,
    );
  }
}

function resolveEntityId(entity) {
  if (!entity) {
    return '';
  }

  if (entity.id != null) {
    return String(entity.id);
  }

  if (entity.channelId != null) {
    return String(entity.channelId);
  }

  if (entity.chatId != null) {
    return String(entity.chatId);
  }

  if (entity.userId != null) {
    return String(entity.userId);
  }

  return '';
}

function resolveEntityTitle(entity, fallbackValue = 'chat') {
  const title = toText(entity?.title);

  if (title) {
    return title;
  }

  const firstName = toText(entity?.firstName);
  const lastName = toText(entity?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  if (fullName) {
    return fullName;
  }

  const username = toText(entity?.username);

  if (username) {
    return `@${username}`;
  }

  return resolveEntityId(entity) || fallbackValue;
}

function resolveEntitySlug(entity, chatReference) {
  const username = toText(entity?.username);

  if (username) {
    return toSlug(username, 'telegram-chat');
  }

  const title = resolveEntityTitle(entity);

  if (title) {
    return toSlug(title, 'telegram-chat');
  }

  return toSlug(chatReference, 'telegram-chat');
}

function hasDownloadableMedia(message) {
  if (!message?.media) {
    return false;
  }

  if (String(message.media?.className || '').includes('WebPage')) {
    return false;
  }

  return Boolean(
    message.photo ||
      message.document ||
      message.video ||
      message.audio ||
      message.voice ||
      message.videoNote ||
      message.gif ||
      message.sticker,
  );
}

function resolveMediaBucket(message) {
  if (message.photo) {
    return 'posts';
  }

  if (message.video) {
    return 'posts';
  }

  if (message.videoNote) {
    return 'video-notes';
  }

  if (message.voice) {
    return 'voices';
  }

  if (message.audio) {
    return 'audios';
  }

  if (message.gif) {
    return 'animations';
  }

  if (message.sticker) {
    return 'stickers';
  }

  if (message.document) {
    return 'documents';
  }

  return 'files';
}

function resolveMimeTypeForMessage(message, mediaBucket) {
  const fileMimeType = toText(message.file?.mimeType);

  if (fileMimeType) {
    return fileMimeType;
  }

  if (message.photo) {
    return 'image/jpeg';
  }

  if (message.video || mediaBucket === 'video-notes' || mediaBucket === 'animations') {
    return 'video/mp4';
  }

  if (mediaBucket === 'voices') {
    return 'audio/ogg';
  }

  if (mediaBucket === 'audios') {
    return 'audio/mpeg';
  }

  if (mediaBucket === 'stickers') {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

function resolveOutputFilePath(chatDir, message) {
  const mediaBucket = resolveMediaBucket(message);
  const mimeType = resolveMimeTypeForMessage(message, mediaBucket);
  const providedFileName = toText(message.file?.name);
  const providedExtension = path.extname(providedFileName);
  const fallbackExtension =
    message.photo
      ? '.jpg'
      : message.video || mediaBucket === 'video-notes' || mediaBucket === 'animations'
        ? '.mp4'
        : mediaBucket === 'audios'
          ? '.mp3'
          : mediaBucket === 'voices'
            ? '.ogg'
            : mediaBucket === 'stickers'
              ? '.webp'
              : '.bin';
  const extension =
    providedExtension || getDefaultExtensionFromMime(mimeType, fallbackExtension);
  const datePart = formatTimestampForFilename(message.date);
  const messageOrderPart = padMessageSequence(message.id);
  const groupedPart = message.groupedId ? `_g${String(message.groupedId)}` : '';
  const originalStem = providedFileName
    ? `_${toSlug(path.basename(providedFileName, providedExtension), 'arquivo').slice(0, 80)}`
    : '';
  const filename = `${datePart}_m${messageOrderPart}${groupedPart}${originalStem}${extension.toLowerCase()}`;

  return {
    mediaBucket,
    mimeType,
    filePath: path.join(chatDir, 'media', mediaBucket, sanitizeFilename(filename, filename)),
    originalFileName: providedFileName,
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const rawValue = await fs.readFile(filePath, 'utf8');
    return JSON.parse(rawValue);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonLine(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function buildDefaultState(chatReference, entity, chatDir) {
  return {
    version: STATE_VERSION,
    chatReference,
    chatId: resolveEntityId(entity),
    chatTitle: resolveEntityTitle(entity, chatReference),
    chatDir,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastProcessedMessageId: 0,
    estimatedTotalMessages: 0,
    scannedMessages: 0,
    downloadedFiles: 0,
    skippedMessages: 0,
    skippedExistingFiles: 0,
    failedMessages: 0,
    pendingFailedMessageIds: [],
  };
}

function normalizeLoadedState(loadedState, chatReference, entity, chatDir) {
  const fallbackState = buildDefaultState(chatReference, entity, chatDir);

  if (!loadedState || typeof loadedState !== 'object') {
    return fallbackState;
  }

  return {
    ...fallbackState,
    ...loadedState,
    version: STATE_VERSION,
    chatReference,
    chatId: resolveEntityId(entity),
    chatTitle: resolveEntityTitle(entity, chatReference),
    chatDir,
    lastProcessedMessageId: normalizePositiveInteger(loadedState.lastProcessedMessageId),
    estimatedTotalMessages: normalizePositiveInteger(loadedState.estimatedTotalMessages),
    scannedMessages: normalizePositiveInteger(loadedState.scannedMessages),
    downloadedFiles: normalizePositiveInteger(loadedState.downloadedFiles),
    skippedMessages: normalizePositiveInteger(loadedState.skippedMessages),
    skippedExistingFiles: normalizePositiveInteger(loadedState.skippedExistingFiles),
    failedMessages: normalizePositiveInteger(loadedState.failedMessages),
    pendingFailedMessageIds: Array.from(
      new Set(
        Array.isArray(loadedState.pendingFailedMessageIds)
          ? loadedState.pendingFailedMessageIds
              .map((value) => normalizePositiveInteger(value))
              .filter(Boolean)
          : [],
      ),
    ),
  };
}

async function addFailedMessageId(state, messageId) {
  const normalizedMessageId = normalizePositiveInteger(messageId);

  if (!normalizedMessageId || state.pendingFailedMessageIds.includes(normalizedMessageId)) {
    return;
  }

  state.pendingFailedMessageIds.push(normalizedMessageId);
}

async function removeFailedMessageId(state, messageId) {
  const normalizedMessageId = normalizePositiveInteger(messageId);

  if (!normalizedMessageId) {
    return;
  }

  state.pendingFailedMessageIds = state.pendingFailedMessageIds.filter(
    (value) => value !== normalizedMessageId,
  );
}

async function saveState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  await writeJsonFile(statePath, state);
}

async function writeChatInfo(infoPath, chatReference, entity, state) {
  await writeJsonFile(infoPath, {
    version: STATE_VERSION,
    chatReference,
    chatId: resolveEntityId(entity),
    chatTitle: resolveEntityTitle(entity, chatReference),
    chatUsername: toText(entity?.username),
    exportedAt: new Date().toISOString(),
    estimatedTotalMessages: state.estimatedTotalMessages,
    scannedMessages: state.scannedMessages,
    downloadedFiles: state.downloadedFiles,
    lastProcessedMessageId: state.lastProcessedMessageId,
  });
}

async function estimateTotalMessages(client, entity) {
  const messages = await client.getMessages(entity, { limit: 1 });
  const totalMessages = Number(messages?.total || messages?.length || 0);
  return Number.isFinite(totalMessages) && totalMessages > 0 ? totalMessages : 0;
}

function buildProgressSnapshot(state, progressRuntime) {
  const elapsedMs = Math.max(0, Date.now() - progressRuntime.startedAtMs);
  const processedThisRun = Math.max(0, state.scannedMessages - progressRuntime.startScannedMessages);
  const scanRatePerSecond = elapsedMs > 0 ? processedThisRun / (elapsedMs / 1000) : 0;
  const estimatedTotalMessages = Math.max(
    Number(progressRuntime.estimatedTotalMessages || 0),
    Number(state.estimatedTotalMessages || 0),
    Number(state.scannedMessages || 0),
  );
  const scannedMessages = Number(state.scannedMessages || 0);
  const completionRatio =
    estimatedTotalMessages > 0 ? Math.min(scannedMessages / estimatedTotalMessages, 1) : 0;
  const remainingMessages = Math.max(estimatedTotalMessages - scannedMessages, 0);
  const etaMs =
    scanRatePerSecond > 0 && remainingMessages > 0
      ? (remainingMessages / scanRatePerSecond) * 1000
      : 0;

  return {
    elapsedMs,
    processedThisRun,
    scanRatePerSecond,
    estimatedTotalMessages,
    scannedMessages,
    remainingMessages,
    completionRatio,
    etaMs,
  };
}

function logProgress(state, progressRuntime, label = 'Progresso') {
  const snapshot = buildProgressSnapshot(state, progressRuntime);
  const percentLabel =
    snapshot.estimatedTotalMessages > 0 ? formatPercent(snapshot.completionRatio * 100) : 'estimando';
  const totalLabel =
    snapshot.estimatedTotalMessages > 0 ? formatInteger(snapshot.estimatedTotalMessages) : '?';
  const etaLabel =
    snapshot.etaMs > 0 ? formatDuration(snapshot.etaMs) : snapshot.remainingMessages > 0 ? 'calculando' : '0s';

  console.log(
    `[telegram-export] ${label} | ${percentLabel} | varridas: ${formatInteger(
      snapshot.scannedMessages,
    )}/${totalLabel} | baixadas: ${formatInteger(state.downloadedFiles)} | sem midia: ${formatInteger(
      state.skippedMessages,
    )} | ja existiam: ${formatInteger(state.skippedExistingFiles)} | falhas pendentes: ${formatInteger(
      state.pendingFailedMessageIds.length,
    )} | tempo: ${formatDuration(snapshot.elapsedMs)} | restante est.: ${formatInteger(
      snapshot.remainingMessages,
    )} msgs | ETA: ${etaLabel}`,
  );
}

function buildManifestEntry(message, outputFilePath, mediaBucket, mimeType, originalFileName) {
  return {
    messageId: Number(message.id || 0),
    groupedId: message.groupedId ? String(message.groupedId) : '',
    date:
      message.date instanceof Date
        ? message.date.toISOString()
        : new Date(Number(message.date || 0) * 1000).toISOString(),
    mediaBucket,
    mimeType,
    originalFileName,
    caption: toText(message.message),
    relativePath: path.relative(projectRoot, outputFilePath),
    size: Number(message.file?.size || 0) || 0,
  };
}

async function fetchMessagesByIds(client, entity, ids) {
  const validIds = Array.from(
    new Set(
      ids
        .map((id) => normalizePositiveInteger(id))
        .filter(Boolean),
    ),
  );

  if (validIds.length === 0) {
    return [];
  }

  const messages = await client.getMessages(entity, { ids: validIds });
  return Array.isArray(messages) ? messages.filter(Boolean) : messages ? [messages] : [];
}

async function downloadMessageMedia(message, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const result = await message.downloadMedia({
    outputFile: destinationPath,
  });

  if (!result) {
    throw new Error('O Telegram nao retornou arquivo para esta mensagem.');
  }
}

async function processDownloadForMessage({
  message,
  state,
  statePath,
  manifestPath,
  chatDir,
  counters,
  progressRuntime,
}) {
  const messageId = Number(message.id || 0);

  if (!messageId) {
    return;
  }

  if (!hasDownloadableMedia(message)) {
    state.skippedMessages += 1;
    state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, messageId);
    counters.processedSinceFlush += 1;
    return;
  }

  const { mediaBucket, mimeType, filePath, originalFileName } = resolveOutputFilePath(chatDir, message);
  const alreadyExists = await pathExists(filePath);

  if (alreadyExists) {
    state.skippedExistingFiles += 1;
    state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, messageId);
    await removeFailedMessageId(state, messageId);
    counters.processedSinceFlush += 1;
    console.log(`[telegram-export] Ja existe: ${path.relative(projectRoot, filePath)}`);
    return;
  }

  try {
    const snapshot = progressRuntime ? buildProgressSnapshot(state, progressRuntime) : null;
    const percentPrefix =
      snapshot && snapshot.estimatedTotalMessages > 0
        ? `${formatPercent(snapshot.completionRatio * 100)} | ${formatInteger(
            snapshot.scannedMessages,
          )}/${formatInteger(snapshot.estimatedTotalMessages)}`
        : `${formatInteger(state.scannedMessages)} msgs`;
    console.log(
      `[telegram-export] [${percentPrefix}] Baixando msg ${messageId} -> ${path.relative(
        projectRoot,
        filePath,
      )}`,
    );
    await downloadMessageMedia(message, filePath);
    state.downloadedFiles += 1;
    state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, messageId);
    await removeFailedMessageId(state, messageId);
    await appendJsonLine(
      manifestPath,
      buildManifestEntry(message, filePath, mediaBucket, mimeType, originalFileName),
    );
    counters.processedSinceFlush += 1;
  } catch (error) {
    state.failedMessages += 1;
    state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, messageId);
    await addFailedMessageId(state, messageId);
    counters.processedSinceFlush += 1;
    console.error(
      `[telegram-export] Falha ao baixar msg ${messageId}: ${normalizeTelegramError(
        error,
        'Falha desconhecida.',
      )}`,
    );
  }

  if (counters.processedSinceFlush >= STATE_FLUSH_INTERVAL) {
    counters.processedSinceFlush = 0;
    await saveState(statePath, state);
  }
}

async function retryPendingFailedMessages(client, entity, state, statePath, manifestPath, chatDir) {
  if (!Array.isArray(state.pendingFailedMessageIds) || state.pendingFailedMessageIds.length === 0) {
    return;
  }

  console.log(
    `[telegram-export] Retomando ${state.pendingFailedMessageIds.length} mensagem(ns) que falharam antes...`,
  );

  const pendingIds = [...state.pendingFailedMessageIds];
  const messages = await fetchMessagesByIds(client, entity, pendingIds);
  const foundMessageIds = new Set(messages.map((message) => Number(message.id || 0)).filter(Boolean));
  const counters = { processedSinceFlush: 0 };

  for (const pendingId of pendingIds) {
    if (!foundMessageIds.has(pendingId)) {
      console.error(
        `[telegram-export] Nao encontrei mais a msg ${pendingId} para tentar de novo. Vou remover da fila pendente.`,
      );
      await removeFailedMessageId(state, pendingId);
      counters.processedSinceFlush += 1;
    }
  }

  messages.sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

  for (const message of messages) {
    await processDownloadForMessage({
      message,
      state,
      statePath,
      manifestPath,
      chatDir,
      counters,
      progressRuntime: null,
    });
  }

  await saveState(statePath, state);
}

async function listAccessibleChats(client) {
  const dialogs = await client.getDialogs({ limit: 500 });

  if (!Array.isArray(dialogs) || dialogs.length === 0) {
    console.log('[telegram-export] Nenhum dialogo acessivel foi encontrado nessa conta.');
    return;
  }

  console.log('[telegram-export] Dialogos acessiveis pela conta principal:');

  for (const dialog of dialogs) {
    const entity = dialog?.entity;
    const title = resolveEntityTitle(entity, 'chat-sem-titulo');
    const username = toText(entity?.username);
    const numericId = resolveEntityId(entity);
    const preferredReference = username ? `@${username}` : numericId || 'sem-id';

    console.log(`${preferredReference}\t${title}`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }
  let client = null;

  try {
    client = await buildAuthorizedClient();

    if (options.listChats) {
      await listAccessibleChats(client);
      return;
    }

    const chatReference = normalizeChatReference(options.chat);

    if (!chatReference) {
      printUsage();
      throw new Error('Informe o chat com --chat.');
    }

    const exportRoot = path.resolve(projectRoot, toText(options.out) || DEFAULT_EXPORT_DIR);
    const resolvedEntity = await resolveTelegramEntity(client, chatReference);
    const entityMetadata = resolvedEntity.entity || resolvedEntity.inputEntity;
    const chatSlug = resolveEntitySlug(entityMetadata, chatReference);
    const chatDir = path.join(exportRoot, chatSlug);
    const statePath = path.join(chatDir, '.export-state.json');
    const infoPath = path.join(chatDir, 'chat-info.json');
    const manifestPath = path.join(chatDir, 'manifest.jsonl');
    const loadedState = options.resume ? await readJsonFile(statePath, null) : null;
    const state = normalizeLoadedState(loadedState, chatReference, entityMetadata, chatDir);
    const startAfterId = Math.max(options.afterId, options.resume ? state.lastProcessedMessageId : 0);
    const counters = { processedSinceFlush: 0 };
    const estimatedTotalMessages = await estimateTotalMessages(client, resolvedEntity.inputEntity);
    const progressRuntime = {
      startedAtMs: Date.now(),
      startScannedMessages: state.scannedMessages,
      estimatedTotalMessages,
    };

    if (estimatedTotalMessages > 0) {
      state.estimatedTotalMessages = Math.max(state.estimatedTotalMessages, estimatedTotalMessages);
    }

    await fs.mkdir(chatDir, { recursive: true });
    await writeChatInfo(infoPath, chatReference, entityMetadata, state);

    console.log(`[telegram-export] Chat: ${resolveEntityTitle(entityMetadata, chatReference)}`);
    console.log(`[telegram-export] Referencia: ${chatReference}`);
    console.log(`[telegram-export] Pasta de destino: ${chatDir}`);
    console.log(
      `[telegram-export] Total estimado de mensagens no chat: ${estimatedTotalMessages > 0 ? formatInteger(estimatedTotalMessages) : 'nao consegui estimar'}`,
    );
    console.log(
      `[telegram-export] Retomada: ${options.resume ? 'sim' : 'nao'} | ultimo ID processado: ${state.lastProcessedMessageId}`,
    );
    logProgress(state, progressRuntime, 'Status inicial');

    await retryPendingFailedMessages(
      client,
      resolvedEntity.inputEntity,
      state,
      statePath,
      manifestPath,
      chatDir,
    );

    const iterOptions = {
      reverse: true,
      minId: startAfterId,
      ...(options.limit > 0 ? { limit: options.limit } : {}),
    };

    for await (const message of client.iterMessages(resolvedEntity.inputEntity, iterOptions)) {
      state.scannedMessages += 1;

      await processDownloadForMessage({
        message,
        state,
        statePath,
        manifestPath,
        chatDir,
        counters,
        progressRuntime,
      });

      const processedThisRun = state.scannedMessages - progressRuntime.startScannedMessages;

      if (processedThisRun > 0 && processedThisRun % PROGRESS_LOG_INTERVAL === 0) {
        logProgress(state, progressRuntime);
      }
    }

    await saveState(statePath, state);
    await writeChatInfo(infoPath, chatReference, entityMetadata, state);

    logProgress(state, progressRuntime, 'Status final');
    console.log('[telegram-export] Exportacao concluida.');
    console.log(`[telegram-export] Arquivos baixados: ${state.downloadedFiles}`);
    console.log(`[telegram-export] Mensagens sem midia: ${state.skippedMessages}`);
    console.log(`[telegram-export] Arquivos ja existentes: ${state.skippedExistingFiles}`);
    console.log(`[telegram-export] Falhas pendentes: ${state.pendingFailedMessageIds.length}`);
  } finally {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  }
}

await main().catch((error) => {
  console.error(
    `[telegram-export] ${normalizeTelegramError(error, 'Falha desconhecida no exportador.')}`,
  );
  process.exitCode = 1;
});
