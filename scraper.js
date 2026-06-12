const db = require('./db');
const { sendReviewNotification } = require('./telegram');

const STORE_COUNTRY = process.env.STORE_COUNTRY || 'us';

// Fetch all Mac apps for the developer
async function fetchDeveloperApps() {
  try {
    const devTerm = await db.getSetting('developer_name') || process.env.DEVELOPER_TERM;
    if (!devTerm || devTerm.trim() === '' || devTerm === 'Your Developer Name') {
      return [];
    }
    
    const encodedTerm = encodeURIComponent(devTerm.trim()).replace(/%20/g, '+');
    const url = `https://itunes.apple.com/search?term=${encodedTerm}&entity=macSoftware&attribute=softwareDeveloper`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.results) return [];
    
    const searchLower = devTerm.trim().toLowerCase();
    const filteredResults = data.results.filter(app => {
      return app.artistName && app.artistName.toLowerCase().includes(searchLower);
    });
    
    return filteredResults.map(app => ({
      id: app.trackId,
      name: app.trackName,
      rating: app.averageUserRating || 0,
      ratingCount: app.userRatingCount || 0,
      iconUrl: app.artworkUrl512 || app.artworkUrl100 || ''
    }));
  } catch (error) {
    console.error('Error fetching developer apps:', error);
    return [];
  }
}

// Fetch reviews for a specific app
async function fetchAppReviews(appId) {
  try {
    const url = `https://itunes.apple.com/${STORE_COUNTRY}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
    const response = await fetch(url);
    const data = await response.json();
    
    // The RSS feed structure
    const entries = data?.feed?.entry || [];
    
    // Skip if it's just the app info entry (iTunes feed sometimes returns the app as the first entry)
    return entries.filter(entry => entry.author && entry.author.name).map(entry => ({
      id: entry.id.label,
      author_name: entry.author.name.label,
      author_uri: entry.author.uri ? entry.author.uri.label : '',
      version: entry['im:version'].label,
      rating: parseInt(entry['im:rating'].label, 10),
      title: entry.title.label,
      content: entry.content.label,
      updated_at: entry.updated.label
    }));
  } catch (error) {
    console.error(`Error fetching reviews for app ${appId}:`, error);
    return [];
  }
}

// Main scraping loop
async function scrapeReviews() {
  console.log('Starting review scrape cycle...');
  const apps = await fetchDeveloperApps();
  console.log(`Found ${apps.length} apps for developer.`);

  for (const app of apps) {
    const reviews = await fetchAppReviews(app.id);
    console.log(`Fetched ${reviews.length} reviews for ${app.name} (${app.id})`);
    
    for (const review of reviews) {
      // Check if review exists
      db.get('SELECT id FROM reviews WHERE id = ?', [review.id], async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return;
        }
        
        if (!row) {
          // New review found
          console.log(`New review found for ${app.name}: ${review.title}`);
          
          // Insert into DB
          db.run(
            `INSERT INTO reviews (id, app_id, author_name, author_uri, version, rating, title, content, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [review.id, app.id, review.author_name, review.author_uri, review.version, review.rating, review.title, review.content, review.updated_at],
            (insertErr) => {
              if (insertErr) {
                console.error('Error inserting review:', insertErr);
              } else {
                // Send notification only if successfully saved to avoid spam
                sendReviewNotification(review, app.name, app.iconUrl);
              }
            }
          );
        }
      });
    }
  }
}

module.exports = { scrapeReviews, fetchDeveloperApps };
