import dotenv from 'dotenv';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { stdin as processInput, stdout as processOutput } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env2', override: true, quiet: true });

const STATE_VERSION = 1;
const DEFAULT_DELAY_MS = 1200;
const DEFAULT_BATCH_SIZE = 8;
const MAX_ALBUM_SIZE = 10;
const MEDIA_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.avi',
  '.mkv',
]);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.avi',
  '.mkv',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');
const thumbnailCacheDir = path.join(storageDir, 'telegram-upload-thumbs');

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(milliseconds || 0)));
  });
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function normalizePositiveInteger(value) {
  const numericValue = Number(String(value || '').replace(/[^\d-]+/g, ''));
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeIntegerInRange(value, fallbackValue, minValue, maxValue) {
  const numericValue = normalizePositiveInteger(value);

  if (!numericValue) {
    return fallbackValue;
  }

  return Math.max(minValue, Math.min(maxValue, numericValue));
}

function sanitizePathSegment(value, fallbackValue) {
  const normalizedValue = toText(value) || fallbackValue;
  const sanitized = normalizedValue
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || fallbackValue;
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

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercent(value) {
  const normalized = Number(value || 0);

  if (!Number.isFinite(normalized)) {
    return '0.0%';
  }

  return `${normalized.toFixed(1)}%`;
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

function formatBytes(bytes) {
  const normalizedBytes = Math.max(0, Number(bytes || 0));
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = normalizedBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex >= 3 ? 2 : unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatGigabytes(bytes) {
  const gigabytes = Math.max(0, Number(bytes || 0)) / 1024 / 1024 / 1024;
  return `${gigabytes.toFixed(2)} GB`;
}

function sumFileSizes(files) {
  return files.reduce((total, file) => total + Math.max(0, Number(file?.sizeBytes || 0)), 0);
}

function formatUploadEta(uploadedBytes, remainingBytes, elapsedMs) {
  const normalizedUploadedBytes = Math.max(0, Number(uploadedBytes || 0));
  const normalizedRemainingBytes = Math.max(0, Number(remainingBytes || 0));
  const normalizedElapsedMs = Math.max(0, Number(elapsedMs || 0));

  if (normalizedUploadedBytes <= 0 || normalizedElapsedMs <= 0 || normalizedRemainingBytes <= 0) {
    return 'calculando';
  }

  const bytesPerMs = normalizedUploadedBytes / normalizedElapsedMs;

  if (!Number.isFinite(bytesPerMs) || bytesPerMs <= 0) {
    return 'calculando';
  }

  return formatDuration(normalizedRemainingBytes / bytesPerMs);
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
  npm.cmd run telegram:upload -- --chat <@username|-100...|link> --source <pasta> [opcoes]

Opcoes de topico:
  --topic-top-msg-id <id>   Usa direto o topMsgId do topico
  --topic-id <id>           Resolve topMsgId pelo ID do topico
  --topic-title "<nome>"    Busca/cria topico por titulo
  --topics-by-folder        Cria/usa um topico para cada subpasta de --source
  --list-topics             Lista topicos do chat e sai
  --list-chats              Lista chats acessiveis pela conta principal e sai

Outras opcoes:
  --batch-size <1-10>       Tamanho maximo de lote (padrao: 8)
  --delay-ms <ms>           Pausa entre lotes (padrao: 1200)
  --max-files <n>           Limite de arquivos nesta execucao
  --single-files            Envia cada midia separada, sem album/grade
  --no-video-thumbs         Nao gera thumbnails/metadados para videos
  --dry-run                 Simula sem enviar
  --no-resume               Ignora historico de upload anterior
  --help                    Mostra esta ajuda

Exemplos:
  npm.cmd run telegram:upload -- --chat -1001234567890 --source E:\\MIDIAS\\grupo --topic-title "SR VIP"
  npm.cmd run telegram:upload -- --chat -1001234567890 --source E:\\MIDIAS\\modelos --topics-by-folder
  npm.cmd run telegram:upload -- --chat -1001234567890 --source E:\\MIDIAS\\grupo --list-topics
  npm.cmd run telegram:upload -- --list-chats`);
}

function parseCliArgs(argv) {
  const options = {
    chat: '',
    source: '',
    topicTopMsgId: 0,
    topicId: 0,
    topicTitle: '',
    topicsByFolder: false,
    listChats: false,
    listTopics: false,
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    maxFiles: 0,
    singleFiles: false,
    videoThumbs: true,
    dryRun: false,
    resume: true,
    help: false,
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

    if (token === '--list-topics') {
      options.listTopics = true;
      continue;
    }

    if (token === '--list-chats') {
      options.listChats = true;
      continue;
    }

    if (token === '--topics-by-folder') {
      options.topicsByFolder = true;
      continue;
    }

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token === '--single-files') {
      options.singleFiles = true;
      continue;
    }

    if (token === '--no-video-thumbs') {
      options.videoThumbs = false;
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

    if (token === '--source') {
      options.source = toText(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--topic-top-msg-id') {
      options.topicTopMsgId = normalizePositiveInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--topic-id') {
      options.topicId = normalizePositiveInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--topic-title') {
      options.topicTitle = toText(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--batch-size') {
      options.batchSize = normalizeIntegerInRange(argv[index + 1], DEFAULT_BATCH_SIZE, 1, MAX_ALBUM_SIZE);
      index += 1;
      continue;
    }

    if (token === '--delay-ms') {
      options.delayMs = normalizePositiveInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--max-files') {
      options.maxFiles = normalizePositiveInteger(argv[index + 1]);
      index += 1;
      continue;
    }

    if (!token.startsWith('-') && !options.chat) {
      options.chat = token;
      continue;
    }

    if (!token.startsWith('-') && !options.source) {
      options.source = token;
      continue;
    }

    throw new Error(`Argumento invalido: ${token}`);
  }

  return options;
}

function normalizeTelegramError(error, fallbackMessage) {
  const explicitMessage =
    toText(error?.errorMessage) ||
    toText(error?.message) ||
    (error instanceof Error ? toText(error.message) : '');

  return explicitMessage || fallbackMessage || 'Falha desconhecida.';
}

function parseRetryWaitSeconds(error) {
  const reason = normalizeTelegramError(error, '');
  let match = reason.match(/FLOOD_WAIT_(\d+)/i);

  if (!match) {
    match = reason.match(/SLOWMODE_WAIT_(\d+)/i);
  }

  if (!match) {
    match = reason.match(/A wait of (\d+) seconds/i);
  }

  const seconds = Number(match?.[1] || 0);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : 0;
}

function isSkippableUploadError(error) {
  const reason = normalizeTelegramError(error, '').toUpperCase();

  return [
    'FILE_PARTS_INVALID',
    'VIDEO_CONTENT_TYPE_INVALID',
    'PHOTO_INVALID_DIMENSIONS',
    'PHOTO_EXT_INVALID',
    'MEDIA_INVALID',
  ].some((code) => reason.includes(code));
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
      'Nao ha terminal interativo disponivel para autenticar a conta principal. Use /login no cleaner-bot ou rode em um terminal interativo.',
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

function configureTelegramClient(client) {
  client.setLogLevel('none');
  client.onError = async (error) => {
    const reason = normalizeTelegramError(error, 'Falha desconhecida na conta principal.');

    if (reason === 'TIMEOUT') {
      return;
    }

    console.error(`[telegram-upload] Erro na conta principal: ${reason}`);
  };
}

async function warmCleanerUserDialogs(client) {
  try {
    await client.getDialogs({ limit: 200 });
  } catch (error) {
    console.error(
      '[telegram-upload] Falha ao aquecer dialogs da conta principal:',
      normalizeTelegramError(error, 'Falha desconhecida.'),
    );
  }
}

async function buildAuthorizedClient() {
  const cleanerUserConfig = buildCleanerUserConfig();

  if (!cleanerUserConfig.apiId || !cleanerUserConfig.apiHash) {
    throw new Error('Configure CLEANER_USER_API_ID e CLEANER_USER_API_HASH antes de usar o uploader.');
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
        'A sessao da conta principal ainda nao esta pronta. Use /login no cleaner-bot ou rode em um terminal interativo.',
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
          '[telegram-upload] Falha durante autenticacao:',
          normalizeTelegramError(error, 'Falha desconhecida.'),
        );
      },
    });

    authorized = await client.checkAuthorization();
  }

  if (!authorized) {
    await client.disconnect().catch(() => {});
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
    const entity = await client.getEntity(inputEntity).catch(() => null);
    return { inputEntity, entity };
  } catch {
    throw new Error(
      `Nao consegui acessar ${normalizedReference}. Confirme se a conta principal esta no grupo/canal de destino.`,
    );
  }
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

  return fallbackValue;
}

function normalizeTopicTitle(value) {
  const normalized = sanitizePathSegment(value, '').slice(0, 128);
  return normalized || '';
}

async function listForumTopics(client, inputEntity) {
  const topics = [];
  let offsetDate = 0;
  let offsetId = 0;
  let offsetTopic = 0;
  let hasMore = true;
  let guard = 0;

  while (hasMore && guard < 50) {
    guard += 1;
    let response;

    try {
      response = await client.invoke(
        new Api.channels.GetForumTopics({
          channel: inputEntity,
          offsetDate,
          offsetId,
          offsetTopic,
          limit: 100,
        }),
      );
    } catch (error) {
      const reason = normalizeTelegramError(error, '');

      if (reason === 'CHANNEL_FORUM_MISSING') {
        return [];
      }

      throw error;
    }
    const batch = Array.isArray(response?.topics) ? response.topics : [];

    if (batch.length === 0) {
      break;
    }

    const normalizedTopics = batch.filter((topic) => String(topic?.className || '') === 'ForumTopic');
    topics.push(...normalizedTopics);

    const lastTopic = normalizedTopics[normalizedTopics.length - 1] || batch[batch.length - 1];

    if (!lastTopic) {
      break;
    }

    offsetDate = Number(lastTopic?.date || 0);
    offsetId = Number(lastTopic?.topMessage || 0);
    offsetTopic = Number(lastTopic?.id || 0);
    hasMore = batch.length >= 100;
  }

  return topics;
}

function findTopicById(topics, topicId) {
  const normalizedTopicId = normalizePositiveInteger(topicId);

  if (!normalizedTopicId) {
    return null;
  }

  return topics.find((topic) => Number(topic?.id || 0) === normalizedTopicId) || null;
}

function findTopicByTitle(topics, topicTitle) {
  const normalizedTopicTitle = normalizeTopicTitle(topicTitle).toLowerCase();

  if (!normalizedTopicTitle) {
    return null;
  }

  return (
    topics.find((topic) => normalizeTopicTitle(topic?.title).toLowerCase() === normalizedTopicTitle) || null
  );
}

async function resolveTopicFromTopicId(client, inputEntity, topicId) {
  const normalizedTopicId = normalizePositiveInteger(topicId);

  if (!normalizedTopicId) {
    return null;
  }

  let response;

  try {
    response = await client.invoke(
      new Api.channels.GetForumTopicsByID({
        channel: inputEntity,
        topics: [normalizedTopicId],
      }),
    );
  } catch (error) {
    const reason = normalizeTelegramError(error, '');

    if (reason === 'CHANNEL_FORUM_MISSING') {
      throw new Error('O chat de destino nao usa topicos (forum).');
    }

    throw error;
  }
  const topics = Array.isArray(response?.topics) ? response.topics : [];
  return findTopicById(topics, normalizedTopicId);
}

async function resolveOrCreateTopicTopMessageId(client, inputEntity, topicTitle) {
  const normalizedTitle = normalizeTopicTitle(topicTitle);

  if (!normalizedTitle) {
    return 0;
  }

  const existingTopics = await listForumTopics(client, inputEntity);
  const existingTopic = findTopicByTitle(existingTopics, normalizedTitle);

  if (existingTopic?.topMessage) {
    return Number(existingTopic.topMessage || 0);
  }

  try {
    await client.invoke(
      new Api.channels.CreateForumTopic({
        channel: inputEntity,
        title: normalizedTitle,
      }),
    );
  } catch (error) {
    const reason = normalizeTelegramError(error, '');

    if (reason === 'CHANNEL_FORUM_MISSING') {
      throw new Error('O chat de destino nao usa topicos (forum).');
    }

    throw error;
  }

  await sleep(800);
  const refreshedTopics = await listForumTopics(client, inputEntity);
  const createdTopic = findTopicByTitle(refreshedTopics, normalizedTitle);

  if (!createdTopic?.topMessage) {
    throw new Error(`Criei o topico "${normalizedTitle}", mas nao consegui recuperar o topMsgId.`);
  }

  return Number(createdTopic.topMessage || 0);
}

async function resolveTopicTopMessageId(client, inputEntity, topicScope) {
  if (topicScope.topMsgId > 0) {
    return topicScope.topMsgId;
  }

  if (topicScope.topicId > 0) {
    const topic = await resolveTopicFromTopicId(client, inputEntity, topicScope.topicId);

    if (!topic?.topMessage) {
      throw new Error(`Nao encontrei o topico com ID ${topicScope.topicId}.`);
    }

    return Number(topic.topMessage || 0);
  }

  if (topicScope.title) {
    return await resolveOrCreateTopicTopMessageId(client, inputEntity, topicScope.title);
  }

  return 0;
}

async function listTopicsAndExit(client, inputEntity) {
  const topics = await listForumTopics(client, inputEntity);

  if (topics.length === 0) {
    console.log('[telegram-upload] Nenhum topico encontrado neste chat (ou o chat nao usa topicos).');
    return;
  }

  console.log('[telegram-upload] Topicos encontrados:');

  for (const topic of topics) {
    const topicId = Number(topic?.id || 0);
    const topMessage = Number(topic?.topMessage || 0);
    const title = normalizeTopicTitle(topic?.title) || '(sem titulo)';
    const flags = [
      topic?.pinned ? 'fixado' : '',
      topic?.closed ? 'fechado' : '',
      topic?.hidden ? 'oculto' : '',
    ].filter(Boolean);
    const flagsText = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

    console.log(`- id=${topicId} | topMsgId=${topMessage} | ${title}${flagsText}`);
  }
}

async function listChatsAndExit(client) {
  const dialogs = await client.getDialogs({ limit: 500 });

  if (!Array.isArray(dialogs) || dialogs.length === 0) {
    console.log('[telegram-upload] Nenhum chat acessivel foi encontrado.');
    return;
  }

  console.log('[telegram-upload] Chats acessiveis pela conta principal:');

  for (const dialog of dialogs) {
    const entity = dialog?.entity;
    const username = toText(entity?.username);
    const title = resolveEntityTitle(entity, 'chat-sem-titulo');
    const id =
      entity?.id != null
        ? String(entity.id)
        : entity?.channelId != null
          ? String(entity.channelId)
          : entity?.chatId != null
            ? String(entity.chatId)
            : entity?.userId != null
              ? String(entity.userId)
              : '';
    const preferredReference = username ? `@${username}` : id || 'sem-id';

    console.log(`- ${preferredReference}\t${title}`);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectMediaFilesRecursive(baseDir, rootDir, outputList) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    const absolutePath = path.join(baseDir, entry.name);

    if (entry.isDirectory()) {
      await collectMediaFilesRecursive(absolutePath, rootDir, outputList);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!MEDIA_EXTENSIONS.has(extension)) {
      continue;
    }

    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/');
    const fileStats = await fs.stat(absolutePath);

    if (fileStats.size <= 0) {
      continue;
    }

    const groupedMatch = entry.name.match(/_g(\d+)/i);
    const groupedId = groupedMatch ? String(groupedMatch[1]) : '';
    const mediaKind = VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image';

    outputList.push({
      absolutePath,
      relativePath,
      fileName: entry.name,
      groupedId,
      mediaKind,
      sizeBytes: fileStats.size,
      mtimeMs: Math.round(fileStats.mtimeMs),
    });
  }
}

function extractMediaSortMetadata(file) {
  const fileName = toText(file?.fileName);
  const timestampMatch = fileName.match(/^(\d{8}-\d{6})/);
  const messageMatch = fileName.match(/_m(\d+)/i);
  const groupedMatch = fileName.match(/_g(\d+)/i);

  return {
    timestamp: timestampMatch ? timestampMatch[1] : '',
    messageId: messageMatch ? Number(messageMatch[1]) : 0,
    groupedId: groupedMatch ? groupedMatch[1] : '',
  };
}

function compareMediaByTimeline(left, right) {
  const leftSort = extractMediaSortMetadata(left);
  const rightSort = extractMediaSortMetadata(right);
  const timestampComparison = leftSort.timestamp.localeCompare(rightSort.timestamp);

  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  if (leftSort.messageId !== rightSort.messageId) {
    return leftSort.messageId - rightSort.messageId;
  }

  const groupComparison = leftSort.groupedId.localeCompare(rightSort.groupedId);

  if (groupComparison !== 0) {
    return groupComparison;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

async function collectMediaFiles(sourceDir) {
  const normalizedSource = path.resolve(sourceDir);
  const collectedFiles = [];
  await collectMediaFilesRecursive(normalizedSource, normalizedSource, collectedFiles);
  collectedFiles.sort(compareMediaByTimeline);
  return collectedFiles;
}

async function collectTopicUnits(sourceDir, options) {
  const normalizedSource = path.resolve(sourceDir);

  if (!options.topicsByFolder) {
    const files = await collectMediaFiles(normalizedSource);
    const topicTitle = normalizeTopicTitle(options.topicTitle);

    return [
      {
        name: topicTitle || 'padrao',
        sourceRoot: normalizedSource,
        topicScope: {
          topMsgId: options.topicTopMsgId,
          topicId: options.topicId,
          title: topicTitle,
        },
        files,
      },
    ];
  }

  const entries = await fs.readdir(normalizedSource, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const units = [];

  for (const directory of directories) {
    const subDirPath = path.join(normalizedSource, directory.name);
    const files = await collectMediaFiles(subDirPath);

    if (files.length === 0) {
      continue;
    }

    units.push({
      name: directory.name,
      sourceRoot: subDirPath,
      topicScope: {
        topMsgId: options.topicTopMsgId,
        topicId: options.topicId,
        title: normalizeTopicTitle(directory.name),
      },
      files,
    });
  }

  if (units.length === 0) {
    const fallbackFiles = await collectMediaFiles(normalizedSource);

    return [
      {
        name: 'padrao',
        sourceRoot: normalizedSource,
        topicScope: {
          topMsgId: options.topicTopMsgId,
          topicId: options.topicId,
          title: normalizeTopicTitle(options.topicTitle),
        },
        files: fallbackFiles,
      },
    ];
  }

  return units;
}

async function readUploadedKeySet(uploadLogPath) {
  const uploadedKeys = new Set();

  if (!(await pathExists(uploadLogPath))) {
    return uploadedKeys;
  }

  const rawValue = await fs.readFile(uploadLogPath, 'utf8');
  const lines = rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    try {
      const parsedLine = JSON.parse(line);
      const key = toText(parsedLine?.key);

      if (key) {
        uploadedKeys.add(key);
      }
    } catch {
      // Ignora linhas corrompidas para nao bloquear retomada.
    }
  }

  return uploadedKeys;
}

async function appendJsonLines(filePath, values) {
  const normalizedValues = Array.isArray(values) ? values : [values];

  if (normalizedValues.length === 0) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serializedLines = normalizedValues.map((value) => `${JSON.stringify(value)}\n`).join('');
  await fs.appendFile(filePath, serializedLines, 'utf8');
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildUploadKey(chatReference, topicKey, relativePath) {
  return `${chatReference}::${topicKey}::${relativePath.replace(/\\/g, '/')}`;
}

function buildBatches(files, batchSize, options = {}) {
  const batches = [];
  let index = 0;
  const singleFiles = Boolean(options.singleFiles);

  while (index < files.length) {
    const currentFile = files[index];

    if (singleFiles || !currentFile.groupedId) {
      batches.push([currentFile]);
      index += 1;
      continue;
    }

    const currentBatch = [currentFile];
    let nextIndex = index + 1;

    while (nextIndex < files.length) {
      const nextFile = files[nextIndex];

      if (nextFile.groupedId !== currentFile.groupedId) {
        break;
      }

      if (currentBatch.length >= batchSize || currentBatch.length >= MAX_ALBUM_SIZE) {
        break;
      }

      currentBatch.push(nextFile);
      nextIndex += 1;
    }

    batches.push(currentBatch);
    index = nextIndex;
  }

  return batches;
}

function buildVideoThumbnailCachePath(file) {
  const hash = createHash('sha1')
    .update(`${file.absolutePath}|${file.sizeBytes}|${file.mtimeMs || ''}`)
    .digest('hex')
    .slice(0, 24);

  return path.join(thumbnailCacheDir, `${hash}.jpg`);
}

async function readVideoMetadata(videoPath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,duration:format=duration',
      '-of',
      'json',
      videoPath,
    ],
    {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout || '{}');
  const videoStream = Array.isArray(parsed.streams) ? parsed.streams[0] : null;
  const duration = Number(videoStream?.duration || parsed.format?.duration || 0);

  return {
    width: Math.max(1, Number(videoStream?.width || 1)),
    height: Math.max(1, Number(videoStream?.height || 1)),
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
  };
}

async function createVideoThumbnail(videoPath, thumbnailPath) {
  await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      '00:00:01',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      "scale='if(gt(iw,ih),320,-2)':'if(gt(iw,ih),-2,320)'",
      '-q:v',
      '12',
      thumbnailPath,
    ],
    {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    },
  );
}

async function pathSizeBytes(filePath) {
  try {
    const fileStats = await fs.stat(filePath);
    return fileStats.size;
  } catch {
    return 0;
  }
}

async function prepareVideoSendOptions(file) {
  if (!file || file.mediaKind !== 'video') {
    return {};
  }

  try {
    const thumbnailPath = buildVideoThumbnailCachePath(file);

    if (!(await pathExists(thumbnailPath))) {
      await createVideoThumbnail(file.absolutePath, thumbnailPath);
    }

    const thumbnailSizeBytes = await pathSizeBytes(thumbnailPath);
    const metadata = await readVideoMetadata(file.absolutePath);

    return {
      thumb: thumbnailSizeBytes > 0 && thumbnailSizeBytes <= 200 * 1024 ? thumbnailPath : undefined,
      attributes: [
        new Api.DocumentAttributeVideo({
          duration: metadata.duration,
          w: metadata.width,
          h: metadata.height,
          supportsStreaming: true,
        }),
        new Api.DocumentAttributeFilename({
          fileName: file.fileName,
        }),
      ],
    };
  } catch (error) {
    console.log(
      `[telegram-upload] Aviso: nao consegui gerar thumbnail/metadados para ${file.fileName}: ${normalizeTelegramError(
        error,
        'falha desconhecida',
      )}`,
    );
    return {};
  }
}

async function sendBatchWithRetry({
  client,
  inputEntity,
  batch,
  topicTopMsgId,
  dryRun,
  videoThumbs,
}) {
  if (dryRun) {
    return;
  }

  const files = batch.map((item) => item.absolutePath);
  const singleVideoOptions =
    videoThumbs && batch.length === 1 && batch[0]?.mediaKind === 'video'
      ? await prepareVideoSendOptions(batch[0])
      : {};
  const requestOptions = {
    file: files.length === 1 ? files[0] : files,
    forceDocument: false,
    supportsStreaming: batch.some((item) => item.mediaKind === 'video'),
    ...singleVideoOptions,
    ...(topicTopMsgId > 0 ? { topMsgId: topicTopMsgId } : {}),
  };
  let attempt = 0;

  while (attempt < 4) {
    attempt += 1;

    try {
      await client.sendFile(inputEntity, requestOptions);
      return {
        skipped: false,
        reason: '',
      };
    } catch (error) {
      const waitSeconds = parseRetryWaitSeconds(error);

      if (waitSeconds > 0 && attempt < 4) {
        const delaySeconds = Math.min(waitSeconds + 2, 600);
        console.log(
          `[telegram-upload] Telegram pediu espera de ${delaySeconds}s. Retentando lote...`,
        );
        await sleep(delaySeconds * 1000);
        continue;
      }

      if (batch.length === 1 && isSkippableUploadError(error)) {
        const reason = normalizeTelegramError(error, 'arquivo invalido');

        console.log(
          `[telegram-upload] Pulando arquivo invalido: ${batch[0].relativePath} | motivo: ${reason}`,
        );

        return {
          skipped: true,
          reason,
        };
      }

      throw error;
    }
  }

  return {
    skipped: false,
    reason: '',
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const chatReference = normalizeChatReference(options.chat);
  const sourceDir = path.resolve(projectRoot, toText(options.source));

  if (!options.listChats && !chatReference) {
    printUsage();
    throw new Error('Informe o chat com --chat.');
  }

  if (!options.listChats && !toText(options.source)) {
    printUsage();
    throw new Error('Informe a pasta de origem com --source.');
  }

  if (!options.listChats && !(await pathExists(sourceDir))) {
    throw new Error(`Pasta de origem nao encontrada: ${sourceDir}`);
  }

  const uploadStatePath = path.join(sourceDir, '.telegram-upload-state.json');
  const uploadLogPath = path.join(sourceDir, '.telegram-uploaded.jsonl');
  let client = null;

  try {
    client = await buildAuthorizedClient();

    if (options.listChats) {
      await listChatsAndExit(client);
      return;
    }

    const resolvedEntity = await resolveTelegramEntity(client, chatReference);
    const entityTitle = resolveEntityTitle(resolvedEntity.entity, chatReference);

    if (options.listTopics) {
      await listTopicsAndExit(client, resolvedEntity.inputEntity);
      return;
    }

    const units = await collectTopicUnits(sourceDir, options);
    const uploadedKeys = options.resume ? await readUploadedKeySet(uploadLogPath) : new Set();
    const runStartedAt = Date.now();
    const unitPlans = [];
    let pendingFilesTotal = 0;
    let totalFilesDetected = 0;
    let totalBytesDetected = 0;
    let pendingBytesTotal = 0;

    console.log(`[telegram-upload] Chat destino: ${entityTitle}`);
    console.log(`[telegram-upload] Origem: ${sourceDir}`);
    console.log(`[telegram-upload] Modo: ${options.topicsByFolder ? 'topicos por pasta' : 'topico unico/padrao'}`);
    console.log(`[telegram-upload] Agrupamento: ${options.singleFiles ? 'desativado, uma midia por mensagem' : 'ativado por album quando houver _g...'}`);
    console.log(`[telegram-upload] Thumbnails de video: ${options.videoThumbs ? 'ativadas' : 'desativadas'}`);
    console.log(`[telegram-upload] Retomada: ${options.resume ? 'sim' : 'nao'} | Dry-run: ${options.dryRun ? 'sim' : 'nao'}`);

    for (const unit of units) {
      const topicTopMsgId = await resolveTopicTopMessageId(client, resolvedEntity.inputEntity, unit.topicScope);
      const topicKey = topicTopMsgId > 0 ? `topic-${topicTopMsgId}` : 'chat-main';
      const pendingFiles = [];

      for (const file of unit.files) {
        const uploadKey = buildUploadKey(chatReference, topicKey, file.relativePath);

        if (uploadedKeys.has(uploadKey)) {
          continue;
        }

        pendingFiles.push({
          ...file,
          uploadKey,
        });
      }

      const batches = buildBatches(pendingFiles, options.batchSize, {
        singleFiles: options.singleFiles,
      });
      totalFilesDetected += unit.files.length;
      pendingFilesTotal += pendingFiles.length;
      totalBytesDetected += sumFileSizes(unit.files);
      pendingBytesTotal += sumFileSizes(pendingFiles);

      unitPlans.push({
        unitName: unit.name,
        sourceRoot: unit.sourceRoot,
        topicTopMsgId,
        topicKey,
        pendingFiles,
        batches,
      });
    }

    if (options.maxFiles > 0) {
      let remainingLimit = options.maxFiles;

      for (const unitPlan of unitPlans) {
        if (remainingLimit <= 0) {
          unitPlan.pendingFiles = [];
          unitPlan.batches = [];
          continue;
        }

        if (unitPlan.pendingFiles.length <= remainingLimit) {
          remainingLimit -= unitPlan.pendingFiles.length;
          continue;
        }

        const limitedFiles = unitPlan.pendingFiles.slice(0, remainingLimit);
        unitPlan.pendingFiles = limitedFiles;
        unitPlan.batches = buildBatches(limitedFiles, options.batchSize, {
          singleFiles: options.singleFiles,
        });
        remainingLimit = 0;
      }

      pendingFilesTotal = unitPlans.reduce((total, plan) => total + plan.pendingFiles.length, 0);
      pendingBytesTotal = unitPlans.reduce((total, plan) => total + sumFileSizes(plan.pendingFiles), 0);
    }

    const pendingBatchesTotal = unitPlans.reduce((total, plan) => total + plan.batches.length, 0);

    console.log(
      `[telegram-upload] Arquivos detectados: ${formatInteger(totalFilesDetected)} (${formatGigabytes(
        totalBytesDetected,
      )}) | pendentes nesta execucao: ${formatInteger(pendingFilesTotal)} (${formatGigabytes(pendingBytesTotal)})`,
    );

    if (pendingFilesTotal === 0) {
      console.log('[telegram-upload] Nada pendente para enviar.');
      return;
    }

    let uploadedNow = 0;
    let uploadedBytesNow = 0;
    let uploadedBatches = 0;
    let skippedNow = 0;
    let skippedBytesNow = 0;
    let savedCheckpoints = 0;

    for (const unitPlan of unitPlans) {
      if (unitPlan.pendingFiles.length === 0) {
        continue;
      }

      const topicLabel =
        unitPlan.topicTopMsgId > 0
          ? `topico(topMsgId=${unitPlan.topicTopMsgId})`
          : 'chat principal';

      console.log(
        `[telegram-upload] Unidade "${unitPlan.unitName}" | ${formatInteger(
          unitPlan.pendingFiles.length,
        )} arquivo(s) | destino: ${topicLabel}`,
      );
      let batchIndex = 0;

      for (const batch of unitPlan.batches) {
        batchIndex += 1;
        const elapsedMs = Date.now() - runStartedAt;
        const filePercent = pendingFilesTotal > 0 ? (uploadedNow / pendingFilesTotal) * 100 : 0;
        const bytesPercent = pendingBytesTotal > 0 ? (uploadedBytesNow / pendingBytesTotal) * 100 : 0;
        const batchBytes = sumFileSizes(batch);
        const remainingFiles = Math.max(0, pendingFilesTotal - uploadedNow);
        const remainingBytes = Math.max(0, pendingBytesTotal - uploadedBytesNow);
        const averageSpeed = elapsedMs > 0 && uploadedBytesNow > 0 ? uploadedBytesNow / (elapsedMs / 1000) : 0;
        const eta = formatUploadEta(uploadedBytesNow, remainingBytes, elapsedMs);

        console.log(
          `[telegram-upload] ${formatPercent(filePercent)} arquivos / ${formatPercent(
            bytesPercent,
          )} tamanho | lote ${formatInteger(uploadedBatches + 1)}/${formatInteger(
            pendingBatchesTotal,
          )} (unidade ${batchIndex}/${unitPlan.batches.length}) | lote: ${batch.length} arquivo(s), ${formatBytes(
            batchBytes,
          )} | enviados: ${formatInteger(uploadedNow)}/${formatInteger(pendingFilesTotal)} (${formatGigabytes(
            uploadedBytesNow,
          )}/${formatGigabytes(pendingBytesTotal)}) | falta: ${formatInteger(remainingFiles)} arquivo(s), ${formatGigabytes(
            remainingBytes,
          )} | vel.media: ${averageSpeed > 0 ? `${formatBytes(averageSpeed)}/s` : 'calculando'} | ETA: ${eta} | tempo: ${formatDuration(
            elapsedMs,
          )}`,
        );

        const batchResult = await sendBatchWithRetry({
          client,
          inputEntity: resolvedEntity.inputEntity,
          batch,
          topicTopMsgId: unitPlan.topicTopMsgId,
          dryRun: options.dryRun,
          videoThumbs: options.videoThumbs,
        });

        const uploadedEntries = batch.map((item) => ({
          key: item.uploadKey,
          relativePath: item.relativePath,
          topicTopMsgId: unitPlan.topicTopMsgId,
          unitName: unitPlan.unitName,
          sentAt: new Date().toISOString(),
          dryRun: options.dryRun,
        }));

        if (batchResult?.skipped) {
          for (const entry of uploadedEntries) {
            entry.skipped = true;
            entry.skipReason = batchResult.reason;
          }
        }

        if (!options.dryRun) {
          await appendJsonLines(uploadLogPath, uploadedEntries);
        }

        for (const entry of uploadedEntries) {
          uploadedKeys.add(entry.key);
        }

        uploadedNow += batch.length;
        uploadedBytesNow += batchBytes;
        uploadedBatches += 1;

        if (batchResult?.skipped) {
          skippedNow += batch.length;
          skippedBytesNow += batchBytes;
        }

        if (uploadedNow % 25 === 0 || uploadedNow === pendingFilesTotal) {
          savedCheckpoints += 1;
          if (!options.dryRun) {
            await writeJsonFile(uploadStatePath, {
              version: STATE_VERSION,
              sourceDir,
              chatReference,
              updatedAt: new Date().toISOString(),
              uploadedNow,
              pendingFilesTotal,
              uploadedBytesNow,
              pendingBytesTotal,
              remainingBytes: Math.max(0, pendingBytesTotal - uploadedBytesNow),
              uploadedBatches,
              skippedNow,
              skippedBytesNow,
              dryRun: options.dryRun,
              checkpoints: savedCheckpoints,
            });
          }
        }

        if (options.delayMs > 0) {
          await sleep(options.delayMs);
        }
      }
    }

    const totalElapsedMs = Date.now() - runStartedAt;

    if (!options.dryRun) {
      await writeJsonFile(uploadStatePath, {
        version: STATE_VERSION,
        sourceDir,
        chatReference,
        updatedAt: new Date().toISOString(),
        completed: true,
        uploadedNow,
        pendingFilesTotal,
        totalFilesDetected,
        uploadedBytesNow,
        pendingBytesTotal,
        totalBytesDetected,
        uploadedBatches,
        skippedNow,
        skippedBytesNow,
        dryRun: options.dryRun,
        elapsedMs: totalElapsedMs,
      });
    }

    console.log('[telegram-upload] Upload concluido.');
    console.log(`[telegram-upload] Processados nesta execucao: ${formatInteger(uploadedNow)}`);
    console.log(`[telegram-upload] Pulados por arquivo invalido: ${formatInteger(skippedNow)} (${formatGigabytes(skippedBytesNow)})`);
    console.log(`[telegram-upload] Tamanho processado nesta execucao: ${formatGigabytes(uploadedBytesNow)}`);
    console.log(`[telegram-upload] Lotes enviados: ${formatInteger(uploadedBatches)}`);
    console.log(`[telegram-upload] Tempo total: ${formatDuration(totalElapsedMs)}`);
  } finally {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  }
}

await main().catch((error) => {
  console.error(
    `[telegram-upload] ${normalizeTelegramError(error, 'Falha desconhecida no uploader.')}`,
  );
  process.exitCode = 1;
});
