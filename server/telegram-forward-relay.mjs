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
const SCRIPT_VERSION = 'relay-forward-2026-04-27-flood-retry-v2';
const DEFAULT_TARGET_CHAT = '@allprivacy_noreply_bot';
const DEFAULT_STATE_DIR = 'storage/telegram-forward-relays';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_DELAY_MS = 12000;
const FLOOD_FALLBACK_WAIT_SECONDS = 120;
const MAX_FORWARD_ATTEMPTS = 1000;
const PROGRESS_LOG_INTERVAL = 100;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(milliseconds || 0)));
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
  const normalizedValue = Number(value || 0);

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
  npm.cmd run telegram:relay-forward -- --from <@username|-100...|link> [--to <@bot>] [opcoes]

Opcoes:
  --from <chat>             Grupo/canal de origem
  --to <chat>               Destino intermediario (padrao: ${DEFAULT_TARGET_CHAT})
  --state-dir <pasta>       Pasta de estado/retomada (padrao: ${DEFAULT_STATE_DIR})
  --batch-size <1-100>      Quantas mensagens soltas encaminhar por lote (padrao: ${DEFAULT_BATCH_SIZE})
  --delay-ms <ms>           Pausa entre lotes (padrao: ${DEFAULT_DELAY_MS})
  --limit <n>               Limite de mensagens nesta execucao
  --after-id <id>           Comeca apos um ID especifico
  --dry-run                 Simula sem encaminhar
  --no-final-message        Nao envia /relay_done ao bot no final
  --no-resume               Ignora estado salvo
  --list-chats              Lista chats acessiveis pela conta logada
  --help                    Mostra esta ajuda

Exemplo:
  npm.cmd run telegram:relay-forward -- --from -1002566749405 --to "${DEFAULT_TARGET_CHAT}"`);
}

function parseCliArgs(argv) {
  const options = {
    from: '',
    to: DEFAULT_TARGET_CHAT,
    stateDir: DEFAULT_STATE_DIR,
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    limit: 0,
    afterId: 0,
    resume: true,
    dryRun: false,
    finalMessage: true,
    listChats: false,
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

    if (token === '--list-chats') {
      options.listChats = true;
      continue;
    }

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token === '--no-final-message') {
      options.finalMessage = false;
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

    if (token === '--from' || token === '--chat') {
      options.from = toText(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--to') {
      options.to = toText(argv[index + 1]) || DEFAULT_TARGET_CHAT;
      index += 1;
      continue;
    }

    if (token === '--state-dir') {
      options.stateDir = toText(argv[index + 1]) || DEFAULT_STATE_DIR;
      index += 1;
      continue;
    }

    if (token === '--batch-size') {
      options.batchSize = normalizeIntegerInRange(argv[index + 1], DEFAULT_BATCH_SIZE, 1, 100);
      index += 1;
      continue;
    }

    if (token === '--delay-ms') {
      options.delayMs = normalizePositiveInteger(argv[index + 1]);
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

    if (!token.startsWith('-') && !options.from) {
      options.from = token;
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
    (error instanceof Error ? toText(error.message) : '') ||
    toText(String(error || ''));

  return explicitMessage || fallbackMessage || 'Falha desconhecida.';
}

function buildTelegramErrorText(error) {
  const parts = [
    normalizeTelegramError(error, ''),
    toText(error?.code),
    toText(error?.errorMessage),
    toText(error?.message),
    toText(error?.className),
    toText(error?.constructor?.name),
  ];

  try {
    parts.push(JSON.stringify(error));
  } catch {
    // Ignora erros circulares de serializacao.
  }

  return parts.filter(Boolean).join(' | ');
}

function parseRetryWaitSeconds(error) {
  const reason = buildTelegramErrorText(error);
  let match = reason.match(/FLOOD_WAIT_(\d+)/i);

  if (!match) {
    match = reason.match(/SLOWMODE_WAIT_(\d+)/i);
  }

  if (!match) {
    match = reason.match(/A wait of (\d+) seconds/i);
  }

  if (!match) {
    match = reason.match(/retry after (\d+)/i);
  }

  const seconds = Number(match?.[1] || 0);

  if (Number.isInteger(seconds) && seconds > 0) {
    return seconds;
  }

  if (/\bFLOOD\b/i.test(reason)) {
    return FLOOD_FALLBACK_WAIT_SECONDS;
  }

  return 0;
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
      'A sessao da conta principal ainda nao esta pronta. Use npm.cmd run telegram:login:qr antes deste comando.',
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

    console.error(`[telegram-relay-forward] Erro na conta principal: ${reason}`);
  };
}

async function warmCleanerUserDialogs(client) {
  try {
    await client.getDialogs({ limit: 300 });
  } catch (error) {
    console.error(
      '[telegram-relay-forward] Falha ao aquecer dialogs da conta principal:',
      normalizeTelegramError(error, 'Falha desconhecida.'),
    );
  }
}

async function buildAuthorizedClient() {
  const cleanerUserConfig = buildCleanerUserConfig();

  if (!cleanerUserConfig.apiId || !cleanerUserConfig.apiHash) {
    throw new Error('Configure CLEANER_USER_API_ID e CLEANER_USER_API_HASH antes de usar o encaminhador.');
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
      throw new Error('Sessao ausente. Rode npm.cmd run telegram:login:qr antes.');
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
          '[telegram-relay-forward] Falha durante autenticacao:',
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
    const entity = await client.getEntity(inputEntity).catch(() => null);
    return { inputEntity, entity };
  } catch {
    await warmCleanerUserDialogs(client);
  }

  try {
    const inputEntity = await client.getInputEntity(entityReference);
    const entity = await client.getEntity(inputEntity).catch(() => null);
    return { inputEntity, entity };
  } catch {
    throw new Error(
      `Nao consegui acessar ${normalizedReference}. Confirme se a conta logada esta nesse chat e se voce usou @username, -100... ou link.`,
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

function resolveEntitySlug(entity, fallbackValue) {
  return toSlug(resolveEntityTitle(entity, fallbackValue), toSlug(fallbackValue, 'chat'));
}

async function estimateTotalMessages(client, entity) {
  const messages = await client.getMessages(entity, { limit: 1 });
  const totalMessages = Number(messages?.total || messages?.length || 0);
  return Number.isFinite(totalMessages) && totalMessages > 0 ? totalMessages : 0;
}

async function listAccessibleChats(client) {
  const dialogs = await client.getDialogs({ limit: 500 });

  if (!Array.isArray(dialogs) || dialogs.length === 0) {
    console.log('[telegram-relay-forward] Nenhum chat acessivel foi encontrado.');
    return;
  }

  console.log('[telegram-relay-forward] Chats acessiveis pela conta logada:');

  for (const dialog of dialogs) {
    const entity = dialog?.entity;
    const username = toText(entity?.username);
    const title = resolveEntityTitle(entity, 'chat-sem-titulo');
    const id = resolveEntityId(entity);
    const preferredReference = username ? `@${username}` : id || 'sem-id';

    console.log(`- ${preferredReference}\t${title}`);
  }
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
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

async function appendJsonLines(filePath, values) {
  const normalizedValues = Array.isArray(values) ? values : [values];

  if (normalizedValues.length === 0) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(
    filePath,
    normalizedValues.map((value) => `${JSON.stringify(value)}\n`).join(''),
    'utf8',
  );
}

function normalizeLoadedState(loadedState, sourceChat, targetChat) {
  if (!loadedState || typeof loadedState !== 'object') {
    return {
      version: STATE_VERSION,
      sourceChat,
      targetChat,
      lastProcessedMessageId: 0,
      scannedMessages: 0,
      forwardedMessages: 0,
      forwardedBatches: 0,
      skippedMessages: 0,
      failedBatches: [],
      estimatedTotalMessages: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    version: STATE_VERSION,
    sourceChat,
    targetChat,
    lastProcessedMessageId: normalizePositiveInteger(loadedState.lastProcessedMessageId),
    scannedMessages: normalizePositiveInteger(loadedState.scannedMessages),
    forwardedMessages: normalizePositiveInteger(loadedState.forwardedMessages),
    forwardedBatches: normalizePositiveInteger(loadedState.forwardedBatches),
    skippedMessages: normalizePositiveInteger(loadedState.skippedMessages),
    failedBatches: Array.isArray(loadedState.failedBatches) ? loadedState.failedBatches : [],
    estimatedTotalMessages: normalizePositiveInteger(loadedState.estimatedTotalMessages),
    createdAt: toText(loadedState.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function isForwardableMessage(message) {
  if (!message || !Number.isInteger(Number(message.id)) || Number(message.id) <= 0) {
    return false;
  }

  if (String(message.className || '') === 'MessageService') {
    return false;
  }

  return Boolean(message.message || message.media);
}

function buildProgressSnapshot(state, progressRuntime) {
  const elapsedMs = Math.max(0, Date.now() - progressRuntime.startedAtMs);
  const processedThisRun = Math.max(0, state.scannedMessages - progressRuntime.startScannedMessages);
  const ratePerSecond = elapsedMs > 0 ? processedThisRun / (elapsedMs / 1000) : 0;
  const estimatedTotalMessages = Math.max(
    Number(progressRuntime.estimatedTotalMessages || 0),
    Number(state.estimatedTotalMessages || 0),
  );
  const scannedMessages = Math.max(0, state.scannedMessages);
  const completionRatio =
    estimatedTotalMessages > 0 ? Math.min(scannedMessages / estimatedTotalMessages, 1) : 0;
  const remainingMessages = Math.max(estimatedTotalMessages - scannedMessages, 0);
  const etaMs = ratePerSecond > 0 && remainingMessages > 0 ? (remainingMessages / ratePerSecond) * 1000 : 0;

  return {
    elapsedMs,
    processedThisRun,
    ratePerSecond,
    estimatedTotalMessages,
    scannedMessages,
    completionRatio,
    remainingMessages,
    etaMs,
  };
}

function logProgress(state, progressRuntime, label = 'Progresso') {
  const snapshot = buildProgressSnapshot(state, progressRuntime);
  const percent =
    snapshot.estimatedTotalMessages > 0 ? formatPercent(snapshot.completionRatio * 100) : 'estimando';
  const totalLabel =
    snapshot.estimatedTotalMessages > 0 ? formatInteger(snapshot.estimatedTotalMessages) : '?';
  const etaLabel = snapshot.etaMs > 0 ? formatDuration(snapshot.etaMs) : 'calculando';

  console.log(
    `[telegram-relay-forward] ${label}: ${percent} | lidas: ${formatInteger(
      snapshot.scannedMessages,
    )}/${totalLabel} | encaminhadas: ${formatInteger(state.forwardedMessages)} | lotes: ${formatInteger(
      state.forwardedBatches,
    )} | puladas: ${formatInteger(state.skippedMessages)} | falhas: ${formatInteger(
      state.failedBatches.length,
    )} | vel.media: ${snapshot.ratePerSecond.toFixed(2)} msg/s | ETA: ${etaLabel} | ultimo ID: ${
      state.lastProcessedMessageId
    } | tempo: ${formatDuration(snapshot.elapsedMs)}`,
  );
}

async function saveState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  await writeJsonFile(statePath, state);
}

function buildUnitFromMessages(messages, type) {
  const normalizedMessages = messages
    .filter(Boolean)
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

  return {
    type,
    ids: normalizedMessages.map((message) => Number(message.id)),
    lastId: Math.max(...normalizedMessages.map((message) => Number(message.id))),
  };
}

async function forwardUnitWithRetry({ client, sourceInputEntity, targetInputEntity, unit, dryRun }) {
  if (!unit || unit.ids.length === 0) {
    return {
      forwarded: 0,
      skipped: 0,
      reason: '',
    };
  }

  if (dryRun) {
    return {
      forwarded: unit.ids.length,
      skipped: 0,
      reason: '',
    };
  }

  let attempt = 0;

  while (attempt < MAX_FORWARD_ATTEMPTS) {
    attempt += 1;

    try {
      await client.forwardMessages(targetInputEntity, {
        messages: unit.ids,
        fromPeer: sourceInputEntity,
      });

      return {
        forwarded: unit.ids.length,
        skipped: 0,
        reason: '',
      };
    } catch (error) {
      const waitSeconds = parseRetryWaitSeconds(error);

      if (waitSeconds > 0 && attempt < MAX_FORWARD_ATTEMPTS) {
        const delaySeconds = Math.min(waitSeconds + 5, 900);
        console.log(
          `[telegram-relay-forward] FLOOD/rate limit no lote ${unit.type} (${unit.ids.join(
            ', ',
          )}). Vou aguardar ${delaySeconds}s e tentar O MESMO lote novamente. Motivo: ${normalizeTelegramError(
            error,
            'FLOOD',
          )}`,
        );
        await sleep(delaySeconds * 1000);
        continue;
      }

      const reason = normalizeTelegramError(error, 'falha ao encaminhar lote');

      return {
        forwarded: 0,
        skipped: unit.ids.length,
        reason,
      };
    }
  }

  return {
    forwarded: 0,
    skipped: unit.ids.length,
    reason: 'tentativas esgotadas',
  };
}

async function processUnit({
  client,
  sourceInputEntity,
  targetInputEntity,
  unit,
  state,
  statePath,
  forwardLogPath,
  options,
}) {
  if (!unit || unit.ids.length === 0) {
    return;
  }

  const result = await forwardUnitWithRetry({
    client,
    sourceInputEntity,
    targetInputEntity,
    unit,
    dryRun: options.dryRun,
  });

  if (result.forwarded > 0) {
    state.forwardedMessages += result.forwarded;
    state.forwardedBatches += 1;

    if (!options.dryRun && forwardLogPath) {
      await appendJsonLines(forwardLogPath, {
        ids: unit.ids,
        type: unit.type,
        forwarded: result.forwarded,
        lastId: unit.lastId,
        forwardedAt: new Date().toISOString(),
      });
    }
  }

  if (result.skipped > 0) {
    state.skippedMessages += result.skipped;
    state.failedBatches.push({
      ids: unit.ids,
      type: unit.type,
      reason: result.reason,
      failedAt: new Date().toISOString(),
    });
    console.log(
      `[telegram-relay-forward] Pulando lote ${unit.type} (${unit.ids.join(', ')}): ${result.reason}`,
    );
  }

  state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, unit.lastId);
  await saveState(statePath, state);

  if (options.delayMs > 0) {
    await sleep(options.delayMs);
  }
}

async function sendFinalRelayMessage(client, targetInputEntity) {
  try {
    await client.sendMessage(targetInputEntity, {
      message: '/relay_done',
      silent: true,
    });
  } catch (error) {
    console.log(
      `[telegram-relay-forward] Aviso: nao consegui enviar /relay_done ao bot: ${normalizeTelegramError(
        error,
        'falha desconhecida',
      )}`,
    );
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

    const sourceChat = normalizeChatReference(options.from);
    const targetChat = normalizeChatReference(options.to || DEFAULT_TARGET_CHAT);

    if (!sourceChat) {
      printUsage();
      throw new Error('Informe o grupo/canal de origem com --from.');
    }

    if (!targetChat) {
      printUsage();
      throw new Error('Informe o bot/destino intermediario com --to.');
    }

    const sourceEntity = await resolveTelegramEntity(client, sourceChat);
    const targetEntity = await resolveTelegramEntity(client, targetChat);
    const sourceTitle = resolveEntityTitle(sourceEntity.entity || sourceEntity.inputEntity, sourceChat);
    const targetTitle = resolveEntityTitle(targetEntity.entity || targetEntity.inputEntity, targetChat);
    const stateRoot = path.resolve(projectRoot, options.stateDir);
    const stateFolderName = `${resolveEntitySlug(sourceEntity.entity, sourceChat)}-to-${toSlug(
      targetChat,
      'target',
    )}`;
    const stateDir = path.join(stateRoot, stateFolderName);
    const statePath = path.join(stateDir, '.forward-state.json');
    const forwardLogPath = path.join(stateDir, '.forward-forwarded.jsonl');
    const loadedState = options.resume ? await readJsonFile(statePath, null) : null;
    const state = normalizeLoadedState(loadedState, sourceChat, targetChat);
    const startAfterId = Math.max(options.afterId, options.resume ? state.lastProcessedMessageId : 0);
    const estimatedTotalMessages = await estimateTotalMessages(client, sourceEntity.inputEntity);
    const progressRuntime = {
      startedAtMs: Date.now(),
      startScannedMessages: state.scannedMessages,
      estimatedTotalMessages,
    };

    if (estimatedTotalMessages > 0) {
      state.estimatedTotalMessages = Math.max(state.estimatedTotalMessages, estimatedTotalMessages);
    }

    await fs.mkdir(stateDir, { recursive: true });

    console.log(`[telegram-relay-forward] Versao: ${SCRIPT_VERSION}`);
    console.log(`[telegram-relay-forward] Origem: ${sourceTitle} (${sourceChat})`);
    console.log(`[telegram-relay-forward] Destino intermediario: ${targetTitle} (${targetChat})`);
    console.log(`[telegram-relay-forward] Estado: ${statePath}`);
    console.log(`[telegram-relay-forward] Retomada: ${options.resume ? 'sim' : 'nao'} | ultimo ID: ${startAfterId}`);
    console.log(`[telegram-relay-forward] Lote mensagens soltas: ${options.batchSize} | pausa: ${options.delayMs}ms`);
    console.log(`[telegram-relay-forward] Dry-run: ${options.dryRun ? 'sim' : 'nao'}`);
    console.log(`[telegram-relay-forward] Confirmacao final no bot: ${options.finalMessage ? 'sim' : 'nao'}`);
    console.log(
      `[telegram-relay-forward] Total estimado de mensagens: ${
        estimatedTotalMessages > 0 ? formatInteger(estimatedTotalMessages) : 'nao consegui estimar'
      }`,
    );
    logProgress(state, progressRuntime, 'Status inicial');

    const iterOptions = {
      reverse: true,
      offsetId: startAfterId,
      waitTime: 1,
      ...(options.limit > 0 ? { limit: options.limit } : {}),
    };
    let currentAlbum = [];
    let currentAlbumId = '';
    let pendingSingles = [];

    const flushSingles = async () => {
      if (pendingSingles.length === 0) {
        return;
      }

      const unit = buildUnitFromMessages(pendingSingles, 'mensagens');
      pendingSingles = [];
      await processUnit({
        client,
        sourceInputEntity: sourceEntity.inputEntity,
        targetInputEntity: targetEntity.inputEntity,
        unit,
        state,
        statePath,
        forwardLogPath,
        options,
      });
    };

    const flushAlbum = async () => {
      if (currentAlbum.length === 0) {
        return;
      }

      const unit = buildUnitFromMessages(currentAlbum, 'album');
      currentAlbum = [];
      currentAlbumId = '';
      await processUnit({
        client,
        sourceInputEntity: sourceEntity.inputEntity,
        targetInputEntity: targetEntity.inputEntity,
        unit,
        state,
        statePath,
        forwardLogPath,
        options,
      });
    };

    for await (const message of client.iterMessages(sourceEntity.inputEntity, iterOptions)) {
      const messageId = Number(message?.id || 0);

      if (messageId <= startAfterId) {
        continue;
      }

      state.scannedMessages += 1;

      if (!isForwardableMessage(message)) {
        await flushSingles();
        await flushAlbum();
        state.skippedMessages += 1;
        state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, Number(message.id || 0));
        await saveState(statePath, state);
      } else {
        const groupedId = message.groupedId ? String(message.groupedId) : '';

        if (groupedId) {
          await flushSingles();

          if (currentAlbumId && currentAlbumId !== groupedId) {
            await flushAlbum();
          }

          currentAlbumId = groupedId;
          currentAlbum.push(message);
        } else {
          await flushAlbum();
          pendingSingles.push(message);

          if (pendingSingles.length >= options.batchSize) {
            await flushSingles();
          }
        }
      }

      const processedThisRun = state.scannedMessages - progressRuntime.startScannedMessages;

      if (processedThisRun > 0 && processedThisRun % PROGRESS_LOG_INTERVAL === 0) {
        logProgress(state, progressRuntime);
      }
    }

    await flushSingles();
    await flushAlbum();
    await saveState(statePath, state);

    if (options.finalMessage && !options.dryRun) {
      await sendFinalRelayMessage(client, targetEntity.inputEntity);
    }

    logProgress(state, progressRuntime, 'Status final');
    console.log('[telegram-relay-forward] Encaminhamento concluido.');
    console.log(`[telegram-relay-forward] Mensagens encaminhadas: ${formatInteger(state.forwardedMessages)}`);
    console.log(`[telegram-relay-forward] Lotes encaminhados: ${formatInteger(state.forwardedBatches)}`);
    console.log(`[telegram-relay-forward] Mensagens puladas/falhas: ${formatInteger(state.skippedMessages)}`);
    console.log(`[telegram-relay-forward] Falhas registradas: ${formatInteger(state.failedBatches.length)}`);
  } finally {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  }
}

await main().catch((error) => {
  console.error(
    `[telegram-relay-forward] ${normalizeTelegramError(error, 'Falha desconhecida no encaminhador.')}`,
  );
  process.exitCode = 1;
});
