const db = require('./db');
const { sendReviewNotification } = require('./telegram');



// Fetch all Mac apps for the developer
async function fetchDeveloperApps() {
  try {
    const devTerm = await db.getSetting('developer_name') || process.env.DEVELOPER_TERM;
    if (!devTerm || devTerm.trim() === '' || devTerm === 'Your Developer Name') {
      return [];
    }
    
    const storeCountryStr = await db.getSetting('store_country') || process.env.STORE_COUNTRY || 'us';
    const storeCountries = storeCountryStr.split(',');
    const encodedTerm = encodeURIComponent(devTerm.trim()).replace(/%20/g, '+');
    
    const appsMap = new Map();

    for (const storeCountry of storeCountries) {
        try {
            const url = `https://itunes.apple.com/search?term=${encodedTerm}&entity=macSoftware&attribute=softwareDeveloper&country=${storeCountry.trim()}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.results) {
                const searchLower = devTerm.trim().toLowerCase();
                const filteredResults = data.results.filter(app => {
                    return app.artistName && app.artistName.toLowerCase().includes(searchLower);
                });
                
                filteredResults.forEach(app => {
                    const id = app.trackId.toString();
                    if (!appsMap.has(id)) {
                        appsMap.set(id, {
                            id: id,
                            name: app.trackName,
                            rating: app.averageUserRating || 0,
                            ratingCount: app.userRatingCount || 0,
                            iconUrl: app.artworkUrl512 || app.artworkUrl100 || ''
                        });
                    } else {
                        // Aggregate ratings if we want, or just keep the first found.
                        // We will keep the first found metadata since reviews come from DB anyway.
                    }
                });
            }
        } catch (err) {
            console.error(`Error fetching apps for country ${storeCountry}:`, err);
        }
    }
    
    return Array.from(appsMap.values());
  } catch (error) {
    console.error('Error fetching developer apps:', error);
    return [];
  }
}

// Fetch reviews for a specific app
async function fetchAppReviews(appId, storeCountry) {
  try {
    const url = `https://itunes.apple.com/${storeCountry}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
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
  const storeCountryStr = await db.getSetting('store_country') || process.env.STORE_COUNTRY || 'us';
  const storeCountries = storeCountryStr.split(',').map(c => c.trim());
  console.log(`Found ${apps.length} apps for developer. Using store countries: ${storeCountries.join(', ')}`);

  for (const app of apps) {
    for (const storeCountry of storeCountries) {
      const reviews = await fetchAppReviews(app.id, storeCountry);
      console.log(`Fetched ${reviews.length} reviews for ${app.name} (${app.id}) in ${storeCountry}`);
      
      for (const review of reviews) {
        // Check if review exists
        db.get('SELECT id FROM reviews WHERE id = ?', [review.id], async (err, row) => {
          if (err) {
            console.error('Database error:', err);
            return;
          }
          
          if (!row) {
            // New review found
            console.log(`New review found for ${app.name} [${storeCountry}]: ${review.title}`);
            
            // Insert into DB
            db.run(
              `INSERT INTO reviews (id, app_id, author_name, author_uri, version, rating, title, content, updated_at, country) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [review.id, app.id, review.author_name, review.author_uri, review.version, review.rating, review.title, review.content, review.updated_at, storeCountry],
              (insertErr) => {
                if (insertErr) {
                  console.error('Error inserting review:', insertErr);
                } else {
                  // Send notification only if successfully saved to avoid spam
                  sendReviewNotification(review, app.name, app.iconUrl, storeCountry);
                }
              }
            );
          }
        });
      }
    }
  }
}

module.exports = { scrapeReviews, fetchDeveloperApps };
