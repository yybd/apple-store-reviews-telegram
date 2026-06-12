document.addEventListener('DOMContentLoaded', () => {
    fetchConfig();
    fetchApps();
    setupTestButton();
    setupSettingsModal();
    setupReviewsModal();
});

async function fetchConfig() {
    try {
        const response = await fetch('/api/config', { cache: 'no-cache' });
        const config = await response.json();
        
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
            
            statusEl.innerHTML = statusHtml;
        }
    } catch (error) {
        console.error('Error fetching config:', error);
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.innerHTML = `<span style="color: #ff5e5e;">●</span> Failed to connect to server.`;
        }
    }
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
            const res = await fetch('/api/send-apps-summary', { method: 'POST' });
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
        const response = await fetch('/api/apps', { cache: 'no-cache' });
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
                    ${app.iconUrl ? `<img src="${app.iconUrl}" alt="${escapeHTML(app.name)} icon" style="width: 56px; height: 56px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">` : ''}
                    <div>
                        <h3 style="margin: 0;">${escapeHTML(app.name)}${unpublishedTag}</h3>
                        ${platformsHtml}
                    </div>
                </div>
                <div style="margin-bottom: 12px; border-top: 1px solid var(--card-border); padding-top: 8px;">
                    ${statsHtml}
                </div>
                <button class="view-reviews-btn" data-id="${app.id}" data-name="${escapeHTML(app.name)}">View Reviews</button>
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
        const response = await fetch(`/api/reviews?appId=${appId}`, { cache: 'no-cache' });
        if (!response.ok) throw new Error('Failed to fetch reviews');
        
        const reviews = await response.json();
        loadingEl.classList.add('hidden');
        
        if (reviews.length === 0) {
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

// Basic HTML escaping to prevent XSS
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Poll for updates every 60 seconds
setInterval(fetchApps, 60000);

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

    settingsBtn.addEventListener('click', async () => {
        if (statusEl) {
            statusEl.textContent = 'Loading...';
            statusEl.style.color = 'var(--text-secondary)';
        }
        modal.classList.remove('hidden');
        
        const tabPublic = document.getElementById('tab-public');
        const tabPrivate = document.getElementById('tab-private');
        const contentPublic = document.getElementById('content-public');
        const contentPrivate = document.getElementById('content-private');
        
        const tabTelegram = document.getElementById('tab-telegram');
        const contentTelegram = document.getElementById('content-telegram');

        if (tabPublic && tabPrivate && tabTelegram) {
            const tabs = [
                { btn: tabPublic, content: contentPublic, mode: 'public' },
                { btn: tabPrivate, content: contentPrivate, mode: 'private' },
                { btn: tabTelegram, content: contentTelegram, mode: null }
            ];

            tabs.forEach(tab => {
                tab.btn.addEventListener('click', () => {
                    tabs.forEach(t => {
                        t.btn.classList.remove('active');
                        t.btn.style.color = 'var(--text-secondary)';
                        t.btn.style.borderBottom = 'none';
                        t.content.style.display = 'none';
                    });
                    tab.btn.classList.add('active');
                    tab.btn.style.color = 'var(--primary-color)';
                    tab.btn.style.borderBottom = '2px solid var(--primary-color)';
                    tab.content.style.display = 'block';
                    if (tab.mode !== null) currentApiMode = tab.mode;
                });
            });
        }
        
        try {
            const res = await fetch('/api/settings', { cache: 'no-cache' });
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
            
            if (data.apiMode === 'private') {
                if (tabPrivate) tabPrivate.click();
            } else {
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
            
            const payload = {
                telegramToken: tokenInput ? tokenInput.value.trim() : '',
                telegramChatId: chatIdInput ? chatIdInput.value.trim() : '',
                developerName: developerNameInput ? developerNameInput.value.trim() : '',
                storeCountries: storeCountries,
                apiMode: currentApiMode,
                ascIssuerId: ascIssuerIdInput ? ascIssuerIdInput.value.trim() : '',
                ascKeyId: ascKeyIdInput ? ascKeyIdInput.value.trim() : '',
                ascPrivateKey: ascPrivateKeyInput ? ascPrivateKeyInput.value.trim() : ''
            };
            
            const res = await fetch('/api/settings', {
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
