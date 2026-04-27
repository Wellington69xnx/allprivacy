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
const RELAY_STATE_PATH = path.resolve(process.cwd(), 'storage', 'cleaner-relay-state.json');

export function startCleanerBot({ token, adminIds, userClientConfig }) {
  if (!token) {
    return { enabled: false };
  }

  const apiBase = `https://api.telegram.org/bot${token}`;
  const masterAdminId = 8018785433;
  const chatBuffers = new Map();
  const relayDeliveryStats = new Map();
  const cleanerUserAuthSessions = new Map();
  const suppressedIncomingMessageIdsByChat = new Map();
  let relayState = {
    enabled: false,
    chatId: 0,
    messageThreadId: 0,
    configuredBy: 0,
    updatedAt: '',
  };
  let relayStateLoadPromise = null;
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
        const rawState = await fs.readFile(RELAY_STATE_PATH, 'utf8');
        relayState = normalizeRelayState(JSON.parse(rawState));
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
          console.error(
            '[cleaner-bot] Falha ao carregar estado do relay:',
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
    await fs.mkdir(path.dirname(RELAY_STATE_PATH), { recursive: true });
    await fs.writeFile(RELAY_STATE_PATH, `${JSON.stringify(relayState, null, 2)}\n`, 'utf8');
    return relayState;
  }

  function getRelayStatusMessage() {
    if (!relayState.enabled || !relayState.chatId) {
      return 'Relay para topico: desligado.\n\nUse /relay_here dentro do topico destino para ativar.';
    }

    return [
      'Relay para topico: ligado.',
      '',
      `Chat destino: ${relayState.chatId}`,
      relayState.messageThreadId ? `Topico/thread: ${relayState.messageThreadId}` : 'Topico/thread: chat principal',
      '',
      'Envie midias no privado deste bot para copiar automaticamente ao destino configurado.',
    ].join('\n');
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
      return 'A conta principal do cleaner-bot ja esta conectada.';
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

  async function telegramRequest(method, payload) {
    let attempt = 0;

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
        const waitMs = retryAfterSeconds * 1000 + TELEGRAM_RETRY_PADDING_MS;
        console.log(
          `[cleaner-bot] Rate limit em ${method}: aguardando ${Math.ceil(waitMs / 1000)}s antes de tentar novamente...`,
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

  async function sendText(chatId, text) {
    try {
      await telegramRequest('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error(
        '[cleaner-bot] Erro ao enviar mensagem:',
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
        '[cleaner-bot] Erro ao copiar msg individual:',
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
        '[cleaner-bot] Erro ao copiar lote de mensagens:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  async function handleRelayCommand(message, command) {
    if (!command.startsWith('/relay')) {
      return false;
    }

    await ensureRelayStateLoaded();

    if (command === '/relay_here') {
      if (message.chat.type === 'private') {
        await sendText(
          message.chat.id,
          'Use /relay_here dentro do topico do grupo onde voce quer receber as midias.',
        );
        return true;
      }

      await saveRelayState({
        enabled: true,
        chatId: Number(message.chat.id),
        messageThreadId: Number(message.message_thread_id || 0),
        configuredBy: Number(message.from.id),
        updatedAt: new Date().toISOString(),
      });

      await sendText(
        message.chat.id,
        `Relay ativado para este destino.\n\nAgora envie midias no privado do bot NoReply que eu copio para ${relayState.messageThreadId ? 'este topico' : 'este chat'}.`,
      );
      return true;
    }

    if (command === '/relay_on') {
      if (!relayState.chatId) {
        await sendText(message.chat.id, 'Ainda nao ha destino configurado. Use /relay_here no topico primeiro.');
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

    if (command === '/relay_off') {
      await saveRelayState({
        ...relayState,
        enabled: false,
        configuredBy: Number(message.from.id),
        updatedAt: new Date().toISOString(),
      });
      await sendText(message.chat.id, getRelayStatusMessage());
      return true;
    }

    if (command === '/relay_status') {
      await sendText(message.chat.id, getRelayStatusMessage());
      return true;
    }

    if (command === '/relay_done' || command === '/relay_summary') {
      if (chatBuffers.has(message.chat.id)) {
        await flushBuffer(message.chat.id);
      }

      await relayCopyQueue.catch(() => {});
      await sendText(message.chat.id, buildRelayDeliverySummary(message.chat.id));

      if (command === '/relay_done') {
        relayDeliveryStats.delete(Number(message.chat.id));
      }

      return true;
    }

    await sendText(
      message.chat.id,
      [
        'Comandos do relay:',
        '/relay_here - usar este grupo/topico como destino',
        '/relay_status - ver destino atual',
        '/relay_on - ligar relay',
        '/relay_off - desligar relay',
        '/relay_summary - resumo do encaminhamento atual',
        '/relay_done - resumo final e zera contagem',
      ].join('\n'),
    );
    return true;
  }

  async function flushRelayBuffer(chatId, buffer) {
    await ensureRelayStateLoaded();

    if (!relayState.enabled || !relayState.chatId) {
      return false;
    }

    const messageIds = buffer.messages
      .map((item) => Number(item?.message_id || 0))
      .filter((messageId) => Number.isInteger(messageId) && messageId > 0)
      .sort((left, right) => left - right);

    if (messageIds.length === 0) {
      return true;
    }

    const copiedCount = await enqueueRelayCopy(async () => {
      let totalCopied = 0;

      for (const chunk of splitIntoChunks(messageIds, COPY_MESSAGES_CHUNK_LIMIT)) {
        await copyMultipleMessages(chatId, relayState.chatId, chunk, {
          messageThreadId: relayState.messageThreadId,
        });
        totalCopied += chunk.length;
      }

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

      console.error(`[cleaner-bot] Erro na conta principal: ${reason}`);
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

    console.log('[cleaner-bot] Conta principal conectada para copiar links do Telegram.');
    return client;
  }

  async function promptInTerminal(question) {
    if (!processInput.isTTY || !processOutput.isTTY) {
      throw new Error(
        'Nao ha terminal interativo disponivel para autenticar a conta principal do cleaner-bot.',
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
        '[cleaner-bot] Falha ao aquecer dialogs da conta principal:',
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
      await sendText(chatId, 'A conta principal do cleaner-bot ja esta conectada.');
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
      'Vamos conectar a conta principal do cleaner-bot aqui no chat.\n\nUse /cancel a qualquer momento para abortar.',
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
          throw new Error('Nao foi possivel autenticar a conta principal do cleaner-bot.');
        }

        await finalizeCleanerUserConnection(client);
        await sendText(
          chatId,
          'Conta principal conectada com sucesso.\n\nAgora voce ja pode mandar links t.me e eu vou buscar as midias por ela.',
        );
      } catch (error) {
        const reason = normalizeCleanerUserError(
          error,
          'Nao foi possivel autenticar a conta principal do cleaner-bot.',
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
            'A conta principal ainda nao foi autenticada. Use /login no cleaner-bot para conectar.';
          await disconnectCleanerUserClient(client);
          return null;
        }

        if (!isTerminalInteractive()) {
          cleanerUserState.ready = false;
          cleanerUserState.error =
            'A sessao da conta principal expirou ou ainda nao foi criada. Use /login no cleaner-bot para conectar novamente.';
          await disconnectCleanerUserClient(client);
          return null;
        }

        console.log('[cleaner-bot] Conta principal ainda nao autenticada. Iniciando login interativo...');

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
              '[cleaner-bot] Falha durante autenticacao da conta principal:',
              error instanceof Error ? error.message : String(error),
            );
          },
        });

        authorized = await client.checkAuthorization();
      }

      if (!authorized) {
        throw new Error('Nao foi possivel autenticar a conta principal do cleaner-bot.');
      }

      return await finalizeCleanerUserConnection(client);
    } catch (error) {
      cleanerUserState.ready = false;
      cleanerUserState.error = normalizeCleanerUserError(
        error,
        'Falha ao iniciar a conta principal do cleaner-bot.',
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
        `Nao consegui usar a conta principal do cleaner-bot agora.\n\nMotivo: ${reason}\n\nUse /login neste chat para autenticar a conta principal sem depender do terminal.`,
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
              '[cleaner-bot] Erro sendMediaGroup:',
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
          'Somente o admin principal pode autenticar a conta principal do cleaner-bot.',
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
        'Ola Mestre!\nEnvie ou encaminhe varias midias para eu reagrupar sem a tag de encaminhado.\n\nTambem aceito links de mensagens do Telegram (t.me/...) para buscar as mensagens com a conta principal e reenviar aqui.\n\nRelay para topicos:\n/relay_here - use dentro do topico destino para ativar\n/relay_status - ver destino atual\n/relay_on - ligar relay\n/relay_off - desligar relay\n\nComandos:\n/login - autentica a conta principal por este chat\n/status - mostra o estado da conta principal\n/cancel - cancela uma autenticacao em andamento',
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
          '[cleaner-bot] Erro ao reagrupar midias recebidas:',
          error instanceof Error ? error.message : String(error),
        );
      });
    }, BUFFER_FLUSH_MS);
  }

  async function poll() {
    try {
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
          }
        }
      }
    } catch (error) {
      console.error(
        '[cleaner-bot] erro polling',
        error instanceof Error ? error.message : String(error),
      );
    }

    setTimeout(poll, POLL_RETRY_MS);
  }

  poll();
  return {
    enabled: true,
    userClientEnabled: cleanerUserState.enabled,
  };
}
