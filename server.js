require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const { scrapeReviews } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MINUTES = parseInt(process.env.POLL_INTERVAL_MINUTES || '15', 10);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Coolify
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Test Telegram notification
app.post('/api/test-telegram', async (req, res) => {
  const { sendReviewNotification } = require('./telegram');
  const testReview = {
    id: 'test-123',
    rating: 5,
    title: 'Test Notification',
    content: 'This is a test notification to verify your Telegram integration is working properly. 🎉',
    author_name: 'System Test',
    version: '1.0'
  };
  await sendReviewNotification(testReview, 'Test App');
  res.json({ success: true, message: 'Test message triggered' });
});

// API endpoint to get all reviews, sorted by newest
app.get('/api/reviews', (req, res) => {
  db.all('SELECT * FROM reviews ORDER BY updated_at DESC', [], (err, rows) => {
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
