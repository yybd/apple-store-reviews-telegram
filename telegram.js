const TelegramBot = require('node-telegram-bot-api');
const dbModule = require('./db');

let bot = null;
let activeChatId = null;

const setupListeners = () => {
  if (!bot) return;

  // Handle /apps command
  bot.onText(/\/(start|apps)/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== activeChatId) return;

    const { fetchDeveloperApps } = require('./scraper');
    bot.sendMessage(chatId, 'Fetching apps data...');
    
    try {
      const apps = await fetchDeveloperApps();
      if (apps.length === 0) {
        bot.sendMessage(chatId, 'No apps found.');
        return;
      }

      let text = `*Apps Rating Summary*\n\n`;
      const keyboard = [];

      apps.forEach(app => {
        text += `*${app.name}*\nRating: ${app.rating.toFixed(1)}/5 (${app.ratingCount} reviews)\n\n`;
        keyboard.push([{ text: `View Reviews: ${app.name}`, callback_data: `app_${app.id}` }]);
      });

      bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    } catch (err) {
      bot.sendMessage(chatId, 'Error fetching apps data.');
    }
  });

  // Handle button clicks
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (chatId.toString() !== activeChatId) return;

    const data = query.data;
    if (data.startsWith('app_')) {
      const appId = data.split('_')[1];
      
      // Fetch latest reviews from DB
      dbModule.all('SELECT * FROM reviews WHERE app_id = ? ORDER BY updated_at DESC LIMIT 5', [appId], (err, rows) => {
        if (err || !rows || rows.length === 0) {
          bot.answerCallbackQuery(query.id, { text: 'No reviews found in the local database.' });
          bot.sendMessage(chatId, 'No reviews found in the local database for this app.');
          return;
        }

        let reviewText = `*Latest 5 Reviews:*\n\n`;
        rows.forEach(r => {
          reviewText += `Rating: ${r.rating}/5\n*${r.title}* by _${r.author_name}_\n${r.content}\n\n`;
        });

        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, reviewText, { parse_mode: 'Markdown' });
      });
    }
  });
};

const initBot = async (token, chatId) => {
  if (bot) {
    console.log('Stopping existing Telegram bot...');
    try {
      await bot.stopPolling();
    } catch (e) {
      console.error('Error stopping bot polling:', e);
    }
    bot = null;
  }

  activeChatId = chatId;

  if (token && chatId) {
    try {
      bot = new TelegramBot(token, { polling: true });
      setupListeners();
      console.log('Telegram bot configured with polling.');
      return true;
    } catch (e) {
      console.error('Failed to initialize bot:', e);
      bot = null;
      return false;
    }
  } else {
    console.log('Telegram bot token or chat ID not provided. Telegram notifications disabled.');
    return false;
  }
};

const sendReviewNotification = async (review, appName, iconUrl) => {
  if (!bot || !activeChatId) return;

  const message = `*New Review for ${appName}*

Rating: ${review.rating}/5
*${review.title}*
by _${review.author_name}_ (v${review.version})

${review.content}`;

  try {
    if (iconUrl) {
      await bot.sendPhoto(activeChatId, iconUrl, { caption: message, parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(activeChatId, message, { parse_mode: 'Markdown' });
    }
    console.log(`Sent Telegram notification for review ${review.id}`);
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
};

const sendSummaryMessage = async (apps) => {
  if (!bot || !activeChatId) return false;

  let message = `*Apps Rating Summary*\n\n`;
  
  if (apps.length === 0) {
    message += `No apps found.`;
  } else {
    apps.forEach(app => {
      message += `*${app.name}*\nRating: ${app.rating.toFixed(1)}/5 (${app.ratingCount} reviews)\n\n`;
    });
  }

  try {
    await bot.sendMessage(activeChatId, message, { parse_mode: 'Markdown' });
    console.log('Sent Telegram summary notification.');
    return true;
  } catch (error) {
    console.error('Error sending Telegram summary:', error);
    return false;
  }
};

const isBotConnected = () => !!bot;

module.exports = { initBot, isBotConnected, sendReviewNotification, sendSummaryMessage };
