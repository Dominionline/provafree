const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const token = process.env.TELEGRAM_TOKEN;

// Crea una nuova istanza del bot
const bot = new TelegramBot(token, { polling: true });

// Configura il database SQLite
const db = new sqlite3.Database('bot.db'); // Salva il database su disco

// Crea le tabelle necessarie
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, verified INTEGER DEFAULT 0, captchaAnswer TEXT, invited_by INTEGER)');
  db.run('CREATE TABLE IF NOT EXISTS invites (user_id INTEGER PRIMARY KEY, invite_count INTEGER)');
});

// Funzione per generare una domanda captcha
function generateCaptcha() {
  const num1 = Math.floor(Math.random() * 9) + 1;
  const num2 = Math.floor(Math.random() * 9) + 1;
  return {
    question: `${num1} + ${num2} = ?`,
    answer: (num1 + num2).toString()
  };
}

// Funzione per inviare un captcha
async function sendCaptcha(chatId, userId) {
  const captcha = generateCaptcha();
  await bot.sendMessage(chatId, `Per favore, risolvi questo captcha: ${captcha.question}`);
  db.run('UPDATE users SET captchaAnswer = ? WHERE id = ?', [captcha.answer, userId]);
  return captcha.answer;
}

// Funzione per verificare il captcha
async function verifyCaptcha(chatId, userId, captchaAnswer, text) {
  if (text === captchaAnswer) {
    await bot.sendMessage(chatId, 'Captcha corretto! Benvenuto nel gruppo.');
    // Invia messaggio di benvenuto con la promo
    await bot.sendMessage(chatId, 'Partecipa alla promo: invita 3 amici e sblocca l’accesso al gruppo VIP.', {
      reply_markup: {
        inline_keyboard: [[{ text: "Partecipa alla promo", callback_data: `join_promo_${userId}` }]]
      }
    });
    db.run('UPDATE users SET verified = 1, captchaAnswer = NULL WHERE id = ?', [userId]);
    return true;
  } else {
    await bot.sendMessage(chatId, 'Captcha errato, per favore riprova.');
    return false;
  }
}

// Gestione dei nuovi membri nel gruppo free
bot.on('new_chat_members', async (msg) => {
  const chatId = msg.chat.id;
  for (const member of msg.new_chat_members) {
    if (!member.is_bot) {
      const userId = member.id;
      db.run('INSERT OR IGNORE INTO users (id, username, verified) VALUES (?, ?, 0)', [userId, member.username]);
      db.get('SELECT verified FROM users WHERE id = ?', [userId], async (err, row) => {
        if (!row.verified) {
          await sendCaptcha(chatId, userId);
        }
      });
    }
  }
});

// Gestione dei messaggi per il captcha
bot.on('text', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, row) => {
    if (err) {
      console.error(err);
      return;
    }

    if (row && row.captchaAnswer && row.verified === 0) {
      const verified = await verifyCaptcha(chatId, userId, row.captchaAnswer, text);
      if (verified) {
        db.run('UPDATE users SET captchaAnswer = NULL WHERE id = ?', [userId]);
      }
    }
  });
});

// Gestione della promo e dei ref link
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  if (query.data.startsWith('join_promo_')) {
    const refLink = `https://t.me/+E6LO3QVWyj5hNWFk?start=${userId}`;
    bot.sendMessage(chatId, `Ecco il tuo link personale per la promo: ${refLink}`);
  }
});

// Gestione degli inviti
bot.onText(/\/start (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const invitedBy = match[1];
  const userId = msg.from.id;

  if (invitedBy) {
    db.run('INSERT OR IGNORE INTO invites (user_id, invite_count) VALUES (?, 0)', [invitedBy]);
    db.run('UPDATE users SET invited_by = ? WHERE id = ?', [invitedBy, userId]);
    db.get('SELECT invite_count FROM invites WHERE user_id = ?', [invitedBy], (err, row) => {
      if (row) {
        const newCount = row.invite_count + 1;
        db.run('UPDATE invites SET invite_count = ? WHERE user_id = ?', [newCount, invitedBy]);

        if (newCount >= 3) {
          bot.sendMessage(invitedBy, `Congratulazioni! Hai invitato 3 persone. Ecco il link per il gruppo VIP: https://t.me/+r_WY7qdTa-BiMWY0`);
        }
      }
    });
  }

  db.run('INSERT OR IGNORE INTO users (id, username, invited_by) VALUES (?, ?, ?)', [userId, msg.from.username, invitedBy]);
});

// Gestione del comando /challengeref
bot.onText(/\/challengeref/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.get('SELECT invite_count FROM invites WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      console.error(err);
      return;
    }

    if (row) {
      bot.sendMessage(chatId, `Hai invitato ${row.invite_count} persone.`);
    } else {
      bot.sendMessage(chatId, 'Non hai ancora invitato nessuno.');
    }
  });
});

// Funzione per verificare il contenuto del database
function logDatabase() {
  db.all('SELECT * FROM users', (err, rows) => {
    console.log('Users:', rows);
  });

  db.all('SELECT * FROM invites', (err, rows) => {
    console.log('Invites:', rows);
  });
}

// Esempio di verifica del database ogni minuto
setInterval(logDatabase, 60000);

console.log('Bot avviato.');
