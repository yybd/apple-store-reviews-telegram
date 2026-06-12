// Setup Auth and fetch wrapper
let authHeader = localStorage.getItem('storeReviewsAuth') || null;

// Active data-fetching mode ('public' RSS or 'private' ASC API), kept in sync by fetchConfig()
let activeApiMode = 'public';

async function customFetch(url, options = {}) {
    const headers = options.headers || {};
    if (authHeader) {
        headers['Authorization'] = authHeader;
    }
    options.headers = headers;
    
    const res = await fetch(url, options);
    if (res.status === 401) {
        const modal = document.getElementById('login-modal');
        if (modal) modal.classList.remove('hidden');
        throw new Error('Authentication required');
    }
    return res;
}

document.addEventListener('DOMContentLoaded', () => {
    fetchConfig();
    fetchApps();
    connectEventStream();
    setupTestButton();
    setupLogoutButton();
    setupSettingsModal();
    setupReviewsModal();
    
    // Handle Login UI
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');
    if (loginBtn) {
        // Allow submitting the login form with Enter
        ['login-user', 'login-pass'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') loginBtn.click();
            });
        });

        loginBtn.addEventListener('click', async () => {
            const user = document.getElementById('login-user').value.trim();
            const pass = document.getElementById('login-pass').value.trim();
            if (!user || !pass) {
                loginError.textContent = 'Please enter both username and password';
                return;
            }
            
            loginBtn.textContent = 'Logging in...';
            const encoded = btoa(user + ':' + pass);
            const tempAuth = 'Basic ' + encoded;
            
            try {
                // Test auth by hitting config
                const res = await fetch('/api/config', {
                    headers: { 'Authorization': tempAuth }
                });
                if (res.status === 401) {
                    throw new Error('Invalid credentials');
                }
                
                // Success
                authHeader = tempAuth;
                localStorage.setItem('storeReviewsAuth', tempAuth);
                document.getElementById('login-modal').classList.add('hidden');
                loginError.textContent = '';
                
                // Reload data and re-open the event stream with the new credentials
                fetchConfig();
                fetchApps();
                connectEventStream();
            } catch (e) {
                loginError.textContent = 'Invalid username or password';
            } finally {
                loginBtn.textContent = 'Login';
            }
        });
    }
});

async function fetchConfig() {
    try {
        const response = await customFetch('/api/config', { cache: 'no-cache' });
        const config = await response.json();

        if (config.apiMode) activeApiMode = config.apiMode;

        const devNameEl = document.getElementById('developer-name-display');
        if (devNameEl && config.developerName) {
            devNameEl.textContent = `Tracking feedback for ${config.developerName}'s Apps`;
        }
        
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            statusEl.classList.remove('hidden');
            let statusHtml = '';
            
            if (config.connected) {
                statusHtml += `<span style="color: #4ade80;" title="App Store Connected">●</span> Store (${config.appsCount} apps)`;
            } else {
                statusHtml += `<span style="color: #ff5e5e;" title="App Store Disconnected">●</span> Store (Check DEVELOPER_TERM)`;
            }
            
            statusHtml += `<span style="margin: 0 6px; color: #cbd5e1;">|</span>`;
            
            const testBtn = document.getElementById('test-telegram-btn');
            if (config.telegramConnected) {
                statusHtml += `<span style="color: #4ade80;" title="Telegram Connected">●</span> Telegram`;
                if (testBtn) {
                    testBtn.disabled = false;
                    testBtn.style.opacity = '1';
                    testBtn.style.cursor = 'pointer';
                    testBtn.title = 'Send an instant summary to Telegram';
                }
            } else {
                statusHtml += `<span style="color: #ff5e5e;" title="Telegram Disconnected">●</span> Telegram`;
                if (testBtn) {
                    testBtn.disabled = true;
                    testBtn.style.opacity = '0.5';
                    testBtn.style.cursor = 'not-allowed';
                    testBtn.title = 'Telegram is not configured';
                }
            }

            // Logged-in indicator + logout button (only when protection is enabled)
            const logoutBtn = document.getElementById('logout-btn');
            let loggedInUser = null;
            if (config.authEnabled && authHeader) {
                try {
                    loggedInUser = atob(authHeader.split(' ')[1] || '').split(':')[0] || null;
                } catch (e) {
                    loggedInUser = null;
                }
            }
            if (loggedInUser) {
                statusHtml += `<span style="margin: 0 6px; color: #cbd5e1;">|</span>`;
                statusHtml += `<span style="color: #4ade80;" title="Logged in">●</span> 👤 ${escapeHTML(loggedInUser)}`;
                if (logoutBtn) {
                    logoutBtn.classList.remove('hidden');
                    logoutBtn.title = `Logged in as ${loggedInUser} — click to log out`;
                }
            } else if (logoutBtn) {
                logoutBtn.classList.add('hidden');
            }

            statusEl.innerHTML = statusHtml;
        }
    } catch (error) {
        console.error('Error fetching config:', error);
        // Auth challenges are handled by the login modal — not a server failure
        if (error.message === 'Authentication required') return;
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.innerHTML = `<span style="color: #ff5e5e;">●</span> Failed to connect to server.`;
        }
    }
}

function setupLogoutButton() {
    const btn = document.getElementById('logout-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        localStorage.removeItem('storeReviewsAuth');
        authHeader = null;
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        // Reload with no credentials: the server answers 401 and the login modal appears
        location.reload();
    });
}

function setupTestButton() {
    const testBtn = document.getElementById('test-telegram-btn');
    if (!testBtn) return;
    
        testBtn.addEventListener('click', async () => {
        const originalText = testBtn.textContent;
        testBtn.textContent = 'Sending...';
        testBtn.disabled = true;
        testBtn.style.opacity = '0.7';
        
        try {
            const res = await customFetch('/api/send-apps-summary', { method: 'POST' });
            if (res.ok) {
                testBtn.textContent = 'Sent!';
            } else {
                testBtn.textContent = 'Failed';
            }
        } catch (error) {
            testBtn.textContent = 'Error';
        }
        
        setTimeout(() => {
            testBtn.textContent = originalText;
            testBtn.disabled = false;
            testBtn.style.opacity = '1';
        }, 3000);
    });
}

async function fetchApps() {
    const loadingEl = document.getElementById('loading');
    const gridEl = document.getElementById('apps-grid');
    const emptyStateEl = document.getElementById('empty-state');
    const totalReviewsEl = document.getElementById('total-reviews');

    try {
        const response = await customFetch('/api/apps', { cache: 'no-cache' });
        if (!response.ok) throw new Error('Failed to fetch apps');
        
        const apps = await response.json();
        
        loadingEl.classList.add('hidden');
        
        if (apps.length === 0) {
            emptyStateEl.classList.remove('hidden');
            totalReviewsEl.textContent = '0';
            return;
        }

        const totalReviews = apps.reduce((sum, app) => {
            if (app.ratingsByCountry) {
                return sum + app.ratingsByCountry.reduce((cSum, r) => cSum + r.count, 0);
            }
            return sum + (app.ratingCount || 0);
        }, 0);
        totalReviewsEl.textContent = totalReviews.toLocaleString();
        
        gridEl.innerHTML = '';
        
        apps.sort((a, b) => {
            if (a.isPublished !== false && b.isPublished === false) return -1;
            if (a.isPublished === false && b.isPublished !== false) return 1;
            return 0;
        });
        
        apps.forEach((app, index) => {
            const card = document.createElement('div');
            card.className = 'app-card fade-in';
            if (app.isPublished === false) {
                card.style.filter = 'brightness(0.7) grayscale(0.8)';
                card.style.backgroundColor = 'var(--bg-color)';
            }
            card.style.animationDelay = `${index * 50}ms`;
            
            let statsHtml = '';
            if (app.ratingsByCountry && app.ratingsByCountry.length > 0) {
                app.ratingsByCountry.forEach(r => {
                    const stars = '★'.repeat(Math.round(r.rating)) + '☆'.repeat(5 - Math.round(r.rating));
                    const flag = getFlagEmoji(r.country);
                    statsHtml += `
                        <div class="app-stats" style="margin-bottom: 4px; font-size: 0.9rem;">
                            <div class="app-rating" style="display: flex; align-items: center; gap: 6px;">
                                <span>${flag} ${r.country.toUpperCase()}</span>
                                <span class="stars">${stars}</span>
                                <span>${r.rating.toFixed(1)}</span>
                            </div>
                            <span class="app-count" style="margin-left: auto;">(${r.count.toLocaleString()})</span>
                        </div>
                    `;
                });
            } else {
                statsHtml = '<div style="color: var(--text-secondary); font-size: 0.9rem;">No ratings yet</div>';
            }
            
            const platformsHtml = app.platforms && app.platforms.length > 0 
                ? `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">Platforms: ${app.platforms.join(', ')}</div>` 
                : '';
                
            const unpublishedTag = app.isPublished === false
                ? `<span style="font-size: 0.7rem; background-color: var(--card-border); color: var(--text-secondary); padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle;">Not in Store</span>`
                : '';
            
            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px;">
                    ${app.iconUrl ? `<img src="${escapeHTML(app.iconUrl)}" alt="${escapeHTML(app.name)} icon" style="width: 56px; height: 56px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">` : ''}
                    <div>
                        <h3 style="margin: 0;">${escapeHTML(app.name)}${unpublishedTag}</h3>
                        ${platformsHtml}
                    </div>
                </div>
                <div style="margin-bottom: 12px; border-top: 1px solid var(--card-border); padding-top: 8px;">
                    ${statsHtml}
                </div>
                <button class="view-reviews-btn" data-id="${escapeHTML(app.id)}" data-name="${escapeHTML(app.name)}">View Reviews</button>
            `;
            
            gridEl.appendChild(card);
        });
        
        document.querySelectorAll('.view-reviews-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                openReviewsModal(e.target.dataset.id, e.target.dataset.name);
            });
        });
        
        gridEl.classList.remove('hidden');

    } catch (error) {
        console.error('Error fetching apps:', error);
        // When auth is required the login modal is already shown; the post-login
        // flow re-fetches, so don't spam the server with retries
        if (error.message === 'Authentication required') return;
        loadingEl.innerHTML = `<p style="color: #ff5e5e;">Error loading apps. Retrying soon...</p>`;
        setTimeout(fetchApps, 10000);
    }
}

async function openReviewsModal(appId, appName) {
    const modal = document.getElementById('reviews-modal');
    const titleEl = document.getElementById('reviews-modal-title');
    const loadingEl = document.getElementById('reviews-modal-loading');
    const emptyEl = document.getElementById('reviews-modal-empty');
    const listEl = document.getElementById('reviews-modal-list');
    
    titleEl.textContent = `Reviews for ${appName}`;
    listEl.innerHTML = '';
    emptyEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');
    modal.classList.remove('hidden');
    
    try {
        const response = await customFetch(`/api/reviews?appId=${appId}`, { cache: 'no-cache' });
        if (!response.ok) throw new Error('Failed to fetch reviews');
        
        const reviews = await response.json();
        loadingEl.classList.add('hidden');
        
        if (reviews.length === 0) {
            // The RSS-limits note is only relevant in Public mode; in Private mode
            // the data already comes from App Store Connect, so don't suggest it
            const publicModeNote = activeApiMode === 'public'
                ? `
                        <br><br>
                        <span style="font-size: 0.85rem; opacity: 0.8;">
                            <i>Note: Apple's Public RSS feeds only include <b>written</b> reviews (star-only ratings never appear), and for massive apps (like TikTok, WhatsApp) they often return empty data due to API limits. If this is your app, configure the <b>Private API</b> in Settings to bypass this limitation.</i>
                        </span>`
                : `
                        <br><br>
                        <span style="font-size: 0.85rem; opacity: 0.8;">
                            <i>Note: Only <b>written</b> reviews are collected (star-only ratings have no text). New reviews will appear after the next scheduled check.</i>
                        </span>`;

            emptyEl.innerHTML = `
                <div style="text-align: center;">
                    <h3 style="margin-bottom: 8px;">No reviews found</h3>
                    <p style="color: var(--text-secondary); max-width: 400px; margin: 0 auto;">
                        There are no saved reviews for this app yet.${publicModeNote}
                    </p>
                </div>
            `;
            emptyEl.classList.remove('hidden');
            return;
        }
        
        reviews.forEach((review, index) => {
            const card = createReviewCard(review);
            card.style.animationDelay = `${Math.min(index * 50, 500)}ms`;
            listEl.appendChild(card);
        });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        loadingEl.classList.add('hidden');
        emptyEl.innerHTML = `<h3 style="color: #ff5e5e;">Error loading reviews</h3>`;
        emptyEl.classList.remove('hidden');
    }
}

function setupReviewsModal() {
    const modal = document.getElementById('reviews-modal');
    const closeBtn = document.getElementById('close-reviews-btn');
    
    if (!modal || !closeBtn) return;
    
    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
}

function getFlagEmoji(countryCode) {
    if (!countryCode) return '';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

function createReviewCard(review) {
    const card = document.createElement('div');
    card.className = 'review-card fade-in';
    
    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
    const date = new Date(review.updated_at).toLocaleDateString(undefined, { 
        year: 'numeric', month: 'short', day: 'numeric' 
    });

    card.innerHTML = `
        <div class="review-header">
            <div class="stars">${stars}</div>
            <div class="review-date">${date}</div>
        </div>
        <h3 class="review-title">${escapeHTML(review.title)}</h3>
        <div class="review-content">${escapeHTML(review.content)}</div>
        <div class="review-footer">
            <span class="review-author">${escapeHTML(review.author_name)} ${getFlagEmoji(review.country) || ''}</span>
            <span class="review-version">v${escapeHTML(review.version)}</span>
        </div>
    `;

    return card;
}

// Basic HTML escaping to prevent XSS — escapes quotes too, so it is safe
// inside attribute values (src, alt, data-*), not just element content
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- Live updates -----------------------------------------------------------
// Instead of polling, listen to the server's event stream (SSE): the server
// pushes a 'refresh' only when the scraper actually saved new reviews.
let eventSource = null;
let lastEventAt = 0;

function connectEventStream() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    // EventSource can't send headers, so the auth goes in the query string
    const authParam = authHeader ? ('?auth=' + encodeURIComponent(authHeader)) : '';
    eventSource = new EventSource('/api/events' + authParam);
    lastEventAt = Date.now();

    let firstOpen = true;
    eventSource.onopen = () => {
        lastEventAt = Date.now();
        if (!firstOpen) {
            // Reconnected after a drop — catch up on anything missed meanwhile
            fetchConfig();
            fetchApps();
        }
        firstOpen = false;
    };

    eventSource.onmessage = (e) => {
        lastEventAt = Date.now();
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'refresh') {
                fetchConfig();
                fetchApps();
            }
        } catch (err) {
            // Ignore malformed frames (e.g. heartbeats are handled by the timestamp above)
        }
    };
}

// Watchdog: the server heartbeats every 25s; if the stream goes silent for 90s
// (e.g. a proxy dropped it without closing), reconnect and refresh once
setInterval(() => {
    if (eventSource && Date.now() - lastEventAt > 90000) {
        connectEventStream();
        fetchConfig();
        fetchApps();
    }
}, 30000);

function setupSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');
    const tokenInput = document.getElementById('telegram-token');
    const chatIdInput = document.getElementById('telegram-chat-id');
    const developerNameInput = document.getElementById('developer-name');
    const statusEl = document.getElementById('settings-save-status');

    const addStoreBtn = document.getElementById('add-store-btn');
    const container = document.getElementById('store-countries-container');

    const countryOptions = `
        <option value="us">United States (US)</option>
        <option value="il">Israel (IL)</option>
        <option value="gb">United Kingdom (GB)</option>
        <option value="ca">Canada (CA)</option>
        <option value="au">Australia (AU)</option>
        <option value="de">Germany (DE)</option>
        <option value="fr">France (FR)</option>
        <option value="jp">Japan (JP)</option>
        <option value="cn">China (CN)</option>
        <option value="it">Italy (IT)</option>
        <option value="es">Spain (ES)</option>
        <option value="br">Brazil (BR)</option>
        <option value="ru">Russia (RU)</option>
        <option value="kr">South Korea (KR)</option>
        <option value="nl">Netherlands (NL)</option>
        <option value="se">Sweden (SE)</option>
        <option value="ch">Switzerland (CH)</option>
        <option value="mx">Mexico (MX)</option>
        <option value="in">India (IN)</option>
        <option value="za">South Africa (ZA)</option>
        <option value="tr">Turkey (TR)</option>
        <option value="ae">United Arab Emirates (AE)</option>
    `;

    function addStoreSelect(value = 'us') {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.gap = '8px';
        wrapper.style.alignItems = 'center';
        
        const select = document.createElement('select');
        select.className = 'store-country-select';
        select.style.flex = '1';
        select.style.padding = '12px';
        select.style.border = '1px solid var(--card-border)';
        select.style.borderRadius = '8px';
        select.style.fontSize = '1rem';
        select.style.backgroundColor = 'var(--surface-color)';
        select.style.color = 'var(--text-primary)';
        select.innerHTML = countryOptions;
        select.value = value;
        
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.innerHTML = '&times;';
        removeBtn.style.background = 'none';
        removeBtn.style.border = 'none';
        removeBtn.style.color = 'var(--text-secondary)';
        removeBtn.style.fontSize = '1.5rem';
        removeBtn.style.cursor = 'pointer';
        removeBtn.onclick = () => {
            if (container.children.length > 1) {
                wrapper.remove();
            }
        };
        
        wrapper.appendChild(select);
        wrapper.appendChild(removeBtn);
        container.appendChild(wrapper);
    }

    if (addStoreBtn) {
        addStoreBtn.addEventListener('click', () => addStoreSelect());
    }

    if (!modal || !settingsBtn) return;

    let currentApiMode = 'public';

    // Register tab listeners once (not on every modal open, which stacked duplicates)
    const tabs = ['public', 'private', 'telegram', 'security'];
    tabs.forEach(tab => {
        const btn = document.getElementById(`tab-${tab}`);
        if (!btn) return;
        btn.addEventListener('click', () => {
            tabs.forEach(t => {
                const tBtn = document.getElementById(`tab-${t}`);
                const tContent = document.getElementById(`content-${t}`);
                if(tBtn) {
                    tBtn.classList.remove('active');
                    tBtn.style.color = 'var(--text-secondary)';
                    tBtn.style.borderBottom = 'none';
                }
                if(tContent) tContent.style.display = 'none';
            });

            btn.classList.add('active');
            btn.style.color = 'var(--primary-color)';
            btn.style.borderBottom = '2px solid var(--primary-color)';
            document.getElementById(`content-${tab}`).style.display = 'block';
            if (tab === 'public' || tab === 'private') {
                currentApiMode = tab;
            }
        });
    });

    settingsBtn.addEventListener('click', async () => {
        if (statusEl) {
            statusEl.textContent = 'Loading...';
            statusEl.style.color = 'var(--text-secondary)';
        }
        modal.classList.remove('hidden');

        try {
            const res = await customFetch('/api/settings', { cache: 'no-cache' });
            const data = await res.json();
            if (tokenInput) tokenInput.value = data.telegramToken || '';
            if (chatIdInput) chatIdInput.value = data.telegramChatId || '';
            if (developerNameInput) developerNameInput.value = data.developerName || '';
            
            const ascIssuerIdInput = document.getElementById('asc-issuer-id');
            const ascKeyIdInput = document.getElementById('asc-key-id');
            const ascPrivateKeyInput = document.getElementById('asc-private-key');
            
            if (ascIssuerIdInput) ascIssuerIdInput.value = data.ascIssuerId || '';
            if (ascKeyIdInput) ascKeyIdInput.value = data.ascKeyId || '';
            if (ascPrivateKeyInput) ascPrivateKeyInput.value = data.ascPrivateKey || '';
            
            const dashboardUserInput = document.getElementById('dashboard-user');
            const dashboardPassInput = document.getElementById('dashboard-pass');
            if (dashboardUserInput) dashboardUserInput.value = data.dashboardUser || '';
            if (dashboardPassInput) dashboardPassInput.value = data.dashboardPass || '';

            const pollIntervalSelect = document.getElementById('poll-interval');
            if (pollIntervalSelect) {
                const minutes = String(data.pollIntervalMinutes || 60);
                // If the saved value isn't one of the presets (e.g. set via env), add it
                if (!Array.from(pollIntervalSelect.options).some(o => o.value === minutes)) {
                    const opt = document.createElement('option');
                    opt.value = minutes;
                    opt.textContent = `Every ${minutes} minutes`;
                    pollIntervalSelect.appendChild(opt);
                }
                pollIntervalSelect.value = minutes;
            }
            
            if (data.apiMode === 'private') {
                const tabPrivate = document.getElementById('tab-private');
                if (tabPrivate) tabPrivate.click();
            } else {
                const tabPublic = document.getElementById('tab-public');
                if (tabPublic) tabPublic.click();
            }
            
            if (container) {
                container.innerHTML = '';
                if (data.storeCountries && data.storeCountries.length > 0) {
                    data.storeCountries.forEach(c => addStoreSelect(c));
                } else {
                    addStoreSelect('us');
                }
            }
            if (statusEl) statusEl.textContent = '';
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = 'Error loading settings';
                statusEl.style.color = '#ff5e5e';
            }
            if (container && container.children.length === 0) addStoreSelect('us');
        }
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        if (statusEl) statusEl.textContent = '';
        
        const countrySelects = Array.from(document.querySelectorAll('.store-country-select')).map(s => s.value);
        const storeCountries = [...new Set(countrySelects)];
        
        if (currentApiMode === 'public' && storeCountries.length !== countrySelects.length) {
            if (statusEl) {
                statusEl.textContent = 'Please do not select the same App Store region more than once.';
                statusEl.style.color = '#ff5e5e';
            }
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            return;
        }

        try {
            const ascIssuerIdInput = document.getElementById('asc-issuer-id');
            const ascKeyIdInput = document.getElementById('asc-key-id');
            const ascPrivateKeyInput = document.getElementById('asc-private-key');
            const dashboardUserInput = document.getElementById('dashboard-user');
            const dashboardPassInput = document.getElementById('dashboard-pass');
            const pollIntervalSelect = document.getElementById('poll-interval');

            const payload = {
                telegramToken: tokenInput ? tokenInput.value.trim() : '',
                telegramChatId: chatIdInput ? chatIdInput.value.trim() : '',
                developerName: developerNameInput ? developerNameInput.value.trim() : '',
                storeCountries: storeCountries,
                apiMode: currentApiMode,
                ascIssuerId: ascIssuerIdInput ? ascIssuerIdInput.value.trim() : '',
                ascKeyId: ascKeyIdInput ? ascKeyIdInput.value.trim() : '',
                ascPrivateKey: ascPrivateKeyInput ? ascPrivateKeyInput.value.trim() : '',
                dashboardUser: dashboardUserInput ? dashboardUserInput.value.trim() : '',
                dashboardPass: dashboardPassInput ? dashboardPassInput.value.trim() : '',
                pollIntervalMinutes: pollIntervalSelect ? parseInt(pollIntervalSelect.value, 10) : undefined
            };
            
            const res = await customFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            if (data.success) {
                if (statusEl) {
                    statusEl.textContent = 'Saved successfully! ✅';
                    statusEl.style.color = '#4ade80';
                }
                fetchConfig();
                // Trigger fetchApps to update grid if developer name changed
                fetchApps();
                
                setTimeout(() => {
                    modal.classList.add('hidden');
                    if (statusEl) statusEl.textContent = '';
                }, 1500);
            } else {
                throw new Error(data.error || 'Failed to save');
            }
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = e.message;
                statusEl.style.color = '#ff5e5e';
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    });
}
