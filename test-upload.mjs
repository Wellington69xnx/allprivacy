import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env2', override: true, quiet: true });

async function main() {
  const sessionString = fs.readFileSync('storage/cleaner-user.session', 'utf8');
  const client = new TelegramClient(
    new StringSession(sessionString),
    Number(process.env.CLEANER_USER_API_ID || 0),
    process.env.CLEANER_USER_API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();

  const files = [
    new CustomFile('test1.jpg', 5, 'test1.jpg', Buffer.from('12345')),
    new CustomFile('test2.jpg', 5, 'test2.jpg', Buffer.from('12345'))
  ];

  try {
    await client.sendFile('@allprivacy_noreply_bot', {
      file: files,
      forceDocument: false
    });
    console.log('SUCCESS CustomFile');
  } catch (e) {
    console.error('ERROR CustomFile:', e.message);
  }

  const filesBuf = [
    Buffer.from('12345'),
    Buffer.from('12345')
  ];
  filesBuf[0].name = 'test1.jpg';
  filesBuf[1].name = 'test2.jpg';

  try {
    await client.sendFile('@allprivacy_noreply_bot', {
      file: filesBuf,
      forceDocument: false
    });
    console.log('SUCCESS Buffer');
  } catch (e) {
    console.error('ERROR Buffer:', e.message);
  }

  await client.disconnect();
}

main().catch(console.error);
