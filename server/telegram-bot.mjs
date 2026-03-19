import path from 'node:path';
import { promises as fs } from 'node:fs';

const telegramApiBase = 'https://api.telegram.org';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function buildModelKeyboard(model, siteUrl, groupUrl) {
  return {
    inline_keyboard: [
      [
        {
          text: 'Abrir pagina da modelo',
          url: buildModelUrl(siteUrl, model),
        },
      ],
      [
        {
          text: 'Entrar no grupo',
          url: buildGroupUrl(groupUrl, siteUrl),
        },
        {
          text: 'Voltar aos modelos',
          callback_data: 'list-models',
        },
      ],
    ],
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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createUploadBlob(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  return new Blob([fileBuffer]);
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
  return telegramRequest(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...extra,
  });
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

async function answerCallbackQuery(token, callbackQueryId, text = '') {
  return telegramRequest(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
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
  const replyMarkup = buildModelKeyboard(model, options.siteUrl, options.groupUrl);
  const mediaPreview = getRandomModelMediaSelection(model);

  await sendText(
    token,
    chatId,
    `${caption}\n\nSeparei *3 previas aleatorias* dessa modelo para voce.`,
    { reply_markup: replyMarkup },
  );

  if (mediaPreview.length > 0) {
    await sendMediaGroup(
      token,
      chatId,
      await Promise.all(
        mediaPreview.map(async (item) => {
          if (item.type === 'video') {
            return {
              type: 'video',
              media: await resolveTelegramMediaSource(
                item.src,
                options.siteUrl,
                options.resolveLocalAssetPath,
                options.telegramFileCache,
              ),
              supports_streaming: true,
            };
          }

          return {
            type: 'photo',
            media: await resolveTelegramMediaSource(
              item.thumbnail,
              options.siteUrl,
              options.resolveLocalAssetPath,
              options.telegramFileCache,
            ),
          };
        }),
      ),
      options.telegramFileCache,
    );

    return;
  }

  if (model.coverImage) {
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
}

async function handleMessage(token, message, readSiteContent, options) {
  const chatId = message.chat?.id;
  const text = toText(message.text);

  if (!chatId || !text.startsWith('/')) {
    return;
  }

  const siteContent = await readSiteContent();
  const [command, ...args] = text.split(/\s+/);
  const normalizedCommand = command.toLowerCase();
  const startPayload = args.join(' ');

  if (normalizedCommand === '/start') {
    const referencedModel = startPayload
      ? findModelByInput(siteContent.models, startPayload.replace(/^ref[:-]/i, ''))
      : null;

    if (referencedModel) {
      return sendModelDetails(token, chatId, referencedModel, options);
    }

    return sendText(
      token,
      chatId,
      '*AllPrivacy*\n\nAcesse as modelos publicadas no site e entre no grupo pelo bot.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Ver modelos', callback_data: 'list-models' }],
            [{ text: 'Abrir site', url: buildHomeUrl(options.siteUrl) }],
            [{ text: 'Entrar no grupo', url: buildGroupUrl(options.groupUrl, options.siteUrl) }],
          ],
        },
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
      return sendText(
        token,
        chatId,
        'Nao encontrei essa modelo. Use `/modelos` para ver a lista atual.',
      );
    }

    return sendModelDetails(token, chatId, model, options);
  }

  if (normalizedCommand === '/grupo') {
    return sendText(token, chatId, 'Entrada direta no grupo:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Entrar no grupo', url: buildGroupUrl(options.groupUrl, options.siteUrl) }],
        ],
      },
    });
  }

  return sendText(
    token,
    chatId,
    'Comandos disponiveis:\n/start\n/modelos\n/modelo nome\n/grupo',
  );
}

async function handleCallbackQuery(token, callbackQuery, readSiteContent, options) {
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const data = toText(callbackQuery.data);

  if (!callbackId || !chatId) {
    return;
  }

  const siteContent = await readSiteContent();

  if (data === 'list-models') {
    await answerCallbackQuery(token, callbackId);
    return sendModelList(token, chatId, siteContent, options.siteUrl);
  }

  if (data.startsWith('model:')) {
    const model = findModelByInput(siteContent.models, data.replace(/^model:/, ''));

    if (!model) {
      await answerCallbackQuery(token, callbackId, 'Modelo nao encontrada.');
      return;
    }

    await answerCallbackQuery(token, callbackId);
    return sendModelDetails(token, chatId, model, options);
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
}) {
  const normalizedToken = toText(token);

  if (!normalizedToken) {
    return {
      enabled: false,
      stop() {},
    };
  }

  let offset = 0;
  let isStopped = false;
  let pollingTimeout = null;
  const telegramFileCache = createTelegramFileCache(cacheFilePath);

  const options = {
    siteUrl: buildHomeUrl(siteUrl),
    groupUrl: buildGroupUrl(groupUrl, siteUrl),
    resolveLocalAssetPath,
    telegramFileCache,
  };

  async function processUpdate(update) {
    if (update.message) {
      await handleMessage(normalizedToken, update.message, readSiteContent, options);
    }

    if (update.callback_query) {
      await handleCallbackQuery(normalizedToken, update.callback_query, readSiteContent, options);
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
        allowed_updates: ['message', 'callback_query'],
      });

      updateCount = updates.length;

      for (const update of updates) {
        offset = update.update_id + 1;
        await processUpdate(update);
      }
    } catch (error) {
      console.error('Bot Telegram falhou ao consultar updates:', error);
    } finally {
      if (!isStopped) {
        pollingTimeout = setTimeout(poll, updateCount > 0 ? 50 : 150);
      }
    }
  }

  poll();

  return {
    enabled: true,
    stop() {
      isStopped = true;

      if (pollingTimeout) {
        clearTimeout(pollingTimeout);
      }
    },
  };
}
