// ReviewRank Content Script — Amazon Search Results Analyzer
// Runs on Amazon pages. Reads the live DOM of the current search results page.

(function() {
  'use strict';

  // Listen for messages from the popup (guarded for non-browser test environments)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
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
  }

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

  // Detect whether an Amazon search-result card is a sponsored/ads listing.
  // Uses multiple independent signals because Amazon changes its DOM over time:
  //  1. data-component-type="sp-sponsored-result" (widget-level marker)
  //  2. Known sponsored-label CSS classes (modern + legacy)
  //  3. A leaf element whose trimmed text is exactly "Sponsored" (case-insensitive)
  //  4. aria-label/title attributes that begin with "Sponsored"
  // Never relies on product title or review count to determine sponsorship.
  function detectSponsored(item) {
    // Strategy 1: widget-level data-component-type marker on the card or a descendant
    if (item.getAttribute && item.getAttribute('data-component-type') === 'sp-sponsored-result') {
      return true;
    }
    if (item.querySelectorAll('[data-component-type="sp-sponsored-result"]').length > 0) {
      return true;
    }

    // Strategy 2: known sponsored-label CSS classes (modern puis-* and legacy s-*)
    const labelClasses = [
      '.puis-sponsored-label-text',
      '.s-sponsored-label-text',
      '.puis-sponsored-label-txt',
      '.s-sponsored-label-info-icon',
      '.puis-sponsored-label-info-icon',
      '.a-size-base.s-sponsored-label-text',
      '.a-size-mini.s-sponsored-label-text'
    ];
    if (item.querySelectorAll(labelClasses.join(',')).length > 0) {
      return true;
    }

    // Strategy 3: any leaf element whose trimmed text is exactly "Sponsored"
    // (Amazons places a small standalone "Sponsored" label in the card)
    const candidates = item.querySelectorAll('span, div, a, i, b');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.children && el.children.length > 0) continue; // leaf text nodes only
      const text = (el.textContent || '').trim();
      if (/^sponsored$/i.test(text)) {
        return true;
      }
    }

    // Strategy 4: aria-label / title attributes that begin with "Sponsored"
    // (e.g. the info icon's aria-label/title "Sponsored product information")
    const attrEls = item.querySelectorAll('[aria-label], [title]');
    for (let i = 0; i < attrEls.length; i++) {
      const el = attrEls[i];
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      if (/^sponsored/i.test(ariaLabel)) return true;
      const title = (el.getAttribute('title') || '').trim();
      if (/^sponsored/i.test(title)) return true;
    }

    return false;
  }

  function parseAmazonProduct(item) {
    // 1. Product title
    const titleEl = item.querySelector('h2 a span') ||
                    item.querySelector('h2 span') ||
                    item.querySelector('h2');
    const title = titleEl ? titleEl.textContent.trim() : null;
    if (!title) return null;

    // Sponsored detection (independent of title/review data)
    const isSponsored = detectSponsored(item);

    // 2. Product URL + ASIN
    const linkEl = item.querySelector('h2 a') || item.querySelector('a.a-link-normal.s-no-outline');
    let productUrl = linkEl ? linkEl.getAttribute('href') : null;
    let canonicalUrl = normalizeAmazonUrl(productUrl);

    // ASIN from data attribute is most reliable (set on the search-result root)
    let asin = item.getAttribute('data-asin') || null;
    if (!asin && canonicalUrl) {
      asin = extractAsinFromUrl(canonicalUrl);
    }

    // Keep the absolute URL for click-through (user opens the real listing)
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
      asin: asin,
      canonicalUrl: canonicalUrl,
      isSponsored: isSponsored,
      marketplace: 'Amazon'
    };
  }

  function normalizeAmazonUrl(url) {
    if (!url) return null;

    // Make absolute
    let fullUrl = url;
    if (!fullUrl.startsWith('http')) {
      fullUrl = 'https://www.amazon.in' + fullUrl;
    }

    try {
      const parsed = new URL(fullUrl);
      const path = parsed.pathname;

      // Drop Amazon tracking segment from path (e.g. /ref=sr_1_1?ie=UTF8...)
      const pathWithoutRef = path.split('/ref=')[0];

      // If the path contains a product ID segment, build the canonical form
      const dpMatch = pathWithoutRef.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
      if (dpMatch) {
        return 'https://www.amazon.in/dp/' + dpMatch[1].toUpperCase();
      }

      // Fallback: path only, no query string, no trailing slash
      return pathWithoutRef.replace(/\/+$/, '');
    } catch (e) {
      // If URL parsing fails, strip query + trailing slash as a best effort
      return fullUrl.split('?')[0].replace(/\/+$/, '');
    }
  }

  function extractAsinFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
    return match ? match[1].toUpperCase() : null;
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

  // Expose internals for unit testing (no-op inside the browser extension)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      detectSponsored: detectSponsored
    };
  }
})();
