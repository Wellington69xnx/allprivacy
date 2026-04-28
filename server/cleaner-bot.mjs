import path from 'node:path';
import { promises as fs } from 'node:fs';
import { stdin as processInput, stdout as processOutput } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const BUFFER_FLUSH_MS = 1500;
const POLL_RETRY_MS = 1000;
const TELEGRAM_REQUEST_MAX_ATTEMPTS = 20;
const TELEGRAM_RETRY_PADDING_MS = 1000;
const COPY_MESSAGES_CHUNK_LIMIT = 100;
const MEDIA_GROUP_CHUNK_LIMIT = 10;
const ALBUM_LOOKAROUND = 12;
const HISTORY_RELAY_PROGRESS_LOG_INTERVAL = 100;
const DEFAULT_RELAY_STATE_PATH = path.resolve(process.cwd(), 'storage', 'cleaner-relay-state.json');

export function startCleanerBot({
  token,
  adminIds,
  userClientConfig,
  botLabel = 'NoReply',
  logPrefix = 'cleaner-bot',
  relayStatePath = DEFAULT_RELAY_STATE_PATH,
  updateStatePath = '',
  relayDedupePath = '',
  relayCommands = {},
  historyRelay = {},
}) {
  if (!token) {
    return { enabled: false };
  }

  const apiBase = `https://api.telegram.org/bot${token}`;
  const masterAdminId = 8018785433;
  const normalizedBotLabel = toText(botLabel) || 'NoReply';
  const normalizedLogPrefix = toText(logPrefix) || 'cleaner-bot';
  const logTag = `[${normalizedLogPrefix}]`;
  const relayStateStoragePath = toText(relayStatePath)
    ? path.resolve(process.cwd(), toText(relayStatePath))
    : DEFAULT_RELAY_STATE_PATH;
  const updateStateStoragePath = toText(updateStatePath)
    ? path.resolve(process.cwd(), toText(updateStatePath))
    : path.resolve(process.cwd(), 'storage', `${normalizedLogPrefix}-updates-state.json`);
  const relayDedupeStoragePath = toText(relayDedupePath)
    ? path.resolve(process.cwd(), toText(relayDedupePath))
    : path.resolve(process.cwd(), 'storage', `${normalizedLogPrefix}-relay-dedupe.json`);
  const relayCommandConfig = normalizeRelayCommands(relayCommands);
  const historyRelayConfig = normalizeHistoryRelayConfig(historyRelay);
  const chatBuffers = new Map();
  const relayDeliveryStats = new Map();
  const cleanerUserAuthSessions = new Map();
  const historyRelaySessions = new Map();
  const relayDedupeKeys = new Set();
  const suppressedIncomingMessageIdsByChat = new Map();
  let relayState = {
    enabled: false,
    chatId: 0,
    messageThreadId: 0,
    configuredBy: 0,
    updatedAt: '',
  };
  let relayStateLoadPromise = null;
  let updateStateLoadPromise = null;
  let relayDedupeLoadPromise = null;
  const cleanerUserConfig = normalizeCleanerUserConfig(userClientConfig);
  const cleanerBotIdentityState = {
    userId: 0,
    username: '',
    inputPeer: null,
  };
  const cleanerUserState = {
    enabled: cleanerUserConfig.apiId > 0 && Boolean(cleanerUserConfig.apiHash),
    ready: false,
    error: '',
  };
  let lastUpdateId = 0;
  let cleanerUserClient = null;
  let cleanerUserClientInitPromise = null;
  let relayCopyQueue = Promise.resolve();
  let activeHistoryRelayJob = null;
  let hasLoggedPollingStart = false;

  function toText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function getMessageCommand(text) {
    const normalizedText = toText(text);

    if (!normalizedText.startsWith('/')) {
      return '';
    }

    return normalizedText.split(/\s+/)[0].split('@')[0].toLowerCase();
  }

  function normalizeCommand(value, fallbackValue) {
    const normalizedValue = toText(value || fallbackValue).toLowerCase();

    if (!normalizedValue) {
      return '';
    }

    return normalizedValue.startsWith('/') ? normalizedValue : `/${normalizedValue}`;
  }

  function normalizeRelayCommands(commands = {}) {
    return {
      here: normalizeCommand(commands.here, '/relay_here'),
      on: normalizeCommand(commands.on, '/relay_on'),
      off: normalizeCommand(commands.off, '/relay_off'),
      status: normalizeCommand(commands.status, '/relay_status'),
      summary: normalizeCommand(commands.summary, '/relay_summary'),
      done: normalizeCommand(commands.done, '/relay_done'),
      help: normalizeCommand(commands.help, '/relay_help'),
      doneAliases: Array.isArray(commands.doneAliases)
        ? commands.doneAliases.map((command) => normalizeCommand(command, '')).filter(Boolean)
        : ['/done'],
      helpPrefix: normalizeCommand(commands.helpPrefix, '/relay'),
    };
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

  function normalizeHistoryRelayConfig(config = {}) {
    const stateDir = toText(config.stateDir)
      ? path.resolve(process.cwd(), toText(config.stateDir))
      : path.resolve(process.cwd(), 'storage', 'content-history-relays');

    return {
      enabled: Boolean(config.enabled),
      stateDir,
      batchSize: normalizeIntegerInRange(config.batchSize, 10, 1, 100),
      delayMs: normalizePositiveInteger(config.delayMs) || 12000,
      progressLogInterval: normalizeIntegerInRange(config.progressLogInterval, HISTORY_RELAY_PROGRESS_LOG_INTERVAL, 10, 1000),
      floodRetryFirstWaitSeconds: normalizePositiveInteger(config.floodRetryFirstWaitSeconds) || 60,
      floodRetryNextWaitSeconds: normalizePositiveInteger(config.floodRetryNextWaitSeconds) || 30,
      aliasCommands: Array.isArray(config.aliasCommands)
        ? config.aliasCommands.map((command) => normalizeCommand(command, '')).filter(Boolean)
        : ['/conteudos'],
      commands: {
        start: normalizeCommand(config.commands?.start, '/conteudo_encaminhar'),
        stop: normalizeCommand(config.commands?.stop, '/conteudo_parar'),
        status: normalizeCommand(config.commands?.status, '/conteudo_job'),
        paused: normalizeCommand(config.commands?.paused, '/conteudo_pausados'),
        failures: normalizeCommand(config.commands?.failures, '/conteudo_falhas'),
      },
    };
  }

  function isConfiguredRelayCommand(command) {
    const normalizedCommand = toText(command).toLowerCase();

    if (!normalizedCommand) {
      return false;
    }

    const directCommands = [
      relayCommandConfig.here,
      relayCommandConfig.on,
      relayCommandConfig.off,
      relayCommandConfig.status,
      relayCommandConfig.summary,
      relayCommandConfig.done,
      relayCommandConfig.help,
      ...relayCommandConfig.doneAliases,
    ].filter(Boolean);

    return (
      directCommands.includes(normalizedCommand) ||
      (relayCommandConfig.helpPrefix && normalizedCommand.startsWith(relayCommandConfig.helpPrefix))
    );
  }

  function isConfiguredHistoryRelayCommand(command) {
    if (!historyRelayConfig.enabled) {
      return false;
    }

    const normalizedCommand = toText(command).toLowerCase();

    return [
      historyRelayConfig.commands.start,
      historyRelayConfig.commands.stop,
      historyRelayConfig.commands.status,
      historyRelayConfig.commands.paused,
      historyRelayConfig.commands.failures,
      ...historyRelayConfig.aliasCommands,
    ].includes(normalizedCommand);
  }

  function isForwardedMessage(message) {
    return Boolean(
      message?.forward_origin ||
        message?.forward_from ||
        message?.forward_from_chat ||
        message?.forward_sender_name ||
        message?.forward_date,
    );
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, Number(milliseconds || 0)));
    });
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

  function buildRelayProgressLabel(totalCopied, totalMessages, startedAtMs) {
    const elapsedMs = Math.max(0, Date.now() - Number(startedAtMs || 0));
    const copied = Math.max(0, Number(totalCopied || 0));
    const total = Math.max(0, Number(totalMessages || 0));
    const ratePerSecond = elapsedMs > 0 ? copied / (elapsedMs / 1000) : 0;
    const remaining = Math.max(total - copied, 0);
    const etaMs = ratePerSecond > 0 && remaining > 0 ? (remaining / ratePerSecond) * 1000 : 0;
    const percent = total > 0 ? `${((copied / total) * 100).toFixed(1)}%` : '100.0%';

    return `${percent} | copiadas: ${formatInteger(copied)}/${formatInteger(
      total,
    )} | vel.media: ${ratePerSecond.toFixed(2)} msg/s | ETA: ${
      etaMs > 0 ? formatDuration(etaMs) : 'calculando'
    } | tempo: ${formatDuration(elapsedMs)}`;
  }

  function parseTelegramRetryAfter(value) {
    const normalizedValue = toText(value);
    const match = normalizedValue.match(/retry after (\d+)/i);
    const retryAfterSeconds = Number(match?.[1] || 0);

    return Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 0;
  }

  function normalizeCleanerUserConfig(config = {}) {
    return {
      apiId: Number(config?.apiId || 0),
      apiHash: toText(config?.apiHash),
      phone: toText(config?.phone),
      session: toText(config?.session),
      sessionFilePath: toText(config?.sessionFilePath),
    };
  }

  function getSendTargets(chatId) {
    return Number(chatId) === masterAdminId ? [masterAdminId] : [chatId, masterAdminId];
  }

  function normalizeRelayState(value = {}) {
    return {
      enabled: Boolean(value.enabled),
      chatId: Number(value.chatId || 0),
      messageThreadId: Number(value.messageThreadId || 0),
      chatTitle: toText(value.chatTitle),
      destinationTitle: toText(value.destinationTitle || value.chatTitle),
      configuredBy: Number(value.configuredBy || 0),
      updatedAt: toText(value.updatedAt),
    };
  }

  async function ensureRelayStateLoaded() {
    if (relayStateLoadPromise) {
      return relayStateLoadPromise;
    }

    relayStateLoadPromise = (async () => {
      try {
        const rawState = await fs.readFile(relayStateStoragePath, 'utf8');
        relayState = normalizeRelayState(JSON.parse(rawState));
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
          console.error(
            `${logTag} Falha ao carregar estado do relay:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return relayState;
    })();

    return relayStateLoadPromise;
  }

  async function saveRelayState(nextState) {
    relayState = normalizeRelayState(nextState);
    await fs.mkdir(path.dirname(relayStateStoragePath), { recursive: true });
    await fs.writeFile(relayStateStoragePath, `${JSON.stringify(relayState, null, 2)}\n`, 'utf8');
    return relayState;
  }

  async function ensureUpdateStateLoaded() {
    if (updateStateLoadPromise) {
      return updateStateLoadPromise;
    }

    updateStateLoadPromise = (async () => {
      try {
        const rawState = await fs.readFile(updateStateStoragePath, 'utf8');
        const state = JSON.parse(rawState);
        const savedLastUpdateId = Number(state?.lastUpdateId || 0);

        if (Number.isInteger(savedLastUpdateId) && savedLastUpdateId > 0) {
          lastUpdateId = Math.max(lastUpdateId, savedLastUpdateId);
        }
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
          console.error(
            `${logTag} Falha ao carregar estado de updates:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return lastUpdateId;
    })();

    return updateStateLoadPromise;
  }

  async function saveUpdateState() {
    await fs.mkdir(path.dirname(updateStateStoragePath), { recursive: true });
    await fs.writeFile(
      updateStateStoragePath,
      `${JSON.stringify({ lastUpdateId, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  }

  async function ensureRelayDedupeLoaded() {
    if (relayDedupeLoadPromise) {
      return relayDedupeLoadPromise;
    }

    relayDedupeLoadPromise = (async () => {
      try {
        const rawState = await fs.readFile(relayDedupeStoragePath, 'utf8');
        const state = JSON.parse(rawState);
        const keys = Array.isArray(state?.keys) ? state.keys : [];

        for (const key of keys) {
          const normalizedKey = toText(key);

          if (normalizedKey) {
            relayDedupeKeys.add(normalizedKey);
          }
        }
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
          console.error(
            `${logTag} Falha ao carregar dedupe do relay:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return relayDedupeKeys;
    })();

    return relayDedupeLoadPromise;
  }

  async function saveRelayDedupeState() {
    const keys = Array.from(relayDedupeKeys).slice(-20000);

    relayDedupeKeys.clear();

    for (const key of keys) {
      relayDedupeKeys.add(key);
    }

    await fs.mkdir(path.dirname(relayDedupeStoragePath), { recursive: true });
    await fs.writeFile(
      relayDedupeStoragePath,
      `${JSON.stringify({ keys, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  }

  function getRelayStatusMessage() {
    if (!relayState.enabled || !relayState.chatId) {
      return `Relay para topico: desligado.\n\nUse ${relayCommandConfig.here} dentro do topico destino para ativar.`;
    }

    return [
      'Relay para topico: ligado.',
      '',
      relayState.destinationTitle ? `Destino: ${relayState.destinationTitle}` : '',
      `Chat destino: ${relayState.chatId}`,
      relayState.messageThreadId ? `Topico/thread: ${relayState.messageThreadId}` : 'Topico/thread: chat principal',
      '',
      `Envie midias no privado do bot ${normalizedBotLabel} para copiar automaticamente ao destino configurado.`,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  function addRelayDeliveryStats(chatId, copiedCount) {
    const normalizedChatId = Number(chatId);
    const normalizedCopiedCount = Math.max(0, Number(copiedCount || 0));

    if (!normalizedChatId || normalizedCopiedCount <= 0) {
      return;
    }

    const currentStats = relayDeliveryStats.get(normalizedChatId) || {
      copiedCount: 0,
      batches: 0,
      startedAt: new Date().toISOString(),
      updatedAt: '',
    };

    relayDeliveryStats.set(normalizedChatId, {
      ...currentStats,
      copiedCount: currentStats.copiedCount + normalizedCopiedCount,
      batches: currentStats.batches + 1,
      updatedAt: new Date().toISOString(),
    });
  }

  function buildRelayDeliverySummary(chatId) {
    const stats = relayDeliveryStats.get(Number(chatId)) || {
      copiedCount: 0,
      batches: 0,
      startedAt: '',
      updatedAt: '',
    };

    return [
      'Encaminhamento concluido.',
      '',
      `Copiei ${stats.copiedCount} mensagem(ns)/midia(s) para o ${
        relayState.messageThreadId ? 'topico configurado' : 'grupo configurado'
      }.`,
      `Lotes processados: ${stats.batches}`,
      relayState.chatId ? `Destino: ${relayState.chatId}` : '',
      relayState.messageThreadId ? `Topico/thread: ${relayState.messageThreadId}` : '',
      stats.startedAt ? `Inicio: ${stats.startedAt}` : '',
      stats.updatedAt ? `Ultima copia: ${stats.updatedAt}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  async function enqueueRelayCopy(task) {
    const runTask = relayCopyQueue.then(task, task);
    relayCopyQueue = runTask.catch(() => {});
    return runTask;
  }

  function isTerminalInteractive() {
    return Boolean(processInput.isTTY && processOutput.isTTY);
  }

  function normalizeCleanerUserError(error, fallbackMessage) {
    const explicitErrorMessage =
      toText(error?.errorMessage) ||
      toText(error?.message) ||
      (error instanceof Error ? toText(error.message) : '');

    return explicitErrorMessage || fallbackMessage || 'Falha desconhecida.';
  }

  function getCleanerUserUnavailableMessage() {
    if (!cleanerUserState.enabled) {
      return 'Configure CLEANER_USER_API_ID e CLEANER_USER_API_HASH para liberar a leitura de links com a conta principal.';
    }

    if (cleanerUserState.ready) {
      return `A conta principal do ${normalizedBotLabel} ja esta conectada.`;
    }

    return (
      cleanerUserState.error ||
      'A conta principal ainda nao foi autenticada. Use /login neste chat para conectar.'
    );
  }

  function normalizeMessageId(value) {
    const numericValue = Number(String(value || '').replace(/\D+/g, ''));
    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
  }

  function buildMessageBatchKey(fromChatId, sourceMessages) {
    if (!Array.isArray(sourceMessages) || sourceMessages.length === 0) {
      return `${fromChatId}:empty`;
    }

    const groupedId = sourceMessages[0]?.groupedId;

    if (groupedId) {
      return `${fromChatId}:album:${String(groupedId)}`;
    }

    return `${fromChatId}:msg:${sourceMessages.map((message) => message.id).join(',')}`;
  }

  function splitIntoChunks(items, chunkSize) {
    const chunks = [];

    for (let index = 0; index < items.length; index += chunkSize) {
      chunks.push(items.slice(index, index + chunkSize));
    }

    return chunks;
  }

  function normalizeMessagesArray(messages) {
    if (!Array.isArray(messages)) {
      return messages ? [messages] : [];
    }

    const flattened = [];

    for (const item of messages) {
      if (Array.isArray(item)) {
        flattened.push(...normalizeMessagesArray(item));
      } else if (item) {
        flattened.push(item);
      }
    }

    return flattened;
  }

  function rememberSuppressedIncomingMessages(chatId, sentMessages) {
    const normalizedChatId = Number(chatId);
    const messageIds = normalizeMessagesArray(sentMessages)
      .map((message) => Number(message?.id || 0))
      .filter((messageId) => Number.isInteger(messageId) && messageId > 0);

    if (messageIds.length === 0) {
      return;
    }

    const currentIds = suppressedIncomingMessageIdsByChat.get(normalizedChatId) || new Set();

    for (const messageId of messageIds) {
      currentIds.add(messageId);
    }

    suppressedIncomingMessageIdsByChat.set(normalizedChatId, currentIds);
  }

  function consumeSuppressedIncomingMessage(chatId, messageId) {
    const normalizedChatId = Number(chatId);
    const normalizedMessageId = Number(messageId);
    const currentIds = suppressedIncomingMessageIdsByChat.get(normalizedChatId);

    if (!currentIds || !currentIds.has(normalizedMessageId)) {
      return false;
    }

    currentIds.delete(normalizedMessageId);

    if (currentIds.size === 0) {
      suppressedIncomingMessageIdsByChat.delete(normalizedChatId);
    }

    return true;
  }

  function sanitizeFilename(filename, fallbackName) {
    const basename = path.basename(toText(filename) || fallbackName);
    const sanitized = basename
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return sanitized || fallbackName;
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

    if (normalizedMimeType === 'video/mp4') {
      return '.mp4';
    }

    if (normalizedMimeType === 'video/quicktime') {
      return '.mov';
    }

    const subtype = normalizedMimeType.split('/')[1];

    if (!subtype) {
      return fallbackExtension;
    }

    const normalizedSubtype = subtype.split(';')[0].replace(/[^a-z0-9]+/g, '');
    return normalizedSubtype ? `.${normalizedSubtype}` : fallbackExtension;
  }

  function resolveLinkedMediaType(sourceMessage) {
    if (sourceMessage.photo) {
      return 'photo';
    }

    if (sourceMessage.video) {
      return 'video';
    }

    if (sourceMessage.document) {
      return 'document';
    }

    return null;
  }

  function resolveMimeTypeForSourceMessage(sourceMessage, mediaType) {
    const fileMimeType = toText(sourceMessage.file?.mimeType);

    if (fileMimeType) {
      return fileMimeType;
    }

    if (mediaType === 'photo') {
      return 'image/jpeg';
    }

    if (mediaType === 'video') {
      return 'video/mp4';
    }

    return 'application/octet-stream';
  }

  function resolveFilenameForSourceMessage(sourceMessage, mediaType, mimeType) {
    const providedFileName = toText(sourceMessage.file?.name);
    const fallbackExtension = mediaType === 'photo' ? '.jpg' : mediaType === 'video' ? '.mp4' : '.bin';
    const extension = getDefaultExtensionFromMime(mimeType, fallbackExtension);

    if (providedFileName) {
      const parsedProvidedFile = path.parse(providedFileName);
      const normalizedExtension = parsedProvidedFile.ext || extension;
      return sanitizeFilename(
        `${parsedProvidedFile.name || `mensagem-${String(sourceMessage.id)}`}${normalizedExtension}`,
        `mensagem-${String(sourceMessage.id)}${extension}`,
      );
    }

    return sanitizeFilename(`mensagem-${String(sourceMessage.id)}${extension}`, `mensagem-${String(sourceMessage.id)}${extension}`);
  }

  function getMediaInfo(message) {
    let type = null;
    let fileId = null;
    let hasSpoiler = false;

    if (message.photo && message.photo.length > 0) {
      type = 'photo';
      fileId = message.photo[message.photo.length - 1].file_id;
      hasSpoiler = message.has_media_spoiler;
    } else if (message.video) {
      type = 'video';
      fileId = message.video.file_id;
      hasSpoiler = message.has_media_spoiler;
    }

    if (!type || !fileId) {
      return null;
    }

    return {
      type,
      media: fileId,
      caption: message.caption,
      caption_entities: message.caption_entities,
      has_spoiler: hasSpoiler,
    };
  }

  function getRelayDedupeKey(message) {
    const origin = message?.forward_origin;
    const originType = toText(origin?.type);
    const originChatId = Number(origin?.chat?.id || origin?.sender_chat?.id || 0);
    const originMessageId = Number(origin?.message_id || 0);

    if (originType && originChatId && originMessageId) {
      return `${originType}:${originChatId}:${originMessageId}`;
    }

    const legacyChatId = Number(message?.forward_from_chat?.id || 0);
    const legacyMessageId = Number(message?.forward_from_message_id || 0);

    if (legacyChatId && legacyMessageId) {
      return `legacy:${legacyChatId}:${legacyMessageId}`;
    }

    return '';
  }

  async function telegramRequest(method, payload) {
    let attempt = 0;

    const getCopyRateLimitWaitSeconds = (currentAttempt) => {
      if (currentAttempt <= 1) {
        return 60;
      }

      if (currentAttempt === 2) {
        return 90;
      }

      return 150 + (currentAttempt - 3) * 30;
    };

    while (attempt < TELEGRAM_REQUEST_MAX_ATTEMPTS) {
      attempt += 1;

      const response = await fetch(`${apiBase}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.ok) {
        return data.result;
      }

      const description = toText(data?.description) || `Falha no metodo ${method}.`;
      const retryAfterSeconds =
        Number(data?.parameters?.retry_after || 0) || parseTelegramRetryAfter(description);

      if (retryAfterSeconds > 0 && attempt < TELEGRAM_REQUEST_MAX_ATTEMPTS) {
        const isCopyRateLimit = method === 'copyMessage' || method === 'copyMessages';
        const progressiveCopyWaitSeconds = getCopyRateLimitWaitSeconds(attempt);
        const waitSeconds = isCopyRateLimit
          ? Math.max(retryAfterSeconds, progressiveCopyWaitSeconds)
          : retryAfterSeconds;
        const waitMs = waitSeconds * 1000 + TELEGRAM_RETRY_PADDING_MS;
        console.log(
          `${logTag} Rate limit em ${method}: aguardando ${Math.ceil(waitMs / 1000)}s antes de tentar novamente...`,
        );
        await sleep(waitMs);
        continue;
      }

      throw new Error(description);
    }

    throw new Error(`Falha no metodo ${method}: tentativas esgotadas.`);
  }

  async function telegramMultipartRequest(method, formData) {
    const response = await fetch(`${apiBase}/${method}`, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(toText(data?.description) || `Falha no metodo ${method}.`);
    }

    return data.result;
  }

  async function ensureCleanerBotIdentity() {
    if (cleanerBotIdentityState.userId > 0 || cleanerBotIdentityState.username) {
      return cleanerBotIdentityState;
    }

    const botMe = await telegramRequest('getMe', {});
    cleanerBotIdentityState.userId = Number(botMe?.id || 0);
    cleanerBotIdentityState.username = toText(botMe?.username);

    return cleanerBotIdentityState;
  }

  async function sendText(chatId, text, options = {}) {
    try {
      await telegramRequest('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...options,
      });
    } catch (error) {
      console.error(
        `${logTag} Erro ao enviar mensagem:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function toTelegramCommandName(command) {
    return toText(command).replace(/^\//, '').split('@')[0].toLowerCase();
  }

  async function configureBotCommandMenu() {
    const commands = [
      { command: 'start', description: 'Ajuda e comandos' },
      { command: 'status', description: 'Ver estado da conta principal' },
      { command: 'login', description: 'Conectar a conta principal' },
      { command: 'cancel', description: 'Cancelar autenticacao em andamento' },
      { command: toTelegramCommandName(relayCommandConfig.here), description: 'Definir destino do relay' },
      { command: toTelegramCommandName(relayCommandConfig.status), description: 'Ver destino atual' },
      { command: toTelegramCommandName(relayCommandConfig.on), description: 'Ligar relay' },
      { command: toTelegramCommandName(relayCommandConfig.off), description: 'Desligar relay' },
      { command: toTelegramCommandName(relayCommandConfig.summary), description: 'Resumo do relay atual' },
      { command: toTelegramCommandName(relayCommandConfig.done), description: 'Finalizar e zerar resumo' },
      ...(historyRelayConfig.enabled
        ? [
            {
              command: toTelegramCommandName(historyRelayConfig.commands.start),
              description: 'Encaminhar historico por origem',
            },
            {
              command: toTelegramCommandName(historyRelayConfig.commands.status),
              description: 'Status do encaminhamento historico',
            },
            {
              command: toTelegramCommandName(historyRelayConfig.commands.paused),
              description: 'Listar encaminhamentos pausados',
            },
            {
              command: toTelegramCommandName(historyRelayConfig.commands.failures),
              description: 'Ver falhas de encaminhamento',
            },
            {
              command: toTelegramCommandName(historyRelayConfig.commands.stop),
              description: 'Pausar encaminhamento historico',
            },
          ]
        : []),
    ].filter((item) => /^[a-z0-9_]{1,32}$/.test(item.command));

    try {
      await telegramRequest('setMyCommands', { commands });
    } catch (error) {
      console.error(
        `${logTag} Nao consegui configurar o menu de comandos:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function sendBotOutboundMessage(chatId, payload) {
    if (!payload) {
      return;
    }

    if (payload.kind === 'text') {
      await sendText(chatId, payload.text);
      return;
    }

    const method =
      payload.mediaType === 'photo'
        ? 'sendPhoto'
        : payload.mediaType === 'video'
          ? 'sendVideo'
          : 'sendDocument';
    const fieldName =
      payload.mediaType === 'photo'
        ? 'photo'
        : payload.mediaType === 'video'
          ? 'video'
          : 'document';
    const formData = new FormData();

    formData.append('chat_id', String(chatId));
    formData.append(
      fieldName,
      new Blob([payload.buffer], { type: payload.mimeType || 'application/octet-stream' }),
      payload.filename,
    );

    if (payload.caption) {
      formData.append('caption', payload.caption);
    }

    if (payload.mediaType === 'video') {
      formData.append('supports_streaming', 'true');
    }

    await telegramMultipartRequest(method, formData);
  }

  async function sendBotMediaGroup(chatId, payloads) {
    for (const chunk of splitIntoChunks(payloads, MEDIA_GROUP_CHUNK_LIMIT)) {
      const formData = new FormData();
      const media = [];

      formData.append('chat_id', String(chatId));

      for (const [index, payload] of chunk.entries()) {
        const attachName = `media${String(index)}`;
        media.push({
          type: payload.mediaType,
          media: `attach://${attachName}`,
          ...(payload.caption ? { caption: payload.caption } : {}),
          ...(payload.mediaType === 'video' ? { supports_streaming: true } : {}),
        });
        formData.append(
          attachName,
          new Blob([payload.buffer], { type: payload.mimeType || 'application/octet-stream' }),
          payload.filename,
        );
      }

      formData.append('media', JSON.stringify(media));
      await telegramMultipartRequest('sendMediaGroup', formData);
    }
  }

  async function copySingleMessage(fromChatId, toChatId, messageId, options = {}) {
    try {
      const payload = {
        chat_id: toChatId,
        from_chat_id: fromChatId,
        message_id: messageId,
      };

      if (Number(options.messageThreadId || 0) > 0) {
        payload.message_thread_id = Number(options.messageThreadId);
      }

      await telegramRequest('copyMessage', payload);
    } catch (error) {
      console.error(
        `${logTag} Erro ao copiar msg individual:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async function copyMultipleMessages(fromChatId, toChatId, messageIds, options = {}) {
    const normalizedMessageIds = Array.from(
      new Set(
        messageIds
          .map((messageId) => Number(messageId))
          .filter((messageId) => Number.isInteger(messageId) && messageId > 0),
      ),
    ).sort((left, right) => left - right);

    if (normalizedMessageIds.length === 0) {
      return;
    }

    if (normalizedMessageIds.length === 1) {
      await copySingleMessage(fromChatId, toChatId, normalizedMessageIds[0], options);
      return;
    }

    try {
      const payload = {
        chat_id: toChatId,
        from_chat_id: fromChatId,
        message_ids: normalizedMessageIds,
      };

      if (Number(options.messageThreadId || 0) > 0) {
        payload.message_thread_id = Number(options.messageThreadId);
      }

      await telegramRequest('copyMessages', payload);
    } catch (error) {
      console.error(
        `${logTag} Erro ao copiar lote de mensagens:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async function handleRelayCommand(message, command) {
    if (!isConfiguredRelayCommand(command)) {
      return false;
    }

    await ensureRelayStateLoaded();

    if (command === relayCommandConfig.here) {
      if (message.chat.type === 'private') {
        await sendText(
          message.chat.id,
          `Use ${relayCommandConfig.here} dentro do topico do grupo onde voce quer receber as midias.`,
        );
        return true;
      }

      await saveRelayState({
        enabled: true,
        chatId: Number(message.chat.id),
        messageThreadId: Number(message.message_thread_id || 0),
        chatTitle: toText(message.chat.title) || toText(message.chat.username) || String(message.chat.id),
        destinationTitle: [
          toText(message.chat.title) || toText(message.chat.username) || String(message.chat.id),
          Number(message.message_thread_id || 0) > 0 ? `topico ${message.message_thread_id}` : '',
        ]
          .filter(Boolean)
          .join(' / '),
        configuredBy: Number(message.from.id),
        updatedAt: new Date().toISOString(),
      });

      await sendText(
        message.chat.id,
        `Relay ativado para este destino.\n\nAgora envie midias no privado do bot ${normalizedBotLabel} que eu copio para ${relayState.messageThreadId ? 'este topico' : 'este chat'}.`,
      );
      return true;
    }

    if (command === relayCommandConfig.on) {
      if (!relayState.chatId) {
        await sendText(
          message.chat.id,
          `Ainda nao ha destino configurado. Use ${relayCommandConfig.here} no topico primeiro.`,
        );
        return true;
      }

      await saveRelayState({
        ...relayState,
        enabled: true,
        configuredBy: Number(message.from.id),
        updatedAt: new Date().toISOString(),
      });
      await sendText(message.chat.id, getRelayStatusMessage());
      return true;
    }

    if (command === relayCommandConfig.off) {
      await saveRelayState({
        ...relayState,
        enabled: false,
        configuredBy: Number(message.from.id),
        updatedAt: new Date().toISOString(),
      });
      await sendText(message.chat.id, getRelayStatusMessage());
      return true;
    }

    if (command === relayCommandConfig.status) {
      await sendText(message.chat.id, getRelayStatusMessage());
      return true;
    }

    if (
      command === relayCommandConfig.done ||
      command === relayCommandConfig.summary ||
      relayCommandConfig.doneAliases.includes(command)
    ) {
      if (chatBuffers.has(message.chat.id)) {
        await flushBuffer(message.chat.id);
      }

      await relayCopyQueue.catch(() => {});
      await sendText(message.chat.id, buildRelayDeliverySummary(message.chat.id));

      if (command === relayCommandConfig.done || relayCommandConfig.doneAliases.includes(command)) {
        relayDeliveryStats.delete(Number(message.chat.id));
      }

      return true;
    }

    await sendText(
      message.chat.id,
      [
        'Comandos do relay:',
        `${relayCommandConfig.here} - usar este grupo/topico como destino`,
        `${relayCommandConfig.status} - ver destino atual`,
        `${relayCommandConfig.on} - ligar relay`,
        `${relayCommandConfig.off} - desligar relay`,
        `${relayCommandConfig.summary} - resumo do encaminhamento atual`,
        `${relayCommandConfig.done} - resumo final e zera contagem`,
      ].join('\n'),
    );
    return true;
  }

  async function flushRelayBuffer(chatId, buffer) {
    await ensureRelayStateLoaded();
    await ensureRelayDedupeLoaded();

    if (!relayState.enabled || !relayState.chatId) {
      return false;
    }

    const relayRecords = buffer.messages
      .map((item) => ({
        messageId: Number(item?.message_id || 0),
        dedupeKey: getRelayDedupeKey(item),
      }))
      .filter((item) => Number.isInteger(item.messageId) && item.messageId > 0)
      .sort((left, right) => left.messageId - right.messageId);
    const seenBufferKeys = new Set();
    let skippedDuplicateCount = 0;
    const recordsToCopy = [];

    for (const record of relayRecords) {
      if (record.dedupeKey && (relayDedupeKeys.has(record.dedupeKey) || seenBufferKeys.has(record.dedupeKey))) {
        skippedDuplicateCount += 1;
        continue;
      }

      if (record.dedupeKey) {
        seenBufferKeys.add(record.dedupeKey);
      }

      recordsToCopy.push(record);
    }
    const messageIds = recordsToCopy.map((item) => item.messageId);

    if (skippedDuplicateCount > 0) {
      console.log(`${logTag} Relay dedupe: pulando ${formatInteger(skippedDuplicateCount)} item(ns) ja copiados.`);
    }

    if (messageIds.length === 0) {
      return true;
    }

    const copiedCount = await enqueueRelayCopy(async () => {
      let totalCopied = 0;
      const startedAtMs = Date.now();
      const totalMessages = messageIds.length;

      console.log(
        `${logTag} Relay iniciado: origem ${chatId} -> destino ${relayState.chatId}${
          relayState.messageThreadId ? ` topico ${relayState.messageThreadId}` : ''
        } | total: ${formatInteger(totalMessages)}`,
      );

      for (const chunk of splitIntoChunks(messageIds, COPY_MESSAGES_CHUNK_LIMIT)) {
        await copyMultipleMessages(chatId, relayState.chatId, chunk, {
          messageThreadId: relayState.messageThreadId,
        });
        const copiedKeys = recordsToCopy
          .filter((item) => chunk.includes(item.messageId) && item.dedupeKey)
          .map((item) => item.dedupeKey);

        for (const copiedKey of copiedKeys) {
          relayDedupeKeys.add(copiedKey);
        }

        if (copiedKeys.length > 0) {
          await saveRelayDedupeState();
        }

        totalCopied += chunk.length;
        console.log(`${logTag} Relay progresso: ${buildRelayProgressLabel(totalCopied, totalMessages, startedAtMs)}`);
      }

      console.log(`${logTag} Relay concluido: ${buildRelayProgressLabel(totalCopied, totalMessages, startedAtMs)}`);
      return totalCopied;
    });

    addRelayDeliveryStats(chatId, copiedCount);
    return true;
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

  function extractTelegramMessageLinks(text) {
    const normalizedText = toText(text);

    if (!normalizedText) {
      return [];
    }

    const rawLinks =
      normalizedText.match(/https?:\/\/(?:t\.me|telegram\.me)\/[^\s<>()]+/gi) || [];
    const refs = [];
    const seenRefs = new Set();

    for (const rawLink of rawLinks) {
      const parsedLink = parseTelegramMessageLink(rawLink);

      if (!parsedLink) {
        continue;
      }

      const refKey = `${parsedLink.fromChatId}:${parsedLink.messageId}`;

      if (seenRefs.has(refKey)) {
        continue;
      }

      seenRefs.add(refKey);
      refs.push(parsedLink);
    }

    return refs;
  }

  function getCommandArgs(text, command) {
    const normalizedText = toText(text);
    const normalizedCommand = toText(command);

    if (!normalizedText || !normalizedCommand) {
      return '';
    }

    return normalizedText.slice(normalizedText.split(/\s+/)[0].length).trim();
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

  function getHistoryRelayModeLabel(mode) {
    return mode === 'media' ? 'somente imagens/videos' : 'tudo';
  }

  function parseHistoryRelayMode(value) {
    const normalizedValue = toText(value)
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .toLowerCase();

    if (['1', 'all', 'tudo', 'todos', 'completo'].includes(normalizedValue)) {
      return 'all';
    }

    if (
      ['2', 'midia', 'midias', 'media', 'medias', 'foto', 'fotos', 'video', 'videos', 'imagens'].includes(
        normalizedValue,
      ) ||
      normalizedValue.includes('imagem') ||
      normalizedValue.includes('video') ||
      normalizedValue.includes('midia')
    ) {
      return 'media';
    }

    return '';
  }

  function getHistoryRelaySourceKeyboard() {
    return {
      remove_keyboard: true,
    };
  }

  function getHistoryRelayModeKeyboard() {
    return {
      keyboard: [[{ text: 'Tudo' }], [{ text: 'Somente imagens/videos' }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  }

  function getHistoryRelayResumeKeyboard() {
    return {
      keyboard: [[{ text: 'Continuar' }], [{ text: 'Recomecar' }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  }

  function getHistoryRelayRestartConfirmKeyboard() {
    return {
      keyboard: [[{ text: 'Continuar' }], [{ text: 'RECOMECAR' }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  }

  function parseHistoryRelayResume(value) {
    const normalizedValue = toText(value)
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .toLowerCase();

    if (['continuar', 'continue', 'retomar', 'resume', 'sim', 's'].includes(normalizedValue)) {
      return true;
    }

    if (['recomecar', 'reiniciar', 'restart', 'nao', 'n'].includes(normalizedValue)) {
      return false;
    }

    return null;
  }

  function isHistoryRelayForwardableMessage(message, mode) {
    if (!message || !Number.isInteger(Number(message.id)) || Number(message.id) <= 0) {
      return false;
    }

    if (String(message.className || '') === 'MessageService') {
      return false;
    }

    if (mode === 'media') {
      const mimeType = toText(message.file?.mimeType).toLowerCase();
      return Boolean(
        message.photo ||
          message.video ||
          mimeType.startsWith('image/') ||
          mimeType.startsWith('video/'),
      );
    }

    return Boolean(message.message || message.media);
  }

  function buildHistoryRelayUnitFromMessages(messages, type) {
    const normalizedMessages = messages
      .filter(Boolean)
      .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

    return {
      type,
      ids: normalizedMessages.map((message) => Number(message.id)),
      lastId: Math.max(...normalizedMessages.map((message) => Number(message.id))),
    };
  }

  function buildHistoryRelayDestinationKey() {
    return `${Number(relayState.chatId || 0)}-${Number(relayState.messageThreadId || 0)}`;
  }

  function buildHistoryRelayStateDir(sourceEntity, sourceChat, mode) {
    const destinationSlug = toSlug(`destino-${buildHistoryRelayDestinationKey()}`, 'destino');
    const folderName = `${resolveEntitySlug(sourceEntity, sourceChat)}-to-${destinationSlug}-${mode}`;
    return path.join(historyRelayConfig.stateDir, folderName);
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

  async function appendJsonLines(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
  }

  async function findHistoryRelayStateFiles(rootDir) {
    const stateFiles = [];

    async function walk(currentDir) {
      let entries = [];

      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          return;
        }

        throw error;
      }

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(entryPath);
          continue;
        }

        if (entry.isFile() && entry.name === '.forward-state.json') {
          stateFiles.push(entryPath);
        }
      }
    }

    await walk(rootDir);
    return stateFiles;
  }

  function normalizeHistoryRelayState(loadedState, sourceChat, mode) {
    if (!loadedState || typeof loadedState !== 'object') {
      return {
        version: 1,
        sourceChat,
        mode,
        sourceTitle: '',
        status: 'new',
        relayDestinationKey: buildHistoryRelayDestinationKey(),
        relayDestinationChatId: Number(relayState.chatId || 0),
        relayDestinationThreadId: Number(relayState.messageThreadId || 0),
        relayDestinationTitle: toText(relayState.destinationTitle) || toText(relayState.chatTitle),
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
      version: 1,
      sourceChat,
      mode,
      sourceTitle: toText(loadedState.sourceTitle),
      status: toText(loadedState.status) || 'saved',
      relayDestinationKey: toText(loadedState.relayDestinationKey) || buildHistoryRelayDestinationKey(),
      relayDestinationChatId: Number(loadedState.relayDestinationChatId || 0),
      relayDestinationThreadId: Number(loadedState.relayDestinationThreadId || 0),
      relayDestinationTitle: toText(loadedState.relayDestinationTitle),
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

  async function saveHistoryRelayState(statePath, state) {
    state.updatedAt = new Date().toISOString();
    await writeJsonFile(statePath, state);
  }

  function isHistoryRelayStateVisible(state) {
    if (!state || typeof state !== 'object') {
      return false;
    }

    if (toText(state.status) === 'completed') {
      return false;
    }

    return (
      normalizePositiveInteger(state.lastProcessedMessageId) > 0 ||
      normalizePositiveInteger(state.forwardedMessages) > 0 ||
      normalizePositiveInteger(state.skippedMessages) > 0 ||
      (Array.isArray(state.failedBatches) && state.failedBatches.length > 0)
    );
  }

  async function loadHistoryRelaySavedJobs({ includeCompleted = false, onlyFailures = false } = {}) {
    const stateFiles = await findHistoryRelayStateFiles(historyRelayConfig.stateDir);
    const jobs = [];

    for (const statePath of stateFiles) {
      const state = await readJsonFile(statePath, null);

      if (!state || typeof state !== 'object') {
        continue;
      }

      if (!includeCompleted && !isHistoryRelayStateVisible(state)) {
        continue;
      }

      if (onlyFailures && (!Array.isArray(state.failedBatches) || state.failedBatches.length === 0)) {
        continue;
      }

      jobs.push({
        statePath,
        stateDir: path.dirname(statePath),
        sourceChat: toText(state.sourceChat),
        sourceTitle: toText(state.sourceTitle) || toText(state.sourceChat) || 'origem',
        mode: toText(state.mode) || 'all',
        status: toText(state.status) || 'saved',
        relayDestinationKey: toText(state.relayDestinationKey),
        relayDestinationChatId: Number(state.relayDestinationChatId || 0),
        relayDestinationThreadId: Number(state.relayDestinationThreadId || 0),
        relayDestinationTitle: toText(state.relayDestinationTitle),
        lastProcessedMessageId: normalizePositiveInteger(state.lastProcessedMessageId),
        forwardedMessages: normalizePositiveInteger(state.forwardedMessages),
        forwardedBatches: normalizePositiveInteger(state.forwardedBatches),
        skippedMessages: normalizePositiveInteger(state.skippedMessages),
        failedBatches: Array.isArray(state.failedBatches) ? state.failedBatches : [],
        updatedAt: toText(state.updatedAt) || toText(state.createdAt),
        state,
      });
    }

    return jobs.sort((left, right) => {
      const rightTime = Date.parse(right.updatedAt || '') || 0;
      const leftTime = Date.parse(left.updatedAt || '') || 0;
      return rightTime - leftTime;
    });
  }

  function buildHistoryRelaySavedJobsKeyboard(jobs) {
    const rows = [];

    for (let index = 0; index < Math.min(jobs.length, 10); index += 1) {
      const jobNumber = index + 1;
      rows.push([{ text: `Continuar ${jobNumber}` }, { text: `Falhas ${jobNumber}` }]);
    }

    rows.push([{ text: 'Cancelar' }]);

    return {
      keyboard: rows,
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  }

  function buildHistoryRelayFailuresKeyboard(jobs) {
    const rows = [];

    for (let index = 0; index < Math.min(jobs.length, 10); index += 1) {
      rows.push([{ text: `Falhas ${index + 1}` }]);
    }

    rows.push([{ text: 'Cancelar' }]);

    return {
      keyboard: rows,
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  }

  function buildHistoryRelaySavedJobsMessage(jobs) {
    if (jobs.length === 0) {
      return `Nao encontrei encaminhamentos pausados/salvos.\n\nPara iniciar um novo, use ${historyRelayConfig.commands.start}.`;
    }

    const lines = [
      'Encaminhamentos pausados/salvos:',
      '',
      ...jobs.slice(0, 10).flatMap((job, index) => [
        `${index + 1}. ${job.sourceTitle}`,
        `   Origem: ${job.sourceTitle} (${job.sourceChat})`,
        `   Destino: ${job.relayDestinationTitle || job.relayDestinationKey || job.relayDestinationChatId || 'sem destino salvo'}`,
        `   Modo: ${getHistoryRelayModeLabel(job.mode)} | status: ${job.status}`,
        `   Encaminhadas: ${formatInteger(job.forwardedMessages)} | falhas: ${formatInteger(job.failedBatches.length)}`,
        `   Ultimo ID: ${job.lastProcessedMessageId} | atualizado: ${job.updatedAt || 'sem data'}`,
        '',
      ]),
      'Cada item tem opcao separada: responda com Continuar 1, Continuar 2, Falhas 1...',
    ];

    return lines.join('\n');
  }

  function buildHistoryRelayFailuresMessage(job, label = '') {
    const failures = Array.isArray(job?.failedBatches) ? job.failedBatches : [];

    if (failures.length === 0) {
      return `${label ? `${label}\n\n` : ''}Nao ha falhas registradas para esse encaminhamento.`;
    }

    const recentFailures = failures.slice(-10).reverse();
    const lines = [
      label || `Falhas de ${job.sourceTitle || job.sourceChat || 'encaminhamento'}`,
      '',
      `Total de falhas registradas: ${formatInteger(failures.length)}`,
      '',
      ...recentFailures.flatMap((failure, index) => [
        `${index + 1}. ${toText(failure.type) || 'lote'} | ids: ${
          Array.isArray(failure.ids) ? failure.ids.join(', ') : 'sem ids'
        }`,
        `   Motivo: ${toText(failure.reason) || 'falha desconhecida'}`,
        `   Quando: ${toText(failure.failedAt) || 'sem data'}`,
        '',
      ]),
    ];

    return lines.join('\n').slice(0, 3900);
  }

  async function estimateHistoryRelayTotalMessages(client, entity) {
    const messages = await client.getMessages(entity, { limit: 1 });
    const totalMessages = Number(messages?.total || messages?.length || 0);
    return Number.isFinite(totalMessages) && totalMessages > 0 ? totalMessages : 0;
  }

  function buildHistoryRelayProgressSnapshot(state, progressRuntime) {
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
    const etaMs =
      ratePerSecond > 0 && remainingMessages > 0 ? (remainingMessages / ratePerSecond) * 1000 : 0;

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

  function logHistoryRelayProgress(state, progressRuntime, label = 'Progresso') {
    const snapshot = buildHistoryRelayProgressSnapshot(state, progressRuntime);
    const percent =
      snapshot.estimatedTotalMessages > 0 ? formatPercent(snapshot.completionRatio * 100) : 'estimando';
    const totalLabel =
      snapshot.estimatedTotalMessages > 0 ? formatInteger(snapshot.estimatedTotalMessages) : '?';
    const etaLabel = snapshot.etaMs > 0 ? formatDuration(snapshot.etaMs) : 'calculando';

    console.log(
      `${logTag} ${label}: ${percent} | lidas: ${formatInteger(
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

  function buildHistoryRelayUnitLabel(unit) {
    if (!unit || !Array.isArray(unit.ids) || unit.ids.length === 0) {
      return 'lote vazio';
    }

    const firstId = unit.ids[0];
    const lastId = unit.ids[unit.ids.length - 1];
    const range = firstId === lastId ? String(firstId) : `${firstId}-${lastId}`;

    return `${unit.type} | ids: ${range} | itens: ${formatInteger(unit.ids.length)}`;
  }

  async function sleepHistoryRelayDelay(job, milliseconds) {
    const normalizedMilliseconds = Math.max(0, Number(milliseconds || 0));

    if (normalizedMilliseconds <= 0 || job?.stopRequested) {
      return;
    }

    const startedAtMs = Date.now();
    let nextLogAtMs = startedAtMs;

    while (Date.now() - startedAtMs < normalizedMilliseconds) {
      if (job?.stopRequested) {
        console.log(`${logTag} Pausa solicitada durante espera anti-flood. Interrompendo intervalo.`);
        return;
      }

      const remainingMs = Math.max(0, normalizedMilliseconds - (Date.now() - startedAtMs));

      if (Date.now() >= nextLogAtMs) {
        console.log(`${logTag} Anti-flood: proximo lote em ${formatDuration(remainingMs)}.`);
        nextLogAtMs = Date.now() + 30000;
      }

      await sleep(Math.min(1000, remainingMs));
    }
  }

  function parseCleanerRetryWaitSeconds(error) {
    const reason = normalizeCleanerUserError(error, '');
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
      return 120;
    }

    return 0;
  }

  function getHistoryRelayFloodRetryWaitSeconds(floodAttempt) {
    return Number(floodAttempt || 0) <= 1
      ? historyRelayConfig.floodRetryFirstWaitSeconds
      : historyRelayConfig.floodRetryNextWaitSeconds;
  }

  async function forwardHistoryRelayUnitWithRetry({
    client,
    sourceInputEntity,
    targetInputEntity,
    unit,
    job,
  }) {
    if (!unit || unit.ids.length === 0) {
      return {
        forwarded: 0,
        skipped: 0,
        reason: '',
      };
    }

    let attempt = 0;
    let floodAttempt = 0;

    while (attempt < 1000) {
      if (job?.stopRequested) {
        return {
          forwarded: 0,
          skipped: 0,
          reason: 'pausado pelo admin antes do lote',
        };
      }

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
        const waitSeconds = parseCleanerRetryWaitSeconds(error);

        if (waitSeconds > 0 && attempt < 1000) {
          floodAttempt += 1;
          const delaySeconds = getHistoryRelayFloodRetryWaitSeconds(floodAttempt);
          const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
          console.log(
            `${logTag} FLOOD/rate limit no lote ${unit.type} (${unit.ids.join(
              ', ',
            )}). Tentativa flood ${floodAttempt}: aguardando ${delaySeconds}s e tentando o MESMO lote novamente. Retorno previsto: ${retryAt}. Motivo: ${normalizeCleanerUserError(
              error,
              'FLOOD',
            )}`,
          );
          await sleepHistoryRelayDelay(job, delaySeconds * 1000);
          continue;
        }

        return {
          forwarded: 0,
          skipped: unit.ids.length,
          reason: normalizeCleanerUserError(error, 'falha ao encaminhar lote'),
        };
      }
    }

    return {
      forwarded: 0,
      skipped: unit.ids.length,
      reason: 'tentativas esgotadas',
    };
  }

  async function processHistoryRelayUnit({
    client,
    sourceInputEntity,
    targetInputEntity,
    unit,
    state,
    statePath,
    forwardLogPath,
    progressRuntime,
    job,
  }) {
    if (!unit || unit.ids.length === 0) {
      return;
    }

    console.log(`${logTag} Lote preparando: ${buildHistoryRelayUnitLabel(unit)}`);

    const result = await forwardHistoryRelayUnitWithRetry({
      client,
      sourceInputEntity,
      targetInputEntity,
      unit,
      job,
    });

    if (result.forwarded > 0) {
      state.forwardedMessages += result.forwarded;
      state.forwardedBatches += 1;

      await appendJsonLines(forwardLogPath, {
        ids: unit.ids,
        type: unit.type,
        forwarded: result.forwarded,
        lastId: unit.lastId,
        forwardedAt: new Date().toISOString(),
      });

      console.log(
        `${logTag} Lote enviado: ${buildHistoryRelayUnitLabel(unit)} | total encaminhado: ${formatInteger(
          state.forwardedMessages,
        )}`,
      );
    }

    if (result.skipped > 0) {
      state.skippedMessages += result.skipped;
      state.failedBatches.push({
        ids: unit.ids,
        type: unit.type,
        reason: result.reason,
        failedAt: new Date().toISOString(),
      });
      console.log(`${logTag} Pulando lote ${unit.type} (${unit.ids.join(', ')}): ${result.reason}`);
    }

    if (result.forwarded === 0 && result.skipped === 0) {
      console.log(`${logTag} Lote nao processado agora: ${buildHistoryRelayUnitLabel(unit)} | motivo: ${result.reason}`);
      return;
    }

    state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, unit.lastId);
    await saveHistoryRelayState(statePath, state);
    logHistoryRelayProgress(state, progressRuntime, `Apos lote ${formatInteger(state.forwardedBatches)}`);

    if (result.forwarded > 0 && job) {
      job.forwardedInCurrentWindow = Math.max(0, Number(job.forwardedInCurrentWindow || 0)) + result.forwarded;
      console.log(
        `${logTag} Janela anti-flood: ${formatInteger(job.forwardedInCurrentWindow)}/${formatInteger(
          historyRelayConfig.batchSize,
        )} midia(s) antes da pausa.`,
      );
    }

    if (
      historyRelayConfig.delayMs > 0 &&
      !job?.stopRequested &&
      Number(job?.forwardedInCurrentWindow || 0) >= historyRelayConfig.batchSize
    ) {
      console.log(
        `${logTag} Janela de ${formatInteger(
          job.forwardedInCurrentWindow,
        )} midia(s) concluida. Pausando ${formatDuration(historyRelayConfig.delayMs)}.`,
      );
      job.forwardedInCurrentWindow = 0;
      await sleepHistoryRelayDelay(job, historyRelayConfig.delayMs);
    }
  }

  async function sendFinalHistoryRelayMessage(client, targetInputEntity) {
    try {
      await client.sendMessage(targetInputEntity, {
        message: relayCommandConfig.doneAliases.includes('/relay_done')
          ? '/relay_done'
          : relayCommandConfig.done,
        silent: true,
      });
    } catch (error) {
      console.log(
        `${logTag} Aviso: nao consegui enviar comando final ao bot: ${normalizeCleanerUserError(
          error,
          'falha desconhecida',
        )}`,
      );
    }
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

  async function disconnectCleanerUserClient(client) {
    if (!client) {
      return;
    }

    try {
      await client.disconnect();
    } catch {
      // Ignora falha ao desconectar cliente temporario.
    }
  }

  function configureCleanerUserClient(client) {
    if (!client) {
      return;
    }

    client.setLogLevel('none');
    client.onError = async (error) => {
      const reason = normalizeCleanerUserError(error, 'Falha desconhecida na conta principal.');

      if (reason === 'TIMEOUT') {
        return;
      }

      console.error(`${logTag} Erro na conta principal: ${reason}`);
    };
  }

  async function buildCleanerUserClient() {
    const sessionStringFromFile =
      cleanerUserConfig.session || cleanerUserConfig.sessionFilePath
        ? await readSessionStringFromDisk(cleanerUserConfig.sessionFilePath)
        : '';
    const sessionString = cleanerUserConfig.session || sessionStringFromFile || '';
    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, Number(cleanerUserConfig.apiId || 0), toText(cleanerUserConfig.apiHash), {
      connectionRetries: 5,
      deviceModel: 'AllPrivacy Uploader',
      systemVersion: 'Windows',
      appVersion: 'AllPrivacy 1.0',
      langCode: 'pt',
      systemLangCode: 'pt-BR',
    });

    configureCleanerUserClient(client);

    return {
      client,
      hasStoredSession: Boolean(sessionString),
    };
  }

  async function finalizeCleanerUserConnection(client) {
    await warmCleanerUserDialogs(client);
    await writeSessionStringToDisk(cleanerUserConfig.sessionFilePath, client.session.save());

    if (cleanerUserClient && cleanerUserClient !== client) {
      await disconnectCleanerUserClient(cleanerUserClient);
    }

    cleanerUserClient = client;
    cleanerUserState.enabled = true;
    cleanerUserState.ready = true;
    cleanerUserState.error = '';

    console.log(`${logTag} Conta principal conectada para copiar links do Telegram.`);
    return client;
  }

  async function promptInTerminal(question) {
    if (!processInput.isTTY || !processOutput.isTTY) {
      throw new Error(
        `Nao ha terminal interativo disponivel para autenticar a conta principal do ${normalizedBotLabel}.`,
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

  async function warmCleanerUserDialogs(client) {
    try {
      await client.getDialogs({ limit: 200 });
    } catch (error) {
      console.error(
        `${logTag} Falha ao aquecer dialogs da conta principal:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function rejectPendingCleanerUserAuthPrompt(authSession, reason) {
    if (!authSession?.awaitingInputReject) {
      return;
    }

    const rejectPrompt = authSession.awaitingInputReject;
    authSession.awaitingInputResolve = null;
    authSession.awaitingInputReject = null;
    authSession.awaitingPrompt = '';
    rejectPrompt(reason instanceof Error ? reason : new Error(String(reason || 'AUTH_USER_CANCEL')));
  }

  function resolvePendingCleanerUserAuthPrompt(authSession, value) {
    if (!authSession?.awaitingInputResolve) {
      return false;
    }

    const resolvePrompt = authSession.awaitingInputResolve;
    authSession.awaitingInputResolve = null;
    authSession.awaitingInputReject = null;
    authSession.awaitingPrompt = '';
    resolvePrompt(toText(value));
    return true;
  }

  async function awaitCleanerUserChatInput(authSession, prompt) {
    if (!authSession || authSession.cancelled) {
      throw new Error('AUTH_USER_CANCEL');
    }

    if (authSession.awaitingInputResolve || authSession.awaitingInputReject) {
      rejectPendingCleanerUserAuthPrompt(authSession, 'AUTH_USER_CANCEL');
    }

    authSession.awaitingPrompt = prompt;
    await sendText(authSession.chatId, prompt);

    return await new Promise((resolve, reject) => {
      authSession.awaitingInputResolve = resolve;
      authSession.awaitingInputReject = reject;
    });
  }

  async function cancelCleanerUserAuth(chatId, notify = true) {
    const authSession = cleanerUserAuthSessions.get(Number(chatId));

    if (!authSession) {
      return false;
    }

    authSession.cancelled = true;
    rejectPendingCleanerUserAuthPrompt(authSession, 'AUTH_USER_CANCEL');
    cleanerUserAuthSessions.delete(Number(chatId));
    await disconnectCleanerUserClient(authSession.activeClient);

    if (!cleanerUserState.ready) {
      cleanerUserState.error = 'Autenticacao cancelada. Use /login para tentar novamente.';
    }

    if (notify) {
      await sendText(chatId, 'Autenticacao da conta principal cancelada.');
    }

    return true;
  }

  async function handleCleanerUserAuthMessage(message) {
    const chatId = Number(message?.chat?.id || 0);
    const authSession = cleanerUserAuthSessions.get(chatId);

    if (!authSession) {
      return false;
    }

    const isForwarded = isForwardedMessage(message);
    const command = isForwarded ? '' : getMessageCommand(message.text);
    const text = toText(message.text);

    if (command === '/cancel') {
      await cancelCleanerUserAuth(chatId, true);
      return true;
    }

    if (authSession.awaitingInputResolve) {
      if (!text) {
        await sendText(chatId, 'Envie o texto solicitado para continuar a autenticacao ou use /cancel.');
        return true;
      }

      if (command) {
        await sendText(chatId, 'Autenticacao em andamento. Envie o dado solicitado ou use /cancel.');
        return true;
      }

      resolvePendingCleanerUserAuthPrompt(authSession, text);
      return true;
    }

    if (command) {
      await sendText(chatId, 'Autenticacao em andamento. Aguarde a proxima etapa ou use /cancel.');
      return true;
    }

    return true;
  }

  async function startCleanerUserLoginByChat(chatId) {
    if (!cleanerUserState.enabled) {
      await sendText(chatId, getCleanerUserUnavailableMessage());
      return;
    }

    if (cleanerUserState.ready && cleanerUserClient) {
      await sendText(chatId, `A conta principal do ${normalizedBotLabel} ja esta conectada.`);
      return;
    }

    if (cleanerUserAuthSessions.has(Number(chatId))) {
      await sendText(chatId, 'Ja existe uma autenticacao em andamento neste chat. Use /cancel se quiser interromper.');
      return;
    }

    const authSession = {
      chatId: Number(chatId),
      cancelled: false,
      awaitingPrompt: '',
      awaitingInputResolve: null,
      awaitingInputReject: null,
      activeClient: null,
    };

    cleanerUserAuthSessions.set(Number(chatId), authSession);
    await sendText(
      chatId,
      `Vamos conectar a conta principal do ${normalizedBotLabel} aqui no chat.\n\nUse /cancel a qualquer momento para abortar.`,
    );

    void (async () => {
      let nextClient = null;

      try {
        const { client } = await buildCleanerUserClient();
        nextClient = client;
        authSession.activeClient = client;

        await client.connect();
        let authorized = await client.checkAuthorization();

        if (!authorized) {
          await client.start({
            phoneNumber: async () =>
              await awaitCleanerUserChatInput(
                authSession,
                cleanerUserConfig.phone
                  ? `Envie o numero da conta principal com +55.\n\nSugestao atual: ${cleanerUserConfig.phone}`
                  : 'Envie o numero da conta principal com +55.',
              ),
            phoneCode: async (isCodeViaApp) =>
              await awaitCleanerUserChatInput(
                authSession,
                isCodeViaApp
                  ? 'Envie o codigo que chegou no app oficial do Telegram.'
                  : 'Envie o codigo que chegou por SMS/Telegram.',
              ),
            password: async (hint) =>
              await awaitCleanerUserChatInput(
                authSession,
                hint
                  ? `Envie a senha 2FA da conta principal.\n\nDica do Telegram: ${hint}`
                  : 'Envie a senha 2FA da conta principal.',
              ),
            onError: async (error) => {
              const reason = normalizeCleanerUserError(error, 'Falha na autenticacao.');

              if (authSession.cancelled || reason === 'AUTH_USER_CANCEL') {
                return true;
              }

              await sendText(
                chatId,
                `Falha durante a autenticacao: ${reason}\n\nEnvie novamente o dado solicitado ou use /cancel.`,
              );
              return false;
            },
          });

          authorized = await client.checkAuthorization();
        }

        if (!authorized) {
          throw new Error(`Nao foi possivel autenticar a conta principal do ${normalizedBotLabel}.`);
        }

        await finalizeCleanerUserConnection(client);
        await sendText(
          chatId,
          'Conta principal conectada com sucesso.\n\nAgora voce ja pode mandar links t.me e eu vou buscar as midias por ela.',
        );
      } catch (error) {
        const reason = normalizeCleanerUserError(
          error,
          `Nao foi possivel autenticar a conta principal do ${normalizedBotLabel}.`,
        );

        if (!authSession.cancelled && reason !== 'AUTH_USER_CANCEL') {
          if (!cleanerUserState.ready) {
            cleanerUserState.error = reason;
          }

          await sendText(
            chatId,
            `Nao consegui concluir a autenticacao da conta principal.\n\nMotivo: ${reason}`,
          );
        }
      } finally {
        cleanerUserAuthSessions.delete(Number(chatId));
        rejectPendingCleanerUserAuthPrompt(authSession, 'AUTH_USER_CANCEL');

        if (nextClient && nextClient !== cleanerUserClient) {
          await disconnectCleanerUserClient(nextClient);
        }
      }
    })();
  }

  async function initCleanerUserClient() {
    const apiId = Number(cleanerUserConfig.apiId || 0);
    const apiHash = toText(cleanerUserConfig.apiHash);

    if (!apiId || !apiHash) {
      cleanerUserState.enabled = false;
      cleanerUserState.ready = false;
      cleanerUserState.error =
        'Configure CLEANER_USER_API_ID e CLEANER_USER_API_HASH para ler links com a conta principal.';
      return null;
    }

    const { client, hasStoredSession } = await buildCleanerUserClient();

    try {
      await client.connect();
      let authorized = await client.checkAuthorization();

      if (!authorized) {
        if (!hasStoredSession && !isTerminalInteractive()) {
          cleanerUserState.ready = false;
          cleanerUserState.error =
            `A conta principal ainda nao foi autenticada. Use /login no ${normalizedBotLabel} para conectar.`;
          await disconnectCleanerUserClient(client);
          return null;
        }

        if (!isTerminalInteractive()) {
          cleanerUserState.ready = false;
          cleanerUserState.error =
            `A sessao da conta principal expirou ou ainda nao foi criada. Use /login no ${normalizedBotLabel} para conectar novamente.`;
          await disconnectCleanerUserClient(client);
          return null;
        }

        console.log(`${logTag} Conta principal ainda nao autenticada. Iniciando login interativo...`);

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
              `${logTag} Falha durante autenticacao da conta principal:`,
              error instanceof Error ? error.message : String(error),
            );
          },
        });

        authorized = await client.checkAuthorization();
      }

      if (!authorized) {
        throw new Error(`Nao foi possivel autenticar a conta principal do ${normalizedBotLabel}.`);
      }

      return await finalizeCleanerUserConnection(client);
    } catch (error) {
      cleanerUserState.ready = false;
      cleanerUserState.error = normalizeCleanerUserError(
        error,
        `Falha ao iniciar a conta principal do ${normalizedBotLabel}.`,
      );
      await disconnectCleanerUserClient(client);

      throw error;
    }
  }

  async function ensureCleanerUserClient() {
    if (!cleanerUserState.enabled) {
      return null;
    }

    if (cleanerUserClient && cleanerUserState.ready) {
      return cleanerUserClient;
    }

    if (!cleanerUserClientInitPromise) {
      cleanerUserClientInitPromise = initCleanerUserClient().finally(() => {
        cleanerUserClientInitPromise = null;
      });
    }

    return cleanerUserClientInitPromise;
  }

  async function resolveCleanerUserEntity(client, fromChatId) {
    const entityReference = String(fromChatId).startsWith('@') ? String(fromChatId) : Number(fromChatId);

    try {
      return await client.getInputEntity(entityReference);
    } catch {
      await warmCleanerUserDialogs(client);
    }

    try {
      return await client.getInputEntity(entityReference);
    } catch (error) {
      throw new Error(
        `Nao consegui acessar ${String(fromChatId)} com a conta principal. Confirme se ela esta no grupo/canal do link.`,
      );
    }
  }

  async function fetchMessagesByIds(client, entity, ids) {
    const validIds = Array.from(
      new Set(
        ids
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    );

    if (validIds.length === 0) {
      return [];
    }

    const messages = await client.getMessages(entity, { ids: validIds });
    return Array.isArray(messages) ? messages.filter(Boolean) : messages ? [messages] : [];
  }

  async function resolveLinkedSourceMessages(client, ref) {
    const entity = await resolveCleanerUserEntity(client, ref.fromChatId);
    const initialMessages = await fetchMessagesByIds(client, entity, [ref.messageId]);
    const sourceMessage = initialMessages[0];

    if (!sourceMessage) {
      throw new Error('Nao encontrei a mensagem apontada pelo link.');
    }

    if (!sourceMessage.groupedId) {
      return [sourceMessage];
    }

    const nearbyIds = [];

    for (let messageId = sourceMessage.id - ALBUM_LOOKAROUND; messageId <= sourceMessage.id + ALBUM_LOOKAROUND; messageId += 1) {
      if (messageId > 0) {
        nearbyIds.push(messageId);
      }
    }

    const nearbyMessages = await fetchMessagesByIds(client, entity, nearbyIds);
    const groupedMessages = nearbyMessages
      .filter((message) => String(message.groupedId || '') === String(sourceMessage.groupedId))
      .sort((left, right) => left.id - right.id);

    return groupedMessages.length > 0 ? groupedMessages : [sourceMessage];
  }

  function buildCleanerUserDeliveryTargets(message) {
    const requesterUserId = Number(message?.from?.id || 0);
    const requesterUsername = toText(message?.from?.username) || toText(message?.chat?.username);

    return getSendTargets(message.chat.id).map((targetChatId) => {
      if (Number(targetChatId) === masterAdminId) {
        return {
          targetChatId: Number(targetChatId),
          deliveryMode: 'bot-chat',
          userId: 0,
          username: '',
        };
      }

      return {
        targetChatId: Number(targetChatId),
        deliveryMode: 'direct-user',
        userId: requesterUserId || Number(targetChatId),
        username: requesterUsername,
      };
    });
  }

  async function resolveCleanerUserBotTarget(client) {
    if (cleanerBotIdentityState.inputPeer) {
      return cleanerBotIdentityState.inputPeer;
    }

    const cleanerBotIdentity = await ensureCleanerBotIdentity();

    if (!cleanerBotIdentity.username && !cleanerBotIdentity.userId) {
      throw new Error('Nao consegui descobrir a identidade do cleaner bot para entregar a copia.');
    }

    const entityReference = cleanerBotIdentity.username
      ? `@${cleanerBotIdentity.username}`
      : Number(cleanerBotIdentity.userId);
    cleanerBotIdentityState.inputPeer = await client.getInputEntity(entityReference);
    return cleanerBotIdentityState.inputPeer;
  }

  async function resolveCleanerUserDirectTarget(client, deliveryTarget) {
    const candidates = [];
    const normalizedUsername = toText(deliveryTarget?.username).replace(/^@/, '');
    const normalizedUserId = Number(deliveryTarget?.userId || 0);

    if (normalizedUsername) {
      candidates.push(`@${normalizedUsername}`);
    }

    if (normalizedUserId > 0) {
      candidates.push(normalizedUserId);
    }

    if (candidates.length === 0) {
      throw new Error('Nao encontrei um usuario valido para receber o envio direto.');
    }

    for (const candidate of candidates) {
      try {
        return await client.getInputEntity(candidate);
      } catch {
        // Tenta o proximo candidato.
      }
    }

    await warmCleanerUserDialogs(client);

    for (const candidate of candidates) {
      try {
        return await client.getInputEntity(candidate);
      } catch {
        // Tenta o proximo candidato.
      }
    }

    throw new Error(
      'Nao consegui abrir conversa direta com esse usuario pela conta principal. Ele precisa ter username publico, estar nos contatos da conta principal ou compartilhar algum chat/grupo acessivel por ela.',
    );
  }

  async function resolveCleanerUserDeliveryTarget(client, deliveryTarget) {
    if (deliveryTarget?.deliveryMode === 'bot-chat') {
      return await resolveCleanerUserBotTarget(client);
    }

    return await resolveCleanerUserDirectTarget(client, deliveryTarget);
  }

  function canCopyMessageMediaWithoutDownload(sourceMessage) {
    return Boolean(sourceMessage?.media && !String(sourceMessage.media?.className || '').includes('WebPage'));
  }

  async function sendCleanerUserMessageCopy(client, targetPeer, sourceMessage) {
    if (!sourceMessage) {
      return [];
    }

    if (canCopyMessageMediaWithoutDownload(sourceMessage)) {
      const sentMessage = await client.sendMessage(targetPeer, {
        message: sourceMessage,
      });
      return normalizeMessagesArray(sentMessage);
    }

    const text = toText(sourceMessage.message);

    if (!text) {
      return [];
    }

    const sentMessage = await client.sendMessage(targetPeer, {
      message: text,
      formattingEntities: sourceMessage.entities,
      linkPreview: Boolean(sourceMessage.webPreview),
    });
    return normalizeMessagesArray(sentMessage);
  }

  async function sendCleanerUserAlbumCopy(client, targetPeer, sourceMessages) {
    const mediaMessages = sourceMessages.filter((message) => canCopyMessageMediaWithoutDownload(message));

    if (mediaMessages.length === 0) {
      return [];
    }

    const sentMessages = await client.sendFile(targetPeer, {
      file: mediaMessages.map((message) => message.media),
      caption: mediaMessages.map((message) => toText(message.message)),
    });

    return normalizeMessagesArray(sentMessages);
  }

  async function sendResolvedMessagesToTarget(client, deliveryTarget, sourceMessages) {
    if (!Array.isArray(sourceMessages) || sourceMessages.length === 0) {
      return 0;
    }

    const targetPeer = await resolveCleanerUserDeliveryTarget(client, deliveryTarget);
    let normalizedSentMessages = [];

    if (
      sourceMessages.length > 1 &&
      sourceMessages.every((message) => canCopyMessageMediaWithoutDownload(message))
    ) {
      normalizedSentMessages = await sendCleanerUserAlbumCopy(client, targetPeer, sourceMessages);
    } else {
      for (const sourceMessage of sourceMessages) {
        const copiedMessages = await sendCleanerUserMessageCopy(client, targetPeer, sourceMessage);
        normalizedSentMessages.push(...copiedMessages);
      }
    }

    if (deliveryTarget?.deliveryMode === 'bot-chat') {
      rememberSuppressedIncomingMessages(deliveryTarget.targetChatId, normalizedSentMessages);
    }

    return normalizedSentMessages.length;
  }

  function buildHistoryRelayJobStatus() {
    if (!activeHistoryRelayJob) {
      return 'Nao ha encaminhamento historico rodando agora.';
    }

    const state = activeHistoryRelayJob.state;
    const progressRuntime = activeHistoryRelayJob.progressRuntime;
    const snapshot =
      state && progressRuntime ? buildHistoryRelayProgressSnapshot(state, progressRuntime) : null;

    return [
      'Encaminhamento historico em andamento.',
      '',
      `Origem: ${activeHistoryRelayJob.sourceTitle} (${activeHistoryRelayJob.sourceChat})`,
      `Modo: ${getHistoryRelayModeLabel(activeHistoryRelayJob.mode)}`,
      `Destino atual: ${relayState.chatId}${relayState.messageThreadId ? ` / topico ${relayState.messageThreadId}` : ''}`,
      snapshot
        ? `Lidas: ${formatInteger(snapshot.scannedMessages)}${
            snapshot.estimatedTotalMessages > 0 ? `/${formatInteger(snapshot.estimatedTotalMessages)}` : ''
          }`
        : '',
      state ? `Encaminhadas: ${formatInteger(state.forwardedMessages)}` : '',
      state ? `Puladas/falhas: ${formatInteger(state.skippedMessages)}` : '',
      snapshot ? `ETA: ${snapshot.etaMs > 0 ? formatDuration(snapshot.etaMs) : 'calculando'}` : '',
      '',
      `Use ${historyRelayConfig.commands.stop} para pedir parada segura.`,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  async function runHistoryRelayJob({ requesterChatId, sourceChat, mode, resume }) {
    if (activeHistoryRelayJob) {
      await sendText(
        requesterChatId,
        `Ja existe um encaminhamento historico rodando.\n\nUse ${historyRelayConfig.commands.status} para ver o status ou ${historyRelayConfig.commands.stop} para parar.`,
      );
      return;
    }

    await ensureRelayStateLoaded();

    if (!relayState.enabled || !relayState.chatId) {
      await sendText(
        requesterChatId,
        `Configure o destino primeiro com ${relayCommandConfig.here} no grupo/topico que vai receber o conteudo.`,
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    let userClient;

    try {
      userClient = await ensureCleanerUserClient();
    } catch (error) {
      await sendText(
        requesterChatId,
        `Nao consegui usar a conta principal agora.\n\nMotivo: ${normalizeCleanerUserError(
          error,
          'Falha ao conectar a conta principal.',
        )}\n\nUse /login para autenticar pelo bot.`,
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    if (!userClient) {
      await sendText(requesterChatId, getCleanerUserUnavailableMessage(), {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    const normalizedSourceChat = normalizeChatReference(sourceChat);

    if (!normalizedSourceChat) {
      await sendText(requesterChatId, 'Origem invalida. Envie @username, -100... ou link t.me.', {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    let sourceEntity;
    let targetEntity;
    let sourceTitle = normalizedSourceChat;

    try {
      sourceEntity = await resolveCleanerUserEntity(userClient, normalizedSourceChat);
      const fullSourceEntity = await userClient.getEntity(sourceEntity).catch(() => null);
      sourceTitle = resolveEntityTitle(fullSourceEntity || sourceEntity, normalizedSourceChat);
      targetEntity = await resolveCleanerUserBotTarget(userClient);
    } catch (error) {
      await sendText(
        requesterChatId,
        `Nao consegui acessar a origem com a conta logada.\n\nMotivo: ${normalizeCleanerUserError(
          error,
          'Falha ao acessar o grupo/canal.',
        )}`,
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    const stateDir = buildHistoryRelayStateDir(sourceEntity, normalizedSourceChat, mode);
    const statePath = path.join(stateDir, '.forward-state.json');
    const forwardLogPath = path.join(stateDir, '.forward-forwarded.jsonl');
    const loadedState = resume ? await readJsonFile(statePath, null) : null;
    const state = normalizeHistoryRelayState(loadedState, normalizedSourceChat, mode);
    const startAfterId = resume ? state.lastProcessedMessageId : 0;
    const estimatedTotalMessages = await estimateHistoryRelayTotalMessages(userClient, sourceEntity);
    const progressRuntime = {
      startedAtMs: Date.now(),
      startScannedMessages: state.scannedMessages,
      estimatedTotalMessages,
    };

    state.sourceChat = normalizedSourceChat;
    state.sourceTitle = sourceTitle;
    state.mode = mode;
    state.status = 'running';
    state.relayDestinationKey = buildHistoryRelayDestinationKey();
    state.relayDestinationChatId = Number(relayState.chatId || 0);
    state.relayDestinationThreadId = Number(relayState.messageThreadId || 0);
    state.relayDestinationTitle =
      toText(relayState.destinationTitle) ||
      toText(relayState.chatTitle) ||
      `${relayState.chatId}${relayState.messageThreadId ? ` / topico ${relayState.messageThreadId}` : ''}`;

    const job = {
      requesterChatId: Number(requesterChatId),
      sourceChat: normalizedSourceChat,
      sourceTitle,
      mode,
      state,
      progressRuntime,
      forwardedInCurrentWindow: 0,
      stopRequested: false,
    };

    if (estimatedTotalMessages > 0) {
      state.estimatedTotalMessages = Math.max(state.estimatedTotalMessages, estimatedTotalMessages);
    }

    activeHistoryRelayJob = job;
    await fs.mkdir(stateDir, { recursive: true });
    await saveHistoryRelayState(statePath, state);
    await sendText(
      requesterChatId,
      [
        'Encaminhamento historico iniciado.',
        '',
        `Origem: ${sourceTitle}`,
        `Modo: ${getHistoryRelayModeLabel(mode)}`,
        `Retomada: ${resume ? 'continuar' : 'recomecar'}`,
        `Destino: ${relayState.chatId}${relayState.messageThreadId ? ` / topico ${relayState.messageThreadId}` : ''}`,
        '',
        'Vou mostrar progresso e ETA no terminal.',
      ].join('\n'),
      { reply_markup: { remove_keyboard: true } },
    );

    void (async () => {
      try {
        console.log(`${logTag} Encaminhamento historico iniciado pelo bot.`);
        console.log(`${logTag} Origem: ${sourceTitle} (${normalizedSourceChat})`);
        console.log(`${logTag} Modo: ${getHistoryRelayModeLabel(mode)}`);
        console.log(
          `${logTag} Destino final configurado: ${relayState.chatId}${
            relayState.messageThreadId ? ` topico ${relayState.messageThreadId}` : ''
          }`,
        );
        console.log(`${logTag} Estado: ${statePath}`);
        console.log(`${logTag} Retomada: ${resume ? 'sim' : 'nao'} | ultimo ID: ${startAfterId}`);
        console.log(`${logTag} Janela anti-flood: ate ${historyRelayConfig.batchSize} midia(s) antes da pausa.`);
        console.log(`${logTag} Pausa entre janelas: ${historyRelayConfig.delayMs}ms`);
        console.log(
          `${logTag} Retry flood: ${historyRelayConfig.floodRetryFirstWaitSeconds}s na primeira batida, ${historyRelayConfig.floodRetryNextWaitSeconds}s nas seguintes.`,
        );
        console.log(`${logTag} Log de varredura a cada ${historyRelayConfig.progressLogInterval} mensagens lidas.`);
        console.log(
          `${logTag} Total estimado de mensagens: ${
            estimatedTotalMessages > 0 ? formatInteger(estimatedTotalMessages) : 'nao consegui estimar'
          }`,
        );
        console.log(`${logTag} Anti-flood ativo: pausa por janela + espera automatica em FLOOD_WAIT/SLOWMODE.`);
        logHistoryRelayProgress(state, progressRuntime, 'Status inicial');

        const iterOptions = {
          reverse: true,
          offsetId: startAfterId,
          waitTime: 1,
        };
        let currentAlbum = [];
        let currentAlbumId = '';
        let pendingSingles = [];

        const flushSingles = async () => {
          if (pendingSingles.length === 0) {
            return;
          }

          const unit = buildHistoryRelayUnitFromMessages(pendingSingles, 'mensagens');
          pendingSingles = [];
          await processHistoryRelayUnit({
            client: userClient,
            sourceInputEntity: sourceEntity,
            targetInputEntity: targetEntity,
            unit,
            state,
            statePath,
            forwardLogPath,
            progressRuntime,
            job,
          });
        };

        const flushAlbum = async () => {
          if (currentAlbum.length === 0) {
            return;
          }

          const unit = buildHistoryRelayUnitFromMessages(currentAlbum, 'album');
          currentAlbum = [];
          currentAlbumId = '';
          await processHistoryRelayUnit({
            client: userClient,
            sourceInputEntity: sourceEntity,
            targetInputEntity: targetEntity,
            unit,
            state,
            statePath,
            forwardLogPath,
            progressRuntime,
            job,
          });
        };

        for await (const sourceMessage of userClient.iterMessages(sourceEntity, iterOptions)) {
          if (job.stopRequested) {
            console.log(`${logTag} Parada solicitada. Salvando estado no ID ${state.lastProcessedMessageId}.`);
            break;
          }

          const messageId = Number(sourceMessage?.id || 0);

          if (messageId <= startAfterId) {
            continue;
          }

          state.scannedMessages += 1;

          if (!isHistoryRelayForwardableMessage(sourceMessage, mode)) {
            await flushSingles();
            await flushAlbum();
            state.skippedMessages += 1;
            state.lastProcessedMessageId = Math.max(state.lastProcessedMessageId, messageId);
            await saveHistoryRelayState(statePath, state);
          } else {
            const groupedId = sourceMessage.groupedId ? String(sourceMessage.groupedId) : '';

            if (groupedId) {
              await flushSingles();

              if (currentAlbumId && currentAlbumId !== groupedId) {
                await flushAlbum();
              }

              currentAlbumId = groupedId;
              currentAlbum.push(sourceMessage);
            } else {
              await flushAlbum();
              pendingSingles.push(sourceMessage);

              if (pendingSingles.length >= historyRelayConfig.batchSize) {
                await flushSingles();
              }
            }
          }

          const processedThisRun = state.scannedMessages - progressRuntime.startScannedMessages;

          if (processedThisRun > 0 && processedThisRun % historyRelayConfig.progressLogInterval === 0) {
            logHistoryRelayProgress(state, progressRuntime);
          }
        }

        if (!job.stopRequested) {
          await flushSingles();
          await flushAlbum();
        }

        state.status = job.stopRequested ? 'paused' : 'completed';
        await saveHistoryRelayState(statePath, state);
        logHistoryRelayProgress(state, progressRuntime, job.stopRequested ? 'Status pausado' : 'Status final');
        console.log(
          `${logTag} Encaminhamento historico ${job.stopRequested ? 'pausado' : 'concluido'}.`,
        );
        console.log(`${logTag} Mensagens encaminhadas: ${formatInteger(state.forwardedMessages)}`);
        console.log(`${logTag} Lotes encaminhados: ${formatInteger(state.forwardedBatches)}`);
        console.log(`${logTag} Mensagens puladas/falhas: ${formatInteger(state.skippedMessages)}`);
        console.log(`${logTag} Falhas registradas: ${formatInteger(state.failedBatches.length)}`);
        console.log(`${logTag} Ultimo ID salvo: ${state.lastProcessedMessageId}`);
        console.log(`${logTag} Estado para retomada: ${statePath}`);

        if (!job.stopRequested) {
          await sendFinalHistoryRelayMessage(userClient, targetEntity);
        }

        await sendText(
          requesterChatId,
          [
            job.stopRequested ? 'Encaminhamento pausado com estado salvo.' : 'Encaminhamento historico concluido.',
            '',
            `Origem: ${sourceTitle}`,
            `Modo: ${getHistoryRelayModeLabel(mode)}`,
            `Encaminhadas: ${formatInteger(state.forwardedMessages)}`,
            `Lotes: ${formatInteger(state.forwardedBatches)}`,
            `Puladas/falhas: ${formatInteger(state.skippedMessages)}`,
            `Ultimo ID salvo: ${state.lastProcessedMessageId}`,
          ].join('\n'),
        );
      } catch (error) {
        const reason = normalizeCleanerUserError(error, 'Falha no encaminhamento historico.');
        state.status = 'failed';
        state.lastError = reason;
        await saveHistoryRelayState(statePath, state).catch(() => {});
        console.error(`${logTag} Encaminhamento historico falhou: ${reason}`);
        await sendText(
          requesterChatId,
          `Encaminhamento historico falhou.\n\nMotivo: ${reason}\n\nO estado salvo pode ser retomado depois.`,
        );
      } finally {
        if (activeHistoryRelayJob === job) {
          activeHistoryRelayJob = null;
        }
      }
    })();
  }

  async function prepareHistoryRelayStart(message, session) {
    await sendText(message.chat.id, 'Conferindo origem e estado salvo...', {
      reply_markup: { remove_keyboard: true },
    });

    await ensureRelayStateLoaded();

    if (!relayState.enabled || !relayState.chatId) {
      historyRelaySessions.delete(Number(message.chat.id));
      await sendText(
        message.chat.id,
        `Configure o destino primeiro com ${relayCommandConfig.here} no grupo/topico que vai receber o conteudo.`,
      );
      return;
    }

    let userClient;

    try {
      userClient = await ensureCleanerUserClient();
    } catch (error) {
      historyRelaySessions.delete(Number(message.chat.id));
      await sendText(
        message.chat.id,
        `Nao consegui usar a conta principal agora.\n\nMotivo: ${normalizeCleanerUserError(
          error,
          'Falha ao conectar a conta principal.',
        )}\n\nUse /login para autenticar pelo bot.`,
      );
      return;
    }

    if (!userClient) {
      historyRelaySessions.delete(Number(message.chat.id));
      await sendText(message.chat.id, getCleanerUserUnavailableMessage());
      return;
    }

    const normalizedSourceChat = normalizeChatReference(session.sourceChat);

    try {
      const sourceEntity = await resolveCleanerUserEntity(userClient, normalizedSourceChat);
      const fullSourceEntity = await userClient.getEntity(sourceEntity).catch(() => null);
      const sourceTitle = resolveEntityTitle(fullSourceEntity || sourceEntity, normalizedSourceChat);
      const stateDir = buildHistoryRelayStateDir(sourceEntity, normalizedSourceChat, session.mode);
      const statePath = path.join(stateDir, '.forward-state.json');
      const loadedState = await readJsonFile(statePath, null);
      const normalizedState = normalizeHistoryRelayState(loadedState, normalizedSourceChat, session.mode);
      const hasSavedProgress = normalizedState.lastProcessedMessageId > 0 || normalizedState.forwardedMessages > 0;

      session.sourceChat = normalizedSourceChat;
      session.sourceTitle = sourceTitle;

      if (hasSavedProgress) {
        session.step = 'awaitingResume';
        await sendText(
          message.chat.id,
          [
            'Encontrei um estado salvo para essa origem.',
            '',
            `Origem: ${sourceTitle}`,
            `Modo: ${getHistoryRelayModeLabel(session.mode)}`,
            `Ultimo ID salvo: ${normalizedState.lastProcessedMessageId}`,
            `Ja encaminhadas: ${formatInteger(normalizedState.forwardedMessages)}`,
            '',
            'Quer continuar de onde parou ou recomecar do zero?',
          ].join('\n'),
          { reply_markup: getHistoryRelayResumeKeyboard() },
        );
        return;
      }

      historyRelaySessions.delete(Number(message.chat.id));
      await runHistoryRelayJob({
        requesterChatId: message.chat.id,
        sourceChat: normalizedSourceChat,
        mode: session.mode,
        resume: true,
      });
    } catch (error) {
      historyRelaySessions.delete(Number(message.chat.id));
      await sendText(
        message.chat.id,
        `Nao consegui acessar essa origem.\n\nMotivo: ${normalizeCleanerUserError(
          error,
          'Falha ao acessar grupo/canal.',
        )}`,
      );
    }
  }

  function parseHistoryRelaySavedAction(text) {
    const normalizedText = toText(text)
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .toLowerCase();
    const match = normalizedText.match(/^(continuar|continue|falhas|falha|erros|erro)\s+(\d+)$/);

    if (!match) {
      return null;
    }

    const action = ['continuar', 'continue'].includes(match[1]) ? 'continue' : 'failures';
    const index = Number(match[2]) - 1;

    return Number.isInteger(index) && index >= 0 ? { action, index } : null;
  }

  async function continueHistoryRelaySavedJob(message, job) {
    await ensureRelayStateLoaded();

    if (!relayState.enabled || !relayState.chatId) {
      await sendText(
        message.chat.id,
        `Configure o destino primeiro com ${relayCommandConfig.here} no grupo/topico que vai receber o conteudo.`,
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    const currentDestinationKey = buildHistoryRelayDestinationKey();

    if (job.relayDestinationKey && job.relayDestinationKey !== currentDestinationKey) {
      await sendText(
        message.chat.id,
        [
          'Esse encaminhamento salvo pertence a outro destino.',
          '',
          `Destino salvo: ${job.relayDestinationTitle || job.relayDestinationKey}`,
          `Destino atual: ${relayState.destinationTitle || currentDestinationKey}`,
          '',
          `Use ${relayCommandConfig.here} no grupo/topico correto e depois tente Continuar novamente.`,
        ].join('\n'),
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    await runHistoryRelayJob({
      requesterChatId: message.chat.id,
      sourceChat: job.sourceChat,
      mode: job.mode,
      resume: true,
    });
  }

  async function showHistoryRelaySavedJobs(message) {
    const jobs = await loadHistoryRelaySavedJobs();

    if (jobs.length === 0) {
      historyRelaySessions.delete(Number(message.chat.id));
      await sendText(message.chat.id, buildHistoryRelaySavedJobsMessage(jobs), {
        reply_markup: { remove_keyboard: true },
      });
      return true;
    }

    historyRelaySessions.set(Number(message.chat.id), {
      step: 'awaitingSavedAction',
      savedJobs: jobs.slice(0, 10),
    });
    await sendText(message.chat.id, buildHistoryRelaySavedJobsMessage(jobs), {
      reply_markup: buildHistoryRelaySavedJobsKeyboard(jobs),
    });
    return true;
  }

  async function showHistoryRelayFailures(message, selectedIndex = null) {
    const jobsWithFailures = await loadHistoryRelaySavedJobs({ includeCompleted: true, onlyFailures: true });

    if (selectedIndex != null) {
      const job = jobsWithFailures[selectedIndex];

      if (!job) {
        await sendText(message.chat.id, 'Nao encontrei esse numero na lista de falhas.', {
          reply_markup: { remove_keyboard: true },
        });
        return true;
      }

      await sendText(
        message.chat.id,
        buildHistoryRelayFailuresMessage(job, `Falhas ${selectedIndex + 1}: ${job.sourceTitle}`),
        { reply_markup: { remove_keyboard: true } },
      );
      return true;
    }

    if (activeHistoryRelayJob?.state?.failedBatches?.length > 0) {
      await sendText(
        message.chat.id,
        buildHistoryRelayFailuresMessage(
          {
            sourceTitle: activeHistoryRelayJob.sourceTitle,
            sourceChat: activeHistoryRelayJob.sourceChat,
            failedBatches: activeHistoryRelayJob.state.failedBatches,
          },
          `Falhas do job ativo: ${activeHistoryRelayJob.sourceTitle}`,
        ),
      );
      return true;
    }

    if (jobsWithFailures.length === 0) {
      await sendText(message.chat.id, 'Nao ha falhas salvas nos encaminhamentos.', {
        reply_markup: { remove_keyboard: true },
      });
      return true;
    }

    historyRelaySessions.set(Number(message.chat.id), {
      step: 'awaitingFailuresAction',
      savedJobs: jobsWithFailures.slice(0, 10),
    });

    await sendText(
      message.chat.id,
      [
        'Encaminhamentos com falhas:',
        '',
        ...jobsWithFailures.slice(0, 10).flatMap((job, index) => [
          `${index + 1}. ${job.sourceTitle}`,
          `   Origem: ${job.sourceTitle} (${job.sourceChat})`,
          `   Destino: ${job.relayDestinationTitle || job.relayDestinationKey || job.relayDestinationChatId || 'sem destino salvo'}`,
          `   Modo: ${getHistoryRelayModeLabel(job.mode)} | falhas: ${formatInteger(job.failedBatches.length)}`,
          `   Atualizado: ${job.updatedAt || 'sem data'}`,
          '',
        ]),
        'Responda com Falhas 1 para ver detalhes.',
      ].join('\n'),
      { reply_markup: buildHistoryRelayFailuresKeyboard(jobsWithFailures) },
    );
    return true;
  }

  async function handleHistoryRelayMessage(message, command) {
    if (!historyRelayConfig.enabled) {
      return false;
    }

    const chatId = Number(message.chat.id);
    const session = historyRelaySessions.get(chatId);

    if (command === historyRelayConfig.commands.stop) {
      if (!activeHistoryRelayJob) {
        await sendText(message.chat.id, 'Nao ha encaminhamento historico rodando agora.');
        return true;
      }

      activeHistoryRelayJob.stopRequested = true;
      await sendText(message.chat.id, 'Pedido de parada recebido. Vou pausar no proximo ponto seguro.');
      return true;
    }

    if (command === historyRelayConfig.commands.status) {
      await sendText(message.chat.id, buildHistoryRelayJobStatus());
      return true;
    }

    if (historyRelayConfig.aliasCommands.includes(command)) {
      const action = toText(getCommandArgs(message.text, command)).toLowerCase();
      const aliasLabel = command;

      if (['pausados', 'pausado', 'salvos', 'salvo'].includes(action)) {
        return await showHistoryRelaySavedJobs(message);
      }

      if (['falhas', 'falha', 'erros', 'erro'].includes(action)) {
        return await showHistoryRelayFailures(message);
      }

      await sendText(
        message.chat.id,
        [
          'Comandos de encaminhamento:',
          `${aliasLabel} pausados - listar encaminhamentos pausados/salvos`,
          `${aliasLabel} falhas - listar falhas salvas`,
          `${historyRelayConfig.commands.start} - iniciar novo encaminhamento`,
        ].join('\n'),
      );
      return true;
    }

    if (command === historyRelayConfig.commands.paused) {
      return await showHistoryRelaySavedJobs(message);
    }

    if (command === historyRelayConfig.commands.failures) {
      const selectedIndex = normalizePositiveInteger(getCommandArgs(message.text, command));
      return await showHistoryRelayFailures(message, selectedIndex > 0 ? selectedIndex - 1 : null);
    }

    if (command === '/cancel' && session) {
      historyRelaySessions.delete(chatId);
      await sendText(message.chat.id, 'Encaminhamento historico cancelado.', {
        reply_markup: { remove_keyboard: true },
      });
      return true;
    }

    if (command === historyRelayConfig.commands.start) {
      if (message.chat.type !== 'private') {
        await sendText(
          message.chat.id,
          `Use ${historyRelayConfig.commands.start} no privado do bot ${normalizedBotLabel}.`,
        );
        return true;
      }

      if (activeHistoryRelayJob) {
        await sendText(message.chat.id, buildHistoryRelayJobStatus());
        return true;
      }

      const sourceArg = getCommandArgs(message.text, command);
      const nextSession = {
        step: sourceArg ? 'awaitingMode' : 'awaitingSource',
        sourceChat: sourceArg,
        mode: '',
      };

      historyRelaySessions.set(chatId, nextSession);

      if (sourceArg) {
        await sendText(
          message.chat.id,
          'Escolha o que encaminhar dessa origem:',
          { reply_markup: getHistoryRelayModeKeyboard() },
        );
        return true;
      }

      await sendText(
        message.chat.id,
        [
          'Envie o codigo/link do grupo ou canal de origem.',
          '',
          'Aceito exemplos como:',
          '@nome_do_canal',
          '-1001234567890',
          'https://t.me/c/1234567890/55',
        ].join('\n'),
        { reply_markup: getHistoryRelaySourceKeyboard() },
      );
      return true;
    }

    if (!session) {
      return false;
    }

    const text = toText(message.text);

    if (!text) {
      await sendText(message.chat.id, 'Envie uma resposta em texto ou use /cancel.');
      return true;
    }

    if (toText(text).toLowerCase() === 'cancelar') {
      historyRelaySessions.delete(chatId);
      await sendText(message.chat.id, 'Operacao cancelada.', {
        reply_markup: { remove_keyboard: true },
      });
      return true;
    }

    if (command) {
      await sendText(message.chat.id, 'Fluxo de encaminhamento em andamento. Responda a etapa atual ou use /cancel.');
      return true;
    }

    if (session.step === 'awaitingSavedAction' || session.step === 'awaitingFailuresAction') {
      const savedAction = parseHistoryRelaySavedAction(text);

      if (!savedAction) {
        await sendText(message.chat.id, 'Responda com Continuar 1, Falhas 1 ou Cancelar.', {
          reply_markup:
            session.step === 'awaitingSavedAction'
              ? buildHistoryRelaySavedJobsKeyboard(session.savedJobs || [])
              : buildHistoryRelayFailuresKeyboard(session.savedJobs || []),
        });
        return true;
      }

      if (session.step === 'awaitingFailuresAction' && savedAction.action !== 'failures') {
        await sendText(message.chat.id, 'Nesta lista, responda com Falhas 1 ou Cancelar.', {
          reply_markup: buildHistoryRelayFailuresKeyboard(session.savedJobs || []),
        });
        return true;
      }

      const selectedJob = (session.savedJobs || [])[savedAction.index];

      if (!selectedJob) {
        await sendText(message.chat.id, 'Nao encontrei esse numero na lista atual. Use o comando novamente.', {
          reply_markup: { remove_keyboard: true },
        });
        historyRelaySessions.delete(chatId);
        return true;
      }

      if (savedAction.action === 'failures') {
        await sendText(
          message.chat.id,
          buildHistoryRelayFailuresMessage(selectedJob, `Falhas ${savedAction.index + 1}: ${selectedJob.sourceTitle}`),
          { reply_markup: { remove_keyboard: true } },
        );
        historyRelaySessions.delete(chatId);
        return true;
      }

      historyRelaySessions.delete(chatId);
      await continueHistoryRelaySavedJob(message, selectedJob);
      return true;
    }

    if (session.step === 'awaitingSource') {
      session.sourceChat = text;
      session.step = 'awaitingMode';
      await sendText(message.chat.id, 'Escolha o que encaminhar dessa origem:', {
        reply_markup: getHistoryRelayModeKeyboard(),
      });
      return true;
    }

    if (session.step === 'awaitingMode') {
      const mode = parseHistoryRelayMode(text);

      if (!mode) {
        await sendText(message.chat.id, 'Escolha uma opcao valida: Tudo ou Somente imagens/videos.', {
          reply_markup: getHistoryRelayModeKeyboard(),
        });
        return true;
      }

      session.mode = mode;
      await prepareHistoryRelayStart(message, session);
      return true;
    }

    if (session.step === 'awaitingResume') {
      const resume = parseHistoryRelayResume(text);

      if (resume == null) {
        await sendText(message.chat.id, 'Escolha uma opcao valida: Continuar ou Recomecar.', {
          reply_markup: getHistoryRelayResumeKeyboard(),
        });
        return true;
      }

      if (!resume) {
        session.step = 'awaitingRestartConfirm';
        await sendText(
          message.chat.id,
          [
            'Confirmacao extra necessaria.',
            '',
            'Recomecar ignora o progresso salvo dessa origem/modo/destino.',
            'Para confirmar, envie exatamente:',
            '',
            'RECOMECAR',
            '',
            'Ou envie Continuar para manter o progresso salvo.',
          ].join('\n'),
          { reply_markup: getHistoryRelayRestartConfirmKeyboard() },
        );
        return true;
      }

      historyRelaySessions.delete(chatId);
      await runHistoryRelayJob({
        requesterChatId: message.chat.id,
        sourceChat: session.sourceChat,
        mode: session.mode,
        resume: true,
      });
      return true;
    }

    if (session.step === 'awaitingRestartConfirm') {
      const normalizedText = toText(text).toUpperCase();

      if (parseHistoryRelayResume(text) === true) {
        historyRelaySessions.delete(chatId);
        await runHistoryRelayJob({
          requesterChatId: message.chat.id,
          sourceChat: session.sourceChat,
          mode: session.mode,
          resume: true,
        });
        return true;
      }

      if (normalizedText !== 'RECOMECAR') {
        await sendText(
          message.chat.id,
          'Para recomecar, envie exatamente RECOMECAR. Para manter o progresso salvo, envie Continuar.',
          { reply_markup: getHistoryRelayRestartConfirmKeyboard() },
        );
        return true;
      }

      historyRelaySessions.delete(chatId);
      await runHistoryRelayJob({
        requesterChatId: message.chat.id,
        sourceChat: session.sourceChat,
        mode: session.mode,
        resume: false,
      });
      return true;
    }

    return false;
  }

  async function handleLinkedMessagesWithBotApi(message, refs) {
    const chatId = message.chat.id;
    const sendTargets = getSendTargets(chatId);
    const refsBySourceChat = new Map();

    for (const ref of refs) {
      const currentMessageIds = refsBySourceChat.get(ref.fromChatId) || [];
      currentMessageIds.push(ref.messageId);
      refsBySourceChat.set(ref.fromChatId, currentMessageIds);
    }

    let copiedCount = 0;
    const failures = [];

    for (const [fromChatId, messageIds] of refsBySourceChat.entries()) {
      const normalizedMessageIds = Array.from(new Set(messageIds)).sort((left, right) => left - right);

      for (const targetId of sendTargets) {
        try {
          for (const chunk of splitIntoChunks(normalizedMessageIds, COPY_MESSAGES_CHUNK_LIMIT)) {
            await copyMultipleMessages(fromChatId, targetId, chunk);
          }

          if (targetId === chatId) {
            copiedCount += normalizedMessageIds.length;
          }
        } catch (error) {
          if (targetId !== chatId) {
            continue;
          }

          failures.push({
            fromChatId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (copiedCount > 0 && failures.length === 0) {
      await sendText(
        chatId,
        `Link processado com sucesso.\n\nCopiei ${copiedCount} mensagem(ns)/midia(s) usando o acesso do bot.`,
      );
      return true;
    }

    if (copiedCount > 0) {
      await sendText(
        chatId,
        `Copiei ${copiedCount} item(ns), mas algumas copias falharam.\n\nPrimeiro erro: ${failures[0]?.error || 'falha desconhecida'}`,
      );
      return true;
    }

    await sendText(
      chatId,
      `Nao consegui copiar esse link com o acesso do bot.\n\nMotivo: ${failures[0]?.error || 'o bot nao conseguiu acessar a mensagem.'}`,
    );
    return true;
  }

  async function handleLinkedMessages(message) {
    const chatId = message.chat.id;
    const refs = extractTelegramMessageLinks(message.text);

    if (refs.length === 0) {
      return false;
    }

    if (!cleanerUserState.enabled) {
      return handleLinkedMessagesWithBotApi(message, refs);
    }

    let userClient;

    try {
      userClient = await ensureCleanerUserClient();
    } catch (error) {
      const reason = normalizeCleanerUserError(error, 'Falha ao conectar a conta principal.');
      await sendText(
        chatId,
        `Nao consegui usar a conta principal do ${normalizedBotLabel} agora.\n\nMotivo: ${reason}\n\nUse /login neste chat para autenticar a conta principal sem depender do terminal.`,
      );
      return true;
    }

    if (!userClient) {
      await sendText(chatId, getCleanerUserUnavailableMessage());
      return true;
    }

    const sendTargets = buildCleanerUserDeliveryTargets(message);
    const processedBatches = new Set();
    const failures = [];
    let deliveredBatches = 0;
    let deliveredMessages = 0;

    for (const ref of refs) {
      try {
        const sourceMessages = await resolveLinkedSourceMessages(userClient, ref);
        const batchKey = buildMessageBatchKey(ref.fromChatId, sourceMessages);

        if (processedBatches.has(batchKey)) {
          continue;
        }

        processedBatches.add(batchKey);

        for (const target of sendTargets) {
          try {
            const deliveredToTarget = await sendResolvedMessagesToTarget(
              userClient,
              target,
              sourceMessages,
            );

            if (target.targetChatId === Number(chatId)) {
              deliveredBatches += 1;
              deliveredMessages += deliveredToTarget;
            }
          } catch (error) {
            if (target.targetChatId !== Number(chatId)) {
              continue;
            }

            throw error;
          }
        }
      } catch (error) {
        const normalizedError = normalizeCleanerUserError(
          error,
          'Falha ao copiar a mensagem com a conta principal.',
        );
        failures.push({
          link: ref.rawLink,
          error:
            normalizedError === 'CHAT_FORWARDS_RESTRICTED'
              ? 'O Telegram bloqueou a copia por referencia porque a origem protege encaminhamento. Nesse caso, sem baixar e reenviar, nao ha como duplicar essa midia.'
              : normalizedError,
        });
      }
    }

    if (deliveredMessages > 0 && failures.length === 0) {
      await sendText(
        chatId,
        `Link processado com sucesso.\n\nEntreguei ${deliveredMessages} mensagem(ns)/midia(s) em ${deliveredBatches} lote(s).`,
      );
      return true;
    }

    if (deliveredMessages > 0) {
      await sendText(
        chatId,
        `Entrega parcial concluida.\n\nForam entregues ${deliveredMessages} mensagem(ns)/midia(s), mas houve falha em alguns links.\n\nPrimeiro erro: ${failures[0]?.error || 'falha desconhecida'}`,
      );
      return true;
    }

    await sendText(
      chatId,
      `Nao consegui copiar esse link.\n\nMotivo: ${failures[0]?.error || 'a conta principal nao conseguiu acessar a mensagem.'}`,
    );
    return true;
  }

  async function flushBuffer(chatId) {
    const buffer = chatBuffers.get(chatId);

    if (!buffer || buffer.messages.length === 0) {
      return;
    }

    chatBuffers.delete(chatId);

    if (buffer.relayMode && (await flushRelayBuffer(chatId, buffer))) {
      return;
    }

    let currentGroup = [];
    const sendTargets = getSendTargets(chatId);

    const sendCurrentGroup = async () => {
      if (currentGroup.length === 0) {
        return;
      }

      for (const targetId of sendTargets) {
        if (currentGroup.length === 1) {
          const sourceMessage = currentGroup[0].msg;
          await copySingleMessage(chatId, targetId, sourceMessage.message_id);
          continue;
        }

        for (const chunk of splitIntoChunks(currentGroup, MEDIA_GROUP_CHUNK_LIMIT)) {
          const media = chunk.map((item) => item.mediaInfo);

          try {
            await telegramRequest('sendMediaGroup', {
              chat_id: targetId,
              media,
            });
          } catch (error) {
            console.error(
              `${logTag} Erro sendMediaGroup:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }

      currentGroup = [];
    };

    for (const sourceMessage of buffer.messages) {
      const mediaInfo = getMediaInfo(sourceMessage);

      if (mediaInfo) {
        currentGroup.push({ msg: sourceMessage, mediaInfo });
        continue;
      }

      await sendCurrentGroup();

      for (const targetId of sendTargets) {
        await copySingleMessage(chatId, targetId, sourceMessage.message_id);
      }
    }

    await sendCurrentGroup();
  }

  async function handleMessage(message) {
    if (!message?.from?.id || !message?.chat?.id) {
      return;
    }

    if (!adminIds.includes(message.from.id)) {
      await sendText(
        message.chat.id,
        'Acesso negado.\n\nEste bot e de uso exclusivo/privado.',
      );
      return;
    }

    if (consumeSuppressedIncomingMessage(message.chat.id, message.message_id)) {
      return;
    }

    if (await handleCleanerUserAuthMessage(message)) {
      return;
    }

    const isForwarded = isForwardedMessage(message);
    const command = isForwarded ? '' : getMessageCommand(message.text);

    if (command === '/login') {
      if (Number(message.from.id) !== masterAdminId) {
        await sendText(
          message.chat.id,
          `Somente o admin principal pode autenticar a conta principal do ${normalizedBotLabel}.`,
        );
        return;
      }

      await startCleanerUserLoginByChat(message.chat.id);
      return;
    }

    if (command === '/status') {
      await sendText(message.chat.id, getCleanerUserUnavailableMessage());
      return;
    }

    if (await handleHistoryRelayMessage(message, command)) {
      return;
    }

    if (command === '/cancel') {
      await sendText(message.chat.id, 'Nao ha nenhuma autenticacao em andamento neste chat.');
      return;
    }

    if (await handleRelayCommand(message, command)) {
      return;
    }

    if (command === '/start' || command === '/help') {
      await sendText(
        message.chat.id,
        [
          'Ola Mestre!',
          `Este e o ${normalizedBotLabel}. Envie ou encaminhe varias midias para eu reagrupar sem a tag de encaminhado.`,
          '',
          'Tambem aceito links de mensagens do Telegram (t.me/...) para buscar as mensagens com a conta principal e reenviar aqui.',
          '',
          'Relay para topicos:',
          `${relayCommandConfig.here} - use dentro do topico destino para ativar`,
          `${relayCommandConfig.status} - ver destino atual`,
          `${relayCommandConfig.on} - ligar relay`,
          `${relayCommandConfig.off} - desligar relay`,
          `${relayCommandConfig.summary} - resumo do encaminhamento atual`,
          `${relayCommandConfig.done} - resumo final e zera contagem`,
          ...(historyRelayConfig.enabled
            ? [
                '',
                'Encaminhamento historico pelo bot:',
                `${historyRelayConfig.commands.start} - informar origem, modo e retomada`,
                `${historyRelayConfig.commands.status} - ver job atual`,
                `${historyRelayConfig.commands.paused} - listar pausados/salvos`,
                `${historyRelayConfig.commands.failures} - ver falhas salvas`,
                `${historyRelayConfig.commands.stop} - pausar e manter estado salvo`,
              ]
            : []),
          '',
          'Comandos:',
          '/login - autentica a conta principal por este chat',
          '/status - mostra o estado da conta principal',
          '/cancel - cancela uma autenticacao em andamento',
        ].join('\n'),
      );
      return;
    }

    if (!isForwarded && message.text && (await handleLinkedMessages(message))) {
      return;
    }

    const chatId = message.chat.id;
    const relayMode = message.chat.type === 'private';

    if (!chatBuffers.has(chatId)) {
      chatBuffers.set(chatId, {
        messages: [],
        timeout: null,
        relayMode,
      });
    }

    const buffer = chatBuffers.get(chatId);
    buffer.relayMode = Boolean(buffer.relayMode || relayMode);
    buffer.messages.push(message);

    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
    }

    buffer.timeout = setTimeout(() => {
      void flushBuffer(chatId).catch((error) => {
        console.error(
          `${logTag} Erro ao reagrupar midias recebidas:`,
          error instanceof Error ? error.message : String(error),
        );
      });
    }, BUFFER_FLUSH_MS);
  }

  async function poll() {
    try {
      await ensureUpdateStateLoaded();

      if (!hasLoggedPollingStart) {
        hasLoggedPollingStart = true;
        console.log(`${logTag} Polling iniciado. Aguardando mensagens...`);
      }

      const response = await fetch(
        `${apiBase}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`,
      );

      if (response.ok) {
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);

            if (update.message) {
              await handleMessage(update.message);
            }

            await saveUpdateState();
          }
        }
      }
    } catch (error) {
      console.error(
        `${logTag} erro polling`,
        error instanceof Error ? error.message : String(error),
      );
    }

    setTimeout(poll, POLL_RETRY_MS);
  }

  void configureBotCommandMenu();
  setTimeout(poll, 0);
  return {
    enabled: true,
    userClientEnabled: cleanerUserState.enabled,
  };
}
