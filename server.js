require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { scrapeReviews } = require('./scraper');
const { initBot, isBotConnected } = require('./telegram');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MINUTES = parseInt(process.env.POLL_INTERVAL_MINUTES || '15', 10);

// Initialize Telegram bot from DB settings
setTimeout(async () => {
  const token = await db.getSetting('telegram_token') || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = await db.getSetting('telegram_chat_id') || process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) {
    initBot(token, chatId);
  }
}, 1000); // Wait for DB to be ready

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Coolify
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// API endpoint for frontend config and connection status
app.get('/api/config', async (req, res) => {
  const { fetchDeveloperApps } = require('./scraper');
  try {
    const apps = await fetchDeveloperApps();
    let developerName = await db.getSetting('developer_name') || process.env.DEVELOPER_TERM;
    if (developerName === 'Your Developer Name') {
      developerName = '';
    }
    res.json({ 
      developerName: developerName || '', 
      connected: apps.length > 0,
      appsCount: apps.length,
      telegramConnected: isBotConnected()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch developer config', connected: false, telegramConnected: false });
  }
});

// Settings Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const token = await db.getSetting('telegram_token') || process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = await db.getSetting('telegram_chat_id') || process.env.TELEGRAM_CHAT_ID || '';
    const developerName = await db.getSetting('developer_name') || process.env.DEVELOPER_TERM || '';
    res.json({ telegramToken: token, telegramChatId: chatId, developerName });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  const { telegramToken, telegramChatId, developerName } = req.body;
  try {
    const oldDevName = await db.getSetting('developer_name') || '';

    await db.setSetting('telegram_token', telegramToken || '');
    await db.setSetting('telegram_chat_id', telegramChatId || '');
    await db.setSetting('developer_name', developerName || '');
    
    // Re-initialize bot
    await initBot(telegramToken, telegramChatId);

    if (developerName !== oldDevName) {
        // Clear reviews because the developer changed
        db.run('DELETE FROM reviews', (err) => {
            if (!err) {
              // Trigger a fresh scrape in the background
              scrapeReviews();
            }
        });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
});

// Test Telegram notification / Summary
app.post('/api/send-apps-summary', async (req, res) => {
  const { sendSummaryMessage } = require('./telegram');
  const { fetchDeveloperApps } = require('./scraper');
  
  try {
    const apps = await fetchDeveloperApps();
    const success = await sendSummaryMessage(apps);
    if (success) {
      res.json({ success: true, message: 'Summary sent to Telegram' });
    } else {
      res.status(500).json({ success: false, message: 'Telegram not configured or failed' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error generating summary' });
  }
});

// API endpoint to get all apps
app.get('/api/apps', async (req, res) => {
  const { fetchDeveloperApps } = require('./scraper');
  try {
    const apps = await fetchDeveloperApps();
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve apps' });
  }
});

// API endpoint to get reviews, sorted by newest, optionally filtered by appId
app.get('/api/reviews', (req, res) => {
  const { appId } = req.query;
  let query = 'SELECT * FROM reviews';
  let params = [];
  
  if (appId) {
    query += ' WHERE app_id = ?';
    params.push(appId);
  }
  query += ' ORDER BY updated_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to retrieve reviews' });
      return;
    }
    res.json(rows);
  });
});

// Initial scrape on startup
setTimeout(() => {
  scrapeReviews();
}, 2000); // Wait 2s to ensure DB is initialized

// Setup polling interval
setInterval(() => {
  scrapeReviews();
}, POLL_INTERVAL_MINUTES * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Polling interval set to ${POLL_INTERVAL_MINUTES} minutes.`);
});
