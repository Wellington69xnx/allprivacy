import dotenv from 'dotenv';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { stdin as processInput, stdout as processOutput } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env2', override: true, quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, 'storage');

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTelegramError(error, fallbackMessage) {
  const explicitMessage =
    toText(error?.errorMessage) ||
    toText(error?.message) ||
    (error instanceof Error ? toText(error.message) : '');

  return explicitMessage || fallbackMessage || 'Falha desconhecida.';
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

async function promptInTerminal(question) {
  if (!processInput.isTTY || !processOutput.isTTY) {
    throw new Error('Nao ha terminal interativo disponivel para pedir senha 2FA.');
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
    const reason = normalizeTelegramError(error, 'Falha desconhecida na conta.');

    if (reason === 'TIMEOUT') {
      return;
    }

    console.error(`[telegram-qr-login] Erro na conta: ${reason}`);
  };
}

async function main() {
  const cleanerUserConfig = buildCleanerUserConfig();

  if (!cleanerUserConfig.apiId || !cleanerUserConfig.apiHash) {
    throw new Error('Configure CLEANER_USER_API_ID e CLEANER_USER_API_HASH antes de usar o login por QR.');
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

  try {
    await client.connect();

    if (await client.checkAuthorization()) {
      console.log('[telegram-qr-login] Esta sessao ja esta autenticada.');
      await writeSessionStringToDisk(cleanerUserConfig.sessionFilePath, client.session.save());
      return;
    }

    console.log('[telegram-qr-login] Abra o Telegram no celular: Configuracoes > Dispositivos > Conectar dispositivo.');
    console.log('[telegram-qr-login] Escaneie o QR abaixo. Se expirar, um novo QR sera mostrado automaticamente.\n');

    await client.signInUserWithQrCode(
      {
        apiId: cleanerUserConfig.apiId,
        apiHash: cleanerUserConfig.apiHash,
      },
      {
        qrCode: async ({ token, expires }) => {
          const loginUrl = `tg://login?token=${token.toString('base64url')}`;
          const expiresAt = new Date(Number(expires || 0) * 1000).toLocaleString('pt-BR');
          const terminalQr = await QRCode.toString(loginUrl, {
            type: 'terminal',
            small: true,
            errorCorrectionLevel: 'M',
          });

          console.log(terminalQr);
          console.log(`[telegram-qr-login] Link do QR: ${loginUrl}`);
          console.log(`[telegram-qr-login] Expira em: ${expiresAt}\n`);
        },
        password: async (hint) =>
          await promptInTerminal(
            hint
              ? `Senha 2FA da conta (${hint}): `
              : 'Senha 2FA da conta, se pedir: ',
          ),
        onError: async (error) => {
          console.error('[telegram-qr-login]', normalizeTelegramError(error, 'Falha no login por QR.'));
          return false;
        },
      },
    );

    await writeSessionStringToDisk(cleanerUserConfig.sessionFilePath, client.session.save());
    console.log(`[telegram-qr-login] Login concluido. Sessao salva em ${cleanerUserConfig.sessionFilePath}`);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

await main().catch((error) => {
  console.error(
    `[telegram-qr-login] ${normalizeTelegramError(error, 'Falha desconhecida no login por QR.')}`,
  );
  process.exitCode = 1;
});
