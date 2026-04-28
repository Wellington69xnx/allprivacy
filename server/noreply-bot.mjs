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

function normalizePositiveInteger(value, fallbackValue) {
  const numericValue = Number(String(value || '').replace(/[^\d-]+/g, ''));
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : fallbackValue;
}

const token = process.env.CLEANER_BOT_TOKEN || '8399490615:AAGgWRT65BBjaou5ff4R5Qm2BMKzZ_k4q34';
const cleanerUserSessionFileEnv = toText(process.env.CLEANER_USER_SESSION_FILE);
const cleanerUserSessionFilePath = cleanerUserSessionFileEnv
  ? path.isAbsolute(cleanerUserSessionFileEnv)
    ? cleanerUserSessionFileEnv
    : path.join(projectRoot, cleanerUserSessionFileEnv)
  : path.join(storageDir, 'cleaner-user.session');
const noReplyLockPath = path.join(storageDir, 'noreply-bot.pid');

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

function releaseNoReplyLock() {
  try {
    const currentPid = Number(readFileSync(noReplyLockPath, 'utf8'));

    if (currentPid === process.pid) {
      unlinkSync(noReplyLockPath);
    }
  } catch {
    // Lock ja pode ter sido removido.
  }
}

function acquireNoReplyLock() {
  mkdirSync(storageDir, { recursive: true });

  if (existsSync(noReplyLockPath)) {
    const existingPid = Number(readFileSync(noReplyLockPath, 'utf8'));

    if (existingPid !== process.pid && isProcessRunning(existingPid)) {
      console.error(
        `NoReply ja esta rodando no PID ${existingPid}. Feche o processo antigo antes de iniciar outro.`,
      );
      process.exit(1);
    }
  }

  writeFileSync(noReplyLockPath, `${String(process.pid)}\n`, 'utf8');
  process.once('exit', releaseNoReplyLock);

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.once(signal, () => {
      releaseNoReplyLock();
      process.exit(0);
    });
  }
}

acquireNoReplyLock();
console.log('Iniciando NoReply em processo separado...');

const noReplyBot = startCleanerBot({
  token,
  adminIds: parseAdminIds(process.env.CLEANER_BOT_ADMIN_IDS),
  userClientConfig: {
    apiId: Number(process.env.CLEANER_USER_API_ID || 0),
    apiHash: process.env.CLEANER_USER_API_HASH || '',
    phone: process.env.CLEANER_USER_PHONE || '',
    session: process.env.CLEANER_USER_SESSION || '',
    sessionFilePath: cleanerUserSessionFilePath,
  },
  botLabel: 'NoReply',
  logPrefix: 'noreply-bot',
  historyRelay: {
    enabled: true,
    stateDir: process.env.NOREPLY_BOT_HISTORY_STATE_DIR || 'storage/noreply-history-relays',
    batchSize: normalizePositiveInteger(process.env.NOREPLY_BOT_HISTORY_BATCH_SIZE, 15),
    delayMs: normalizePositiveInteger(process.env.NOREPLY_BOT_HISTORY_DELAY_MS, 10000),
    progressLogInterval: normalizePositiveInteger(process.env.NOREPLY_BOT_HISTORY_PROGRESS_LOG_INTERVAL, 100),
    floodRetryFirstWaitSeconds: normalizePositiveInteger(
      process.env.NOREPLY_BOT_HISTORY_FLOOD_FIRST_WAIT_SECONDS,
      60,
    ),
    floodRetryNextWaitSeconds: normalizePositiveInteger(
      process.env.NOREPLY_BOT_HISTORY_FLOOD_NEXT_WAIT_SECONDS,
      30,
    ),
    aliasCommands: ['/noreply'],
    commands: {
      start: '/noreply_encaminhar',
      stop: '/noreply_parar',
      status: '/noreply_job',
      paused: '/noreply_pausados',
      failures: '/noreply_falhas',
    },
  },
});

if (noReplyBot.enabled) {
  console.log('NoReply iniciado em processo separado.');

  if (noReplyBot.userClientEnabled) {
    console.log('NoReply com conta principal configurada para recursos MTProto quando necessario.');
  } else {
    console.log('NoReply sem conta principal configurada; relay por Bot API continua disponivel.');
  }
} else {
  console.log('NoReply desativado. Defina CLEANER_BOT_TOKEN.');
}
