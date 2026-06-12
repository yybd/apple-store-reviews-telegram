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
    const storeCountryStr = await db.getSetting('store_country') || process.env.STORE_COUNTRY || 'us';
    const storeCountries = storeCountryStr.split(',');
    
    const apiMode = await db.getSetting('api_mode') || 'public';
    const ascIssuerId = await db.getSetting('asc_issuer_id') || '';
    const ascKeyId = await db.getSetting('asc_key_id') || '';
    const ascPrivateKeyRaw = await db.getSetting('asc_private_key') || '';
    const ascPrivateKey = ascPrivateKeyRaw ? '***HIDDEN***' : '';

    res.json({ telegramToken: token, telegramChatId: chatId, developerName, storeCountries, apiMode, ascIssuerId, ascKeyId, ascPrivateKey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', async (req, res) => {
  const { telegramToken, telegramChatId, developerName, storeCountries, apiMode, ascIssuerId, ascKeyId, ascPrivateKey } = req.body;
  try {
    const oldDevName = await db.getSetting('developer_name') || '';
    const oldStoreCountry = await db.getSetting('store_country') || 'us';
    const oldApiMode = await db.getSetting('api_mode') || 'public';

    const oldTelegramToken = await db.getSetting('telegram_token') || '';
    const oldTelegramChatId = await db.getSetting('telegram_chat_id') || '';

    const storeCountryStr = Array.isArray(storeCountries) ? storeCountries.join(',') : 'us';

    await db.setSetting('telegram_token', telegramToken || '');
    await db.setSetting('telegram_chat_id', telegramChatId || '');
    await db.setSetting('developer_name', developerName || '');
    await db.setSetting('store_country', storeCountryStr);
    
    await db.setSetting('api_mode', apiMode || 'public');
    await db.setSetting('asc_issuer_id', ascIssuerId || '');
    await db.setSetting('asc_key_id', ascKeyId || '');
    
    if (ascPrivateKey && ascPrivateKey !== '***HIDDEN***') {
      // Normalize the private key: replace literal \n strings with real newlines
      // and ensure it starts/ends correctly
      let normalizedKey = ascPrivateKey.replace(/\\n/g, '\n');
      if (!normalizedKey.includes('\n')) {
          // If the user pasted it as a single line without literal \n, try to reconstruct it
          normalizedKey = normalizedKey.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n');
          normalizedKey = normalizedKey.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
          // Add line breaks every 64 characters for the body
          const body = normalizedKey.replace('-----BEGIN PRIVATE KEY-----\n', '').replace('\n-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
          const chunked = body.match(/.{1,64}/g)?.join('\n') || body;
          normalizedKey = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----`;
      }
      await db.setSetting('asc_private_key', normalizedKey);
    }
    
    // Re-initialize bot only if telegram credentials changed
    if (telegramToken !== oldTelegramToken || telegramChatId !== oldTelegramChatId) {
      await initBot(telegramToken, telegramChatId);
    }

    if (developerName !== oldDevName || storeCountryStr !== oldStoreCountry || apiMode !== oldApiMode) {
        // Clear reviews because the developer, country or api mode changed
        db.run('DELETE FROM reviews', (err) => {
            if (!err) {
              // Trigger a fresh scrape in the background without sending initial notifications
              scrapeReviews(true);
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
    
    // Augment with actual review counts and ratings from our database
    db.all('SELECT app_id, country, COUNT(*) as actual_count, AVG(rating) as actual_rating FROM reviews GROUP BY app_id, country', (err, rows) => {
      if (err) {
        return res.json(apps);
      }
      
      const dbMap = {};
      rows.forEach(row => {
        if (!dbMap[row.app_id]) dbMap[row.app_id] = {};
        dbMap[row.app_id][row.country] = { count: row.actual_count, rating: row.actual_rating };
      });

      apps.forEach(app => {
        const dbData = dbMap[app.id] || {};
        
        // Update existing countries
        app.ratingsByCountry.forEach(r => {
           const dbInfo = dbData[r.country];
           if (dbInfo) {
               // If our DB has more reviews than the API reports (e.g. API says 0),
               // OR if API rating is 0, use our DB as the single source of truth for both count and rating
               if (dbInfo.count >= r.count || r.rating === 0) {
                   r.count = dbInfo.count;
                   r.rating = dbInfo.rating;
               }
           }
           delete dbData[r.country]; // Mark as processed
        });
        
        // Add remaining countries from DB that iTunes Search API missed
        Object.keys(dbData).forEach(country => {
            app.ratingsByCountry.push({
                country: country,
                rating: dbData[country].rating,
                count: dbData[country].count
            });
        });
      });
      res.json(apps);
    });
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

setTimeout(() => {
  scrapeReviews(true);
}, 2000); // Wait 2s to ensure DB is initialized

// Setup polling interval
setInterval(() => {
  scrapeReviews();
}, POLL_INTERVAL_MINUTES * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Polling interval set to ${POLL_INTERVAL_MINUTES} minutes.`);
});
