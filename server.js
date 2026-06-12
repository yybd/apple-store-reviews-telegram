require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { scrapeReviews, resetAndRescrape, fetchDeveloperApps, testAscCredentials } = require('./scraper');
const { initBot, isBotConnected } = require('./telegram');

const app = express();
app.use(express.json());

const HIDDEN = '***HIDDEN***';

// Basic Auth Middleware
const authFile = path.join(__dirname, 'data', 'auth.json');

const readAuthFile = () => {
  if (fs.existsSync(authFile)) {
    try {
      return JSON.parse(fs.readFileSync(authFile, 'utf8'));
    } catch (e) {
      console.error('Error reading auth.json', e);
    }
  }
  return null;
};

const basicAuth = (req, res, next) => {
  const authData = readAuthFile();
  const user = (authData && authData.user) || process.env.DASHBOARD_USER;
  const pass = (authData && authData.pass) || process.env.DASHBOARD_PASS;

  if (!user || !pass) {
    return next();
  }

  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login && password && login === user && password === pass) {
    return next();
  }

  res.status(401).json({ error: 'Authentication required', auth: true });
};

// Mount API routes with auth
app.use('/api', basicAuth);

const PORT = process.env.PORT || 3000;

// How often to check for new reviews (applies to both Public and Private API modes).
// Configured from the Settings UI and stored in the DB; the env var is only an
// optional deployment fallback for when nothing was set in the UI yet.
const DEFAULT_POLL_MINUTES = 60;
const MIN_POLL_MINUTES = 5;
const MAX_POLL_MINUTES = 1440;

async function getPollIntervalMinutes() {
  const fromDb = parseInt(await db.getSetting('poll_interval_minutes'), 10);
  if (Number.isFinite(fromDb) && fromDb >= MIN_POLL_MINUTES && fromDb <= MAX_POLL_MINUTES) return fromDb;
  const fromEnv = parseInt(process.env.POLL_INTERVAL_MINUTES, 10);
  if (Number.isFinite(fromEnv) && fromEnv >= MIN_POLL_MINUTES && fromEnv <= MAX_POLL_MINUTES) return fromEnv;
  return DEFAULT_POLL_MINUTES;
}

// Self-rescheduling timer (instead of a fixed setInterval) so a new interval
// saved in the Settings UI takes effect immediately, without a server restart
let pollTimer = null;
async function schedulePolling() {
  const minutes = await getPollIntervalMinutes();
  // Clear and set back-to-back (after the await) so concurrent calls can never
  // leave two live timers behind
  if (pollTimer) clearTimeout(pollTimer);
  console.log(`Next review check in ${minutes} minutes.`);
  pollTimer = setTimeout(async () => {
    try {
      await scrapeReviews();
    } catch (e) {
      console.error('Scheduled scrape failed:', e);
    }
    schedulePolling();
  }, minutes * 60 * 1000);
}

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
      telegramConnected: isBotConnected(),
      apiMode: await db.getSetting('api_mode') || 'public'
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
    const storeCountries = storeCountryStr.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);

    const apiMode = await db.getSetting('api_mode') || 'public';
    const ascIssuerId = await db.getSetting('asc_issuer_id') || '';
    const ascKeyId = await db.getSetting('asc_key_id') || '';
    const ascPrivateKeyRaw = await db.getSetting('asc_private_key') || '';
    const ascPrivateKey = ascPrivateKeyRaw ? HIDDEN : '';

    let dashboardUser = process.env.DASHBOARD_USER || '';
    let dashboardPass = process.env.DASHBOARD_PASS ? HIDDEN : '';
    const authData = readAuthFile();
    if (authData) {
      dashboardUser = authData.user || '';
      dashboardPass = authData.pass ? HIDDEN : '';
    }

    res.json({
      // Never send secrets back in clear text; the sentinel round-trips as "keep current"
      telegramToken: token ? HIDDEN : '',
      telegramChatId: chatId,
      developerName,
      storeCountries,
      apiMode,
      ascIssuerId,
      ascKeyId,
      ascPrivateKey,
      dashboardUser,
      dashboardPass,
      pollIntervalMinutes: await getPollIntervalMinutes()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Normalize a pasted .p8 key: convert literal \n to real newlines, and rebuild
// the PEM structure if the user pasted it as one long line
const normalizePrivateKey = (rawKey) => {
  let normalizedKey = rawKey.replace(/\\n/g, '\n');
  if (!normalizedKey.includes('\n')) {
    normalizedKey = normalizedKey.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n');
    normalizedKey = normalizedKey.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
    const body = normalizedKey.replace('-----BEGIN PRIVATE KEY-----\n', '').replace('\n-----END PRIVATE KEY-----', '').replace(/\s+/g, '');
    const chunked = body.match(/.{1,64}/g)?.join('\n') || body;
    normalizedKey = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----`;
  }
  return normalizedKey;
};

app.post('/api/settings', async (req, res) => {
  const { telegramToken, telegramChatId, developerName, storeCountries, apiMode, ascIssuerId, ascKeyId, ascPrivateKey, dashboardUser, dashboardPass, pollIntervalMinutes } = req.body;

  try {
    // Load current values: needed to resolve "keep current" sentinels and to detect changes
    const oldDevName = await db.getSetting('developer_name') || '';
    const oldStoreCountry = await db.getSetting('store_country') || 'us';
    const oldApiMode = await db.getSetting('api_mode') || 'public';
    const oldAscIssuerId = await db.getSetting('asc_issuer_id') || '';
    const oldAscKeyId = await db.getSetting('asc_key_id') || '';
    const oldAscKey = await db.getSetting('asc_private_key') || '';
    const oldTelegramToken = (await db.getSetting('telegram_token')) || process.env.TELEGRAM_BOT_TOKEN || '';
    const oldTelegramChatId = (await db.getSetting('telegram_chat_id')) || process.env.TELEGRAM_CHAT_ID || '';

    const newApiMode = apiMode === 'private' ? 'private' : 'public';
    const newDevName = (developerName || '').trim();
    const newTelegramToken = telegramToken === HIDDEN ? oldTelegramToken : (telegramToken || '').trim();
    const newTelegramChatId = (telegramChatId || '').trim();
    const newAscIssuerId = (ascIssuerId || '').trim();
    const newAscKeyId = (ascKeyId || '').trim();

    const storeCountryStr = Array.isArray(storeCountries)
      ? [...new Set(storeCountries.map(c => String(c).trim().toLowerCase()).filter(Boolean))].join(',') || 'us'
      : 'us';

    // Resolve the ASC private key (sentinel or empty means "keep the saved one")
    let newAscKey = oldAscKey;
    if (ascPrivateKey && ascPrivateKey !== HIDDEN) {
      newAscKey = normalizePrivateKey(ascPrivateKey);
    }

    // Validate the polling interval (absent means "keep current")
    let newPollInterval = null;
    if (pollIntervalMinutes !== undefined) {
      const n = parseInt(pollIntervalMinutes, 10);
      if (!Number.isFinite(n) || n < MIN_POLL_MINUTES || n > MAX_POLL_MINUTES) {
        return res.status(400).json({ success: false, error: `Check interval must be between ${MIN_POLL_MINUTES} and ${MAX_POLL_MINUTES} minutes` });
      }
      newPollInterval = n;
    }

    // Resolve dashboard credentials (validation only at this stage — nothing is written yet)
    let dashboardAction = null;
    if (dashboardUser !== undefined && dashboardPass !== undefined) {
      let newPass = dashboardPass;
      if (dashboardPass === HIDDEN) {
        const authData = readAuthFile();
        newPass = (authData && authData.pass) || process.env.DASHBOARD_PASS || '';
      }
      if (dashboardUser && newPass) {
        dashboardAction = { type: 'write', user: dashboardUser, pass: newPass };
      } else if (!dashboardUser && !newPass) {
        dashboardAction = { type: 'remove' };
      } else {
        return res.status(400).json({ success: false, error: 'Dashboard username and password must both be set (or both left empty to disable protection)' });
      }
    }

    // Validate ASC credentials BEFORE saving anything, so a bad key can't leave
    // the app stuck in private mode with broken credentials
    if (newApiMode === 'private') {
      const testResult = await testAscCredentials(newAscIssuerId, newAscKeyId, newAscKey);
      if (!testResult.valid) {
        return res.status(400).json({ success: false, error: testResult.error });
      }
    }

    // --- All validations passed; persist everything ---
    if (dashboardAction) {
      if (dashboardAction.type === 'write') {
        fs.writeFileSync(authFile, JSON.stringify({ user: dashboardAction.user, pass: dashboardAction.pass }), 'utf8');
      } else if (fs.existsSync(authFile)) {
        fs.unlinkSync(authFile);
      }
    }

    await db.setSetting('telegram_token', newTelegramToken);
    await db.setSetting('telegram_chat_id', newTelegramChatId);
    await db.setSetting('developer_name', newDevName);
    await db.setSetting('store_country', storeCountryStr);
    await db.setSetting('api_mode', newApiMode);
    await db.setSetting('asc_issuer_id', newAscIssuerId);
    await db.setSetting('asc_key_id', newAscKeyId);
    await db.setSetting('asc_private_key', newAscKey);

    if (newPollInterval !== null) {
      const oldPollInterval = await getPollIntervalMinutes();
      await db.setSetting('poll_interval_minutes', String(newPollInterval));
      if (newPollInterval !== oldPollInterval) {
        schedulePolling().catch(err => console.error('Failed to reschedule polling:', err));
      }
    }

    // Re-initialize bot only if telegram credentials changed
    if (newTelegramToken !== oldTelegramToken || newTelegramChatId !== oldTelegramChatId) {
      await initBot(newTelegramToken, newTelegramChatId);
    }

    // If anything that defines the review set changed, wipe and re-seed the reviews
    // (resetAndRescrape mutes notifications so the chat isn't flooded with old reviews)
    const ascCredsChanged = newApiMode === 'private' &&
      (newAscIssuerId !== oldAscIssuerId || newAscKeyId !== oldAscKeyId || newAscKey !== oldAscKey);
    if (newDevName !== oldDevName || storeCountryStr !== oldStoreCountry || newApiMode !== oldApiMode || ascCredsChanged) {
      resetAndRescrape().catch(err => console.error('Reset & rescrape failed:', err));
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
  try {
    // Deep-clone so the augmentation below never mutates the scraper's cached list
    const apps = JSON.parse(JSON.stringify(await fetchDeveloperApps()));

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
  // Start the recurring check (covers both Public RSS and Private ASC API modes)
  schedulePolling().catch(err => console.error('Failed to schedule polling:', err));
}, 2000); // Wait 2s to ensure DB is initialized

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
