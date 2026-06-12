const db = require('./db');
const { sendReviewNotification } = require('./telegram');
const jwt = require('jsonwebtoken');

// Full ISO 3166-1 alpha-3 -> alpha-2 mapping.
// App Store Connect reports review territories as alpha-3; iTunes feeds and flag emojis use alpha-2.
const territoryToCountryMap = {
    AFG: 'af', ALA: 'ax', ALB: 'al', DZA: 'dz', ASM: 'as', AND: 'ad', AGO: 'ao', AIA: 'ai', ATA: 'aq', ATG: 'ag',
    ARG: 'ar', ARM: 'am', ABW: 'aw', AUS: 'au', AUT: 'at', AZE: 'az', BHS: 'bs', BHR: 'bh', BGD: 'bd', BRB: 'bb',
    BLR: 'by', BEL: 'be', BLZ: 'bz', BEN: 'bj', BMU: 'bm', BTN: 'bt', BOL: 'bo', BES: 'bq', BIH: 'ba', BWA: 'bw',
    BVT: 'bv', BRA: 'br', IOT: 'io', BRN: 'bn', BGR: 'bg', BFA: 'bf', BDI: 'bi', CPV: 'cv', KHM: 'kh', CMR: 'cm',
    CAN: 'ca', CYM: 'ky', CAF: 'cf', TCD: 'td', CHL: 'cl', CHN: 'cn', CXR: 'cx', CCK: 'cc', COL: 'co', COM: 'km',
    COG: 'cg', COD: 'cd', COK: 'ck', CRI: 'cr', CIV: 'ci', HRV: 'hr', CUB: 'cu', CUW: 'cw', CYP: 'cy', CZE: 'cz',
    DNK: 'dk', DJI: 'dj', DMA: 'dm', DOM: 'do', ECU: 'ec', EGY: 'eg', SLV: 'sv', GNQ: 'gq', ERI: 'er', EST: 'ee',
    SWZ: 'sz', ETH: 'et', FLK: 'fk', FRO: 'fo', FJI: 'fj', FIN: 'fi', FRA: 'fr', GUF: 'gf', PYF: 'pf', ATF: 'tf',
    GAB: 'ga', GMB: 'gm', GEO: 'ge', DEU: 'de', GHA: 'gh', GIB: 'gi', GRC: 'gr', GRL: 'gl', GRD: 'gd', GLP: 'gp',
    GUM: 'gu', GTM: 'gt', GGY: 'gg', GIN: 'gn', GNB: 'gw', GUY: 'gy', HTI: 'ht', HMD: 'hm', VAT: 'va', HND: 'hn',
    HKG: 'hk', HUN: 'hu', ISL: 'is', IND: 'in', IDN: 'id', IRN: 'ir', IRQ: 'iq', IRL: 'ie', IMN: 'im', ISR: 'il',
    ITA: 'it', JAM: 'jm', JPN: 'jp', JEY: 'je', JOR: 'jo', KAZ: 'kz', KEN: 'ke', KIR: 'ki', PRK: 'kp', KOR: 'kr',
    KWT: 'kw', KGZ: 'kg', LAO: 'la', LVA: 'lv', LBN: 'lb', LSO: 'ls', LBR: 'lr', LBY: 'ly', LIE: 'li', LTU: 'lt',
    LUX: 'lu', MAC: 'mo', MDG: 'mg', MWI: 'mw', MYS: 'my', MDV: 'mv', MLI: 'ml', MLT: 'mt', MHL: 'mh', MTQ: 'mq',
    MRT: 'mr', MUS: 'mu', MYT: 'yt', MEX: 'mx', FSM: 'fm', MDA: 'md', MCO: 'mc', MNG: 'mn', MNE: 'me', MSR: 'ms',
    MAR: 'ma', MOZ: 'mz', MMR: 'mm', NAM: 'na', NRU: 'nr', NPL: 'np', NLD: 'nl', NCL: 'nc', NZL: 'nz', NIC: 'ni',
    NER: 'ne', NGA: 'ng', NIU: 'nu', NFK: 'nf', MKD: 'mk', MNP: 'mp', NOR: 'no', OMN: 'om', PAK: 'pk', PLW: 'pw',
    PSE: 'ps', PAN: 'pa', PNG: 'pg', PRY: 'py', PER: 'pe', PHL: 'ph', PCN: 'pn', POL: 'pl', PRT: 'pt', PRI: 'pr',
    QAT: 'qa', REU: 're', ROU: 'ro', RUS: 'ru', RWA: 'rw', BLM: 'bl', SHN: 'sh', KNA: 'kn', LCA: 'lc', MAF: 'mf',
    SPM: 'pm', VCT: 'vc', WSM: 'ws', SMR: 'sm', STP: 'st', SAU: 'sa', SEN: 'sn', SRB: 'rs', SYC: 'sc', SLE: 'sl',
    SGP: 'sg', SXM: 'sx', SVK: 'sk', SVN: 'si', SLB: 'sb', SOM: 'so', ZAF: 'za', SGS: 'gs', SSD: 'ss', ESP: 'es',
    LKA: 'lk', SDN: 'sd', SUR: 'sr', SJM: 'sj', SWE: 'se', CHE: 'ch', SYR: 'sy', TWN: 'tw', TJK: 'tj', TZA: 'tz',
    THA: 'th', TLS: 'tl', TGO: 'tg', TKL: 'tk', TON: 'to', TTO: 'tt', TUN: 'tn', TUR: 'tr', TKM: 'tm', TCA: 'tc',
    TUV: 'tv', UGA: 'ug', UKR: 'ua', ARE: 'ae', GBR: 'gb', USA: 'us', UMI: 'um', URY: 'uy', UZB: 'uz', VUT: 'vu',
    VEN: 've', VNM: 'vn', VGB: 'vg', VIR: 'vi', WLF: 'wf', ESH: 'eh', YEM: 'ye', ZMB: 'zm', ZWE: 'zw'
};

function getCountryCode(territory) {
    if (!territory) return 'us';
    const code = String(territory).trim().toUpperCase();
    if (territoryToCountryMap[code]) return territoryToCountryMap[code];
    if (code.length === 2) return code.toLowerCase();
    return code.substring(0, 2).toLowerCase();
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function getStoreCountries() {
    const storeCountryStr = await db.getSetting('store_country') || process.env.STORE_COUNTRY || 'us';
    const countries = storeCountryStr.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    return [...new Set(countries)];
}

// Atomically insert a review; returns true only if it was actually new.
// INSERT OR IGNORE avoids the check-then-insert race between overlapping scrape cycles.
async function saveReviewIfNew(review, appId, country) {
    const result = await dbRun(
        `INSERT OR IGNORE INTO reviews (id, app_id, author_name, author_uri, version, rating, title, content, updated_at, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [review.id, appId, review.author_name, review.author_uri || '', review.version, review.rating, review.title, review.content, review.updated_at, country]
    );
    return result.changes > 0;
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
        if (!issuerId || !keyId || !privateKey) {
            return { valid: false, error: 'Issuer ID, Key ID and Private Key are all required for the Private API' };
        }
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
        const response = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=200', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            console.error(`ASC apps request failed: ${response.status} ${response.statusText}`);
            return [];
        }
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
            // The iTunes lookup is best-effort: if it fails we still return the ASC apps,
            // just without icons / published flags.
            try {
                const itunesResponse = await fetch(`https://itunes.apple.com/lookup?id=${ids.join(',')}`);
                const itunesData = await itunesResponse.json();

                (itunesData.results || []).forEach(app => {
                    if (!app.trackId) return;
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
            } catch (lookupErr) {
                console.error('iTunes lookup failed (continuing without icons):', lookupErr);
            }
        }

        return Array.from(appsMap.values());
    } catch (e) {
        console.error('Error in fetchDeveloperAppsPrivate:', e);
        return [];
    }
}

async function scrapeReviewsPrivate(isInitial = false) {
    console.log(`Starting Private API scrape at ${new Date().toISOString()}...`);
    const apps = await fetchDeveloperApps();
    if (apps.length === 0) {
        console.log('No apps found via Private API or token missing.');
        return;
    }

    const token = await generateAscToken();
    if (!token) return;

    for (const app of apps) {
        try {
            const url = `https://api.appstoreconnect.apple.com/v1/apps/${app.id}/customerReviews?limit=200&sort=-createdDate`;
            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!response.ok) {
                console.error(`ASC reviews request failed for ${app.name} (${app.id}): ${response.status}`);
                continue;
            }
            const data = await response.json();

            const reviews = data.data || [];
            console.log(`Fetched ${reviews.length} reviews for ${app.name} (${app.id}) via Private API`);

            for (const item of reviews) {
                const attrs = item.attributes || {};
                const storeCountry = getCountryCode(attrs.territory);
                const review = {
                    id: item.id,
                    author_name: attrs.reviewerNickname || 'Anonymous',
                    author_uri: '',
                    version: 'N/A',
                    rating: attrs.rating,
                    title: attrs.title || '',
                    content: attrs.body || '',
                    updated_at: attrs.createdDate
                };

                try {
                    const isNew = await saveReviewIfNew(review, app.id, storeCountry);
                    if (isNew) {
                        console.log(`New review found via Private API: ${review.title}`);
                        if (!isInitial && !notificationsMuted) {
                            await sendReviewNotification(review, app.name, app.iconUrl, storeCountry);
                        }
                    }
                } catch (saveErr) {
                    console.error('Error saving review:', saveErr);
                }
            }
        } catch (e) {
            console.error(`Error fetching customer reviews for app ${app.id}:`, e);
        }
    }
}

// Cache the developer apps list so the dashboard's frequent polling does not
// hammer Apple's APIs (which respond with empty data when rate-limited).
const APPS_CACHE_TTL_MS = 10 * 60 * 1000;
let appsCache = { key: null, data: null, fetchedAt: 0 };

function invalidateAppsCache() {
    appsCache = { key: null, data: null, fetchedAt: 0 };
}

// Fetch all apps for the developer (public iTunes Search or private ASC API)
async function fetchDeveloperApps() {
    try {
        const apiMode = await db.getSetting('api_mode') || 'public';
        const devTerm = await db.getSetting('developer_name') || process.env.DEVELOPER_TERM;
        const storeCountries = await getStoreCountries();

        const cacheKey = JSON.stringify([apiMode, devTerm, storeCountries]);
        if (appsCache.key === cacheKey && appsCache.data && (Date.now() - appsCache.fetchedAt) < APPS_CACHE_TTL_MS) {
            return appsCache.data;
        }

        let apps;
        if (apiMode === 'private') {
            apps = await fetchDeveloperAppsPrivate();
        } else {
            apps = await fetchDeveloperAppsPublic(devTerm, storeCountries);
        }

        // Only cache successful (non-empty) results so transient failures retry quickly
        if (apps.length > 0) {
            appsCache = { key: cacheKey, data: apps, fetchedAt: Date.now() };
        }
        return apps;
    } catch (error) {
        console.error('Error fetching developer apps:', error);
        return [];
    }
}

async function fetchDeveloperAppsPublic(devTerm, storeCountries) {
    if (!devTerm || devTerm.trim() === '' || devTerm === 'Your Developer Name') {
        return [];
    }

    const encodedTerm = encodeURIComponent(devTerm.trim()).replace(/%20/g, '+');
    const appsMap = new Map();

    for (const storeCountry of storeCountries) {
        for (const entity of ['macSoftware', 'software']) {
            try {
                const url = `https://itunes.apple.com/search?term=${encodedTerm}&entity=${entity}&attribute=softwareDeveloper&country=${storeCountry}`;
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
        }
    }

    return Array.from(appsMap.values());
}

// Fetch reviews for a specific app from the public RSS feed.
// Note: the feed only contains WRITTEN reviews — star-only ratings never appear
// in it, and for massive apps Apple returns an empty feed in every format.
async function fetchAppReviews(appId, storeCountry) {
    try {
        const url = `https://itunes.apple.com/${storeCountry}/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`RSS feed request failed for app ${appId} [${storeCountry}]: ${response.status} ${response.statusText}`);
            return [];
        }
        const data = await response.json();

        // Apple's XML->JSON conversion returns a single OBJECT (not an array)
        // when there is exactly one written review — normalize so that lone
        // review isn't silently dropped by the .filter() below
        const rawEntries = data?.feed?.entry;
        const entries = Array.isArray(rawEntries) ? rawEntries : (rawEntries ? [rawEntries] : []);

        // Skip the app-info entry (iTunes sometimes returns the app itself as the first entry),
        // and guard each field so one malformed entry doesn't drop the whole batch.
        return entries
            .filter(entry => entry.author && entry.author.name && entry.id?.label)
            .map(entry => ({
                id: entry.id.label,
                author_name: entry.author.name.label,
                author_uri: entry.author.uri ? entry.author.uri.label : '',
                version: entry['im:version']?.label || 'N/A',
                rating: parseInt(entry['im:rating']?.label, 10) || 0,
                title: entry.title?.label || '',
                content: entry.content?.label || '',
                updated_at: entry.updated?.label || new Date().toISOString()
            }));
    } catch (error) {
        console.error(`Error fetching reviews for app ${appId}:`, error);
        return [];
    }
}

// --- Scrape orchestration ---------------------------------------------------
// A single scrape runs at a time (interval ticks that arrive while one is
// running are skipped). resetAndRescrape() mutes notifications for its whole
// duration so an interval tick can never blast the chat with "new" reviews
// right after the reviews table was wiped.
let currentScrape = null;
let notificationsMuted = false;

function scrapeReviews(isInitial = false) {
    if (currentScrape) {
        console.log('Scrape already in progress, skipping this cycle.');
        return currentScrape;
    }
    currentScrape = doScrape(isInitial)
        .catch(err => console.error('Scrape cycle failed:', err))
        .finally(() => { currentScrape = null; });
    return currentScrape;
}

// Called when settings that define the review set change (developer, countries,
// API mode or credentials): wipe stored reviews and re-seed without notifying.
async function resetAndRescrape() {
    notificationsMuted = true;
    try {
        while (currentScrape) {
            await currentScrape;
        }
        invalidateAppsCache();
        await dbRun('DELETE FROM reviews');
        currentScrape = doScrape(true)
            .catch(err => console.error('Initial rescrape failed:', err))
            .finally(() => { currentScrape = null; });
        await currentScrape;
    } finally {
        notificationsMuted = false;
    }
}

async function doScrape(isInitial) {
    console.log(`Starting review scrape cycle... (Initial: ${isInitial})`);

    const apiMode = await db.getSetting('api_mode') || 'public';
    if (apiMode === 'private') {
        return scrapeReviewsPrivate(isInitial);
    }

    const apps = await fetchDeveloperApps();
    const storeCountries = await getStoreCountries();
    console.log(`Found ${apps.length} apps for developer. Using store countries: ${storeCountries.join(', ')}`);

    for (const app of apps) {
        for (const storeCountry of storeCountries) {
            const reviews = await fetchAppReviews(app.id, storeCountry);
            console.log(`Fetched ${reviews.length} reviews for ${app.name} (${app.id}) in ${storeCountry}`);

            for (const review of reviews) {
                try {
                    const isNew = await saveReviewIfNew(review, app.id, storeCountry);
                    if (isNew) {
                        console.log(`New review found for ${app.name} [${storeCountry}]: ${review.title}`);
                        if (!isInitial && !notificationsMuted) {
                            await sendReviewNotification(review, app.name, app.iconUrl, storeCountry);
                        }
                    }
                } catch (saveErr) {
                    console.error('Error saving review:', saveErr);
                }
            }
        }
    }
}

module.exports = { scrapeReviews, resetAndRescrape, fetchDeveloperApps, fetchAppReviews, testAscCredentials };
