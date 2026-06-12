const db = require('./db');
const { sendReviewNotification } = require('./telegram');
const jwt = require('jsonwebtoken');

// Map ISO 3166-1 alpha-3 territory codes to alpha-2 country codes
const territoryToCountryMap = {
    'USA': 'us', 'GBR': 'gb', 'ISR': 'il', 'CAN': 'ca', 'AUS': 'au',
    'DEU': 'de', 'FRA': 'fr', 'JPN': 'jp', 'CHN': 'cn', 'ITA': 'it',
    'ESP': 'es', 'BRA': 'br', 'RUS': 'ru', 'KOR': 'kr', 'NLD': 'nl',
    'SWE': 'se', 'CHE': 'ch', 'MEX': 'mx', 'IND': 'in', 'ZAF': 'za',
    'TUR': 'tr', 'ARE': 'ae'
};

function getCountryCode(territory) {
    if (!territory) return 'us';
    return territoryToCountryMap[territory.toUpperCase()] || territory.substring(0, 2).toLowerCase();
}

async function generateAscToken() {
    const issuerId = await db.getSetting('asc_issuer_id');
    const keyId = await db.getSetting('asc_key_id');
    const privateKey = await db.getSetting('asc_private_key');
    if (!issuerId || !keyId || !privateKey) return null;
    try {
        const payload = {
            iss: issuerId,
            exp: Math.floor(Date.now() / 1000) + 20 * 60,
            aud: "appstoreconnect-v1"
        };
        return jwt.sign(payload, privateKey, { algorithm: 'ES256', keyid: keyId });
    } catch (e) {
        console.error('Error generating ASC token', e);
        return null;
    }
}

async function testAscCredentials(issuerId, keyId, privateKey) {
    try {
        const payload = {
            iss: issuerId,
            exp: Math.floor(Date.now() / 1000) + 2 * 60,
            aud: "appstoreconnect-v1"
        };
        const token = jwt.sign(payload, privateKey, { algorithm: 'ES256', keyid: keyId });
        
        const response = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=1', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 401) {
            return { valid: false, error: 'Unauthorized: Invalid Key ID, Issuer ID, or Private Key' };
        } else if (!response.ok) {
            return { valid: false, error: `Apple API Error: ${response.status} ${response.statusText}` };
        }
        
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message || 'Invalid Private Key format' };
    }
}

async function fetchDeveloperAppsPrivate() {
    const token = await generateAscToken();
    if (!token) return [];
    
    try {
        const response = await fetch('https://api.appstoreconnect.apple.com/v1/apps', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.data) return [];
        
        const appsMap = new Map();
        data.data.forEach(app => {
            appsMap.set(app.id, {
                id: app.id,
                name: app.attributes.name,
                iconUrl: '', // Will populate via lookup
                platforms: [],
                ratingsByCountry: []
            });
        });
        
        const ids = data.data.map(app => app.id);
        if (ids.length > 0) {
            const itunesResponse = await fetch(`https://itunes.apple.com/lookup?id=${ids.join(',')}`);
            const itunesData = await itunesResponse.json();
            
            itunesData.results.forEach(app => {
                const id = app.trackId.toString();
                if (appsMap.has(id)) {
                    const existing = appsMap.get(id);
                    existing.iconUrl = app.artworkUrl100 || app.artworkUrl60 || app.artworkUrl512 || '';
                    const platformStr = app.kind === 'mac-software' ? 'Mac' : 'iOS/iPad';
                    if (!existing.platforms.includes(platformStr)) {
                        existing.platforms.push(platformStr);
                    }
                    existing.isPublished = true;
                }
            });
            
            // Mark remaining apps as unpublished
            appsMap.forEach(app => {
                if (app.isPublished === undefined) {
                    app.isPublished = false;
                }
            });
        }
        
        return Array.from(appsMap.values());
    } catch (e) {
        console.error('Error in fetchDeveloperAppsPrivate:', e);
        return [];
    }
}

async function scrapeReviewsPrivate(isInitial = false) {
    console.log(`Starting Private API scrape at ${new Date().toISOString()}...`);
    const apps = await fetchDeveloperAppsPrivate();
    if (apps.length === 0) {
      console.log('No apps found via Private API or token missing.');
      return;
    }
    
    const token = await generateAscToken();
    if (!token) return;

    for (const app of apps) {
        try {
            const url = `https://api.appstoreconnect.apple.com/v1/apps/${app.id}/customerReviews?limit=200`;
            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await response.json();
            
            if (!data.data) continue;
            const reviews = data.data;
            console.log(`Fetched ${reviews.length} reviews for ${app.name} (${app.id}) via Private API`);
            
            for (const item of reviews) {
                const review = item.attributes;
                const reviewId = item.id;
                const storeCountry = getCountryCode(review.territory);
                
                db.get('SELECT id FROM reviews WHERE id = ?', [reviewId], async (err, row) => {
                    if (err) return;
                    if (!row) {
                        console.log(`New review found via Private API: ${review.title}`);
                        
                        db.run(
                            `INSERT INTO reviews (id, app_id, author_name, author_uri, version, rating, title, content, updated_at, country) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [reviewId, app.id, review.reviewerNickname, '', 'N/A', review.rating, review.title, review.body, review.createdDate, storeCountry],
                            (insertErr) => {
                                if (!insertErr && !isInitial) {
                                    const notifyReview = {
                                        id: reviewId, author_name: review.reviewerNickname,
                                        version: 'N/A', rating: review.rating,
                                        title: review.title, content: review.body
                                    };
                                    sendReviewNotification(notifyReview, app.name, app.iconUrl, storeCountry);
                                }
                            }
                        );
                    }
                });
            }
        } catch (e) {
            console.error(`Error fetching customer reviews for app ${app.id}:`, e);
        }
    }
}



// Fetch all Mac apps for the developer
async function fetchDeveloperApps() {
  try {
    const apiMode = await db.getSetting('api_mode') || 'public';
    if (apiMode === 'private') {
        return await fetchDeveloperAppsPrivate();
    }
    
    const devTerm = await db.getSetting('developer_name') || process.env.DEVELOPER_TERM;
    if (!devTerm || devTerm.trim() === '' || devTerm === 'Your Developer Name') {
      return [];
    }
    
    const storeCountryStr = await db.getSetting('store_country') || process.env.STORE_COUNTRY || 'us';
    const storeCountries = storeCountryStr.split(',');
    const encodedTerm = encodeURIComponent(devTerm.trim()).replace(/%20/g, '+');
    
    const appsMap = new Map();

    for (const storeCountry of storeCountries) {
        for (const entity of ['macSoftware', 'software']) {
            try {
                const url = `https://itunes.apple.com/search?term=${encodedTerm}&entity=${entity}&attribute=softwareDeveloper&country=${storeCountry.trim()}`;
                const response = await fetch(url);
                const data = await response.json();
            
            if (data.results) {
                const searchLower = devTerm.trim().toLowerCase();
                const filteredResults = data.results.filter(app => {
                    return app.artistName && app.artistName.toLowerCase().includes(searchLower);
                });
                
                filteredResults.forEach(app => {
                    const id = app.trackId.toString();
                    const currentRating = app.averageUserRating || 0;
                    const currentCount = app.userRatingCount || 0;
                    const platformStr = app.kind === 'mac-software' ? 'Mac' : 'iOS/iPad';
                    
                    if (!appsMap.has(id)) {
                        appsMap.set(id, {
                            id: id,
                            name: app.trackName,
                            iconUrl: app.artworkUrl100 || app.artworkUrl60 || app.artworkUrl512 || '',
                            platforms: [platformStr],
                            ratingsByCountry: []
                        });
                    } else {
                        const existing = appsMap.get(id);
                        if (!existing.platforms.includes(platformStr)) {
                            existing.platforms.push(platformStr);
                        }
                    }
                    
                    const existing = appsMap.get(id);
                    const existingCountryIndex = existing.ratingsByCountry.findIndex(r => r.country === storeCountry);
                    
                    if (existingCountryIndex === -1) {
                        existing.ratingsByCountry.push({
                            country: storeCountry,
                            rating: currentRating,
                            count: currentCount
                        });
                    } else {
                        // If it exists, just update rating/count if they are 0
                        if (existing.ratingsByCountry[existingCountryIndex].count === 0 && currentCount > 0) {
                             existing.ratingsByCountry[existingCountryIndex].rating = currentRating;
                             existing.ratingsByCountry[existingCountryIndex].count = currentCount;
                        }
                    }
                });
            }
        } catch (err) {
            console.error(`Error fetching apps for country ${storeCountry}:`, err);
        }
        } // close entity loop
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
async function scrapeReviews(isInitial = false) {
  console.log(`Starting review scrape cycle... (Initial: ${isInitial})`);
  
  const apiMode = await db.getSetting('api_mode') || 'public';
  if (apiMode === 'private') {
      return await scrapeReviewsPrivate(isInitial);
  }
  
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
                } else if (!isInitial) {
                  // Send notification only if successfully saved and it's not the initial scrape to avoid spam
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

module.exports = { scrapeReviews, fetchDeveloperApps, testAscCredentials };
