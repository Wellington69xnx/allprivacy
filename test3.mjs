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

  fs.writeFileSync('test1.jpg', 'fake content 123');
  fs.writeFileSync('test2.jpg', 'fake content 456');

  const files = [
    new CustomFile('test1.jpg', fs.statSync('test1.jpg').size, 'test1.jpg'),
    new CustomFile('test2.jpg', fs.statSync('test2.jpg').size, 'test2.jpg')
  ];

  try {
    console.log('Sending ALbum to bot...');
    await client.sendFile('@allprivacy_noreply_bot', {
      file: files,
      forceDocument: false
    });
    console.log('SUCCESS CustomFile');
  } catch (e) {
    console.log('ALBUM ERROR:', e.message);
  }

  try {
    console.log('Sending ALbum to myself...');
    await client.sendFile('me', {
      file: files,
      forceDocument: false
    });
    console.log('SUCCESS ALBUM ME');
  } catch (e) {
    console.log('ALBUM ERROR ME:', e.message);
  }

  await client.disconnect();
}

main().catch(e => console.log('FATAL:', e.message));
