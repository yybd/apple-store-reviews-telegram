document.addEventListener('DOMContentLoaded', () => {
    fetchReviews();
    setupTestButton();
});

function setupTestButton() {
    const testBtn = document.getElementById('test-telegram-btn');
    if (!testBtn) return;
    
    testBtn.addEventListener('click', async () => {
        const originalText = testBtn.textContent;
        testBtn.textContent = 'Sending...';
        testBtn.disabled = true;
        testBtn.style.opacity = '0.7';
        
        try {
            const res = await fetch('/api/test-telegram', { method: 'POST' });
            if (res.ok) {
                testBtn.textContent = 'Sent! ✅';
            } else {
                testBtn.textContent = 'Failed ❌';
            }
        } catch (error) {
            testBtn.textContent = 'Error ❌';
        }
        
        setTimeout(() => {
            testBtn.textContent = originalText;
            testBtn.disabled = false;
            testBtn.style.opacity = '1';
        }, 3000);
    });
}

async function fetchReviews() {
    const loadingEl = document.getElementById('loading');
    const gridEl = document.getElementById('reviews-grid');
    const emptyStateEl = document.getElementById('empty-state');
    const totalReviewsEl = document.getElementById('total-reviews');

    try {
        const response = await fetch('/api/reviews');
        if (!response.ok) throw new Error('Failed to fetch reviews');
        
        const reviews = await response.json();
        
        loadingEl.classList.add('hidden');
        
        if (reviews.length === 0) {
            emptyStateEl.classList.remove('hidden');
            totalReviewsEl.textContent = '0';
            return;
        }

        totalReviewsEl.textContent = reviews.length.toLocaleString();
        
        gridEl.innerHTML = ''; // Clear previous content
        
        reviews.forEach((review, index) => {
            const card = createReviewCard(review);
            // Staggered animation
            card.style.animationDelay = `${index * 50}ms`;
            gridEl.appendChild(card);
        });
        
        gridEl.classList.remove('hidden');

    } catch (error) {
        console.error('Error fetching reviews:', error);
        loadingEl.innerHTML = `<p style="color: #ff5e5e;">Error loading reviews. Retrying soon...</p>`;
        // Optional: auto-retry
        setTimeout(fetchReviews, 10000);
    }
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
            <span class="review-author">${escapeHTML(review.author_name)}</span>
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
setInterval(fetchReviews, 60000);
