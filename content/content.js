// ReviewRank Content Script — Amazon Search Results Analyzer
// Runs on Amazon pages. Reads the live DOM of the current search results page.

(function() {
  'use strict';

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scrapeAmazon') {
      try {
        const products = extractAmazonProducts();
        sendResponse({ success: true, products });
      } catch (err) {
        console.error('ReviewRank scrape error:', err);
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }
  });

  function extractAmazonProducts() {
    const products = [];
    const items = document.querySelectorAll('[data-component-type="s-search-result"]');

    items.forEach((item) => {
      try {
        const product = parseAmazonProduct(item);
        if (product) {
          products.push(product);
        }
      } catch (e) {
        // Skip items that fail to parse
      }
    });

    return products;
  }

  function parseAmazonProduct(item) {
    // 1. Product title
    const titleEl = item.querySelector('h2 a span') ||
                    item.querySelector('h2 span') ||
                    item.querySelector('h2');
    const title = titleEl ? titleEl.textContent.trim() : null;
    if (!title) return null;

    // 2. Product URL
    const linkEl = item.querySelector('h2 a') || item.querySelector('a.a-link-normal.s-no-outline');
    let productUrl = linkEl ? linkEl.getAttribute('href') : null;
    if (productUrl && !productUrl.startsWith('http')) {
      productUrl = 'https://www.amazon.in' + productUrl;
    }

    // 3. Price
    let price = null;
    const priceEl = item.querySelector('.a-price .a-offscreen');
    if (priceEl) {
      const priceText = priceEl.textContent.replace(/[₹,\s]/g, '').trim();
      const parsed = parseFloat(priceText);
      if (!isNaN(parsed)) price = parsed;
    }

    // 4. Star rating
    let rating = null;
    const ratingEl = item.querySelector('.a-icon-star-small .a-icon-alt') ||
                     item.querySelector('.a-icon-star .a-icon-alt') ||
                     item.querySelector('[aria-label*="out of 5"]');
    if (ratingEl) {
      const ratingText = ratingEl.textContent || ratingEl.getAttribute('aria-label') || '';
      const match = ratingText.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (!isNaN(val) && val <= 5) rating = val;
      }
    }

    // 5. Review count — try multiple strategies
    let reviewCount = extractReviewCount(item);

    // 6. Product image
    let imageUrl = null;
    const imgEl = item.querySelector('img.s-image');
    if (imgEl) {
      imageUrl = imgEl.src || imgEl.getAttribute('data-src') || null;
    }

    return {
      title,
      price,
      rating: rating || 0,
      reviewCount,
      imageUrl,
      url: productUrl,
      marketplace: 'Amazon'
    };
  }

  function extractReviewCount(item) {
    // Strategy 1: Look for elements with aria-label containing rating count
    const ariaElements = item.querySelectorAll('[aria-label*="rating"]');
    for (const el of ariaElements) {
      const label = el.getAttribute('aria-label') || '';
      const match = label.match(/([\d,]+)\s*(?:global\s*)?ratings?/i);
      if (match) {
        const count = parseInt(match[1].replace(/,/g, ''));
        if (!isNaN(count) && count > 0) return count;
      }
    }

    // Strategy 2: Look for specific class patterns
    const reviewSelectors = [
      'span.a-size-base.s-underline-text',
      'a[href*="customerReviews"] span',
      'span[aria-label*="ratings"]',
      '.a-size-base.a-color-secondary',
      'span.a-size-base:not(.a-color-secondary)',
      'a span.a-size-base'
    ];

    for (const selector of reviewSelectors) {
      const els = item.querySelectorAll(selector);
      for (const el of els) {
        const text = el.textContent.trim();
        // Match patterns like "1,234" or "1,234 ratings"
        const match = text.match(/([\d,]+)/);
        if (match) {
          const count = parseInt(match[1].replace(/,/g, ''));
          if (!isNaN(count) && count > 0 && count < 10000000) {
            return count;
          }
        }
      }
    }

    // Strategy 3: Look for any element with text matching a large number near the rating
    const allSpans = item.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent.trim();
      // Look for standalone numbers that look like review counts (4+ digits)
      if (/^[\d,]+$/.test(text)) {
        const count = parseInt(text.replace(/,/g, ''));
        if (!isNaN(count) && count >= 100 && count < 10000000) {
          return count;
        }
      }
    }

    // Strategy 4: Check for "X ratings" or "X global ratings" text patterns
    const allElements = item.querySelectorAll('span, a, div');
    for (const el of allElements) {
      const text = el.textContent.trim();
      const match = text.match(/([\d,]+)\s*(?:global\s*)?ratings?/i);
      if (match) {
        const count = parseInt(match[1].replace(/,/g, ''));
        if (!isNaN(count) && count > 0) return count;
      }
    }

    return 0; // Review count unavailable — do not invent
  }
})();
