import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCleanerBot } from './cleaner-bot.mjs';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env2', override: true, quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAdminIds(value) {
  const adminIds = toText(value)
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);

  return adminIds.length > 0 ? adminIds : [8018785433, 7228335041];
}

function resolveProjectPath(value, fallbackPath) {
  const normalizedValue = toText(value);

  if (!normalizedValue) {
    return fallbackPath;
  }

  return path.isAbsolute(normalizedValue) ? normalizedValue : path.join(projectRoot, normalizedValue);
}

function normalizePositiveInteger(value, fallbackValue) {
  const numericValue = Number(String(value || '').replace(/[^\d-]+/g, ''));
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : fallbackValue;
}

const token = toText(process.env.CONTENT_BOT_TOKEN);
const cleanerUserSessionFilePath = resolveProjectPath(
  process.env.CLEANER_USER_SESSION_FILE,
  path.join(storageDir, 'cleaner-user.session'),
);
const contentRelayStatePath = resolveProjectPath(
  process.env.CONTENT_BOT_RELAY_STATE_FILE,
  path.join(storageDir, 'content-relay-state.json'),
);
const contentLockPath = path.join(storageDir, 'content-bot.pid');

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseContentLock() {
  try {
    const currentPid = Number(readFileSync(contentLockPath, 'utf8'));

    if (currentPid === process.pid) {
      unlinkSync(contentLockPath);
    }
  } catch {
    // Lock ja pode ter sido removido.
  }
}

function acquireContentLock() {
  mkdirSync(storageDir, { recursive: true });

  if (existsSync(contentLockPath)) {
    const existingPid = Number(readFileSync(contentLockPath, 'utf8'));

    if (existingPid !== process.pid && isProcessRunning(existingPid)) {
      console.error(
        `Bot de conteudo ja esta rodando no PID ${existingPid}. Feche o processo antigo antes de iniciar outro.`,
      );
      process.exit(1);
    }
  }

  writeFileSync(contentLockPath, `${String(process.pid)}\n`, 'utf8');
  process.once('exit', releaseContentLock);

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.once(signal, () => {
      releaseContentLock();
      process.exit(0);
    });
  }
}

acquireContentLock();
console.log('Iniciando AllPrivacy _ CONTEUDOS em processo separado...');

const contentBot = startCleanerBot({
  token,
  adminIds: parseAdminIds(process.env.CONTENT_BOT_ADMIN_IDS || process.env.CLEANER_BOT_ADMIN_IDS),
  userClientConfig: {
    apiId: Number(process.env.CLEANER_USER_API_ID || 0),
    apiHash: process.env.CLEANER_USER_API_HASH || '',
    phone: process.env.CLEANER_USER_PHONE || '',
    session: process.env.CLEANER_USER_SESSION || '',
    sessionFilePath: cleanerUserSessionFilePath,
  },
  botLabel: 'AllPrivacy _ CONTEUDOS',
  logPrefix: 'content-bot',
  relayStatePath: contentRelayStatePath,
  relayCommands: {
    here: '/relay_conteudo',
    on: '/conteudo_on',
    off: '/conteudo_off',
    status: '/conteudo_status',
    summary: '/conteudo_summary',
    done: '/conteudo_done',
    help: '/conteudo_help',
    helpPrefix: '/conteudo',
    doneAliases: ['/done', '/relay_done'],
  },
  historyRelay: {
    enabled: true,
    stateDir: process.env.CONTENT_BOT_HISTORY_STATE_DIR || 'storage/content-history-relays',
    batchSize: normalizePositiveInteger(process.env.CONTENT_BOT_HISTORY_BATCH_SIZE, 15),
    delayMs: normalizePositiveInteger(process.env.CONTENT_BOT_HISTORY_DELAY_MS, 10000),
    progressLogInterval: normalizePositiveInteger(process.env.CONTENT_BOT_HISTORY_PROGRESS_LOG_INTERVAL, 100),
    floodRetryFirstWaitSeconds: normalizePositiveInteger(
      process.env.CONTENT_BOT_HISTORY_FLOOD_FIRST_WAIT_SECONDS,
      60,
    ),
    floodRetryNextWaitSeconds: normalizePositiveInteger(
      process.env.CONTENT_BOT_HISTORY_FLOOD_NEXT_WAIT_SECONDS,
      30,
    ),
    aliasCommands: ['/conteudos'],
    commands: {
      start: '/conteudo_encaminhar',
      stop: '/conteudo_parar',
      status: '/conteudo_job',
      paused: '/conteudo_pausados',
      failures: '/conteudo_falhas',
    },
  },
});

if (contentBot.enabled) {
  console.log('AllPrivacy _ CONTEUDOS iniciado em processo separado.');

  if (contentBot.userClientEnabled) {
    console.log('AllPrivacy _ CONTEUDOS usando a mesma conta principal do NoReply quando necessario.');
  } else {
    console.log('AllPrivacy _ CONTEUDOS sem conta principal configurada; relay por Bot API continua disponivel.');
  }
} else {
  console.log('AllPrivacy _ CONTEUDOS desativado. Defina CONTENT_BOT_TOKEN.');
}
