import dotenv from 'dotenv';
import path from 'node:path';
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

const token = process.env.CLEANER_BOT_TOKEN || '8399490615:AAGgWRT65BBjaou5ff4R5Qm2BMKzZ_k4q34';
const cleanerUserSessionFileEnv = toText(process.env.CLEANER_USER_SESSION_FILE);
const cleanerUserSessionFilePath = cleanerUserSessionFileEnv
  ? path.isAbsolute(cleanerUserSessionFileEnv)
    ? cleanerUserSessionFileEnv
    : path.join(projectRoot, cleanerUserSessionFileEnv)
  : path.join(storageDir, 'cleaner-user.session');

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
