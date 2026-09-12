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
    // Each field is extracted by a dedicated, multi-fallback function.
    const title = extractTitle(item);
    if (!title) return null;

    // Sponsored detection (independent of title/review data)
    const isSponsored = detectSponsored(item);

    // Product URL — the actual product detail link, not nav/tracking links
    const productUrl = extractProductUrl(item);
    const canonicalUrl = normalizeAmazonUrl(productUrl);

    // ASIN: prefer data-asin, fall back to URL-derived ASIN
    const asin = extractAsin(item, canonicalUrl);

    return {
      title,
      price: extractPrice(item),
      rating: extractRating(item) || 0,
      reviewCount: extractReviewCount(item),
      imageUrl: extractImageUrl(item),
      url: productUrl || canonicalUrl,
      asin: asin,
      canonicalUrl: canonicalUrl,
      isSponsored: isSponsored,
      marketplace: 'Amazon'
    };
  }

  // ------------------------------------------------------------------
  // Dedicated field extractors — each uses multiple fallback strategies.
  // No field relies on product title or review count for another field.
  // ------------------------------------------------------------------

  function extractTitle(item) {
    const selectors = [
      'h2 a span',
      'h2 span',
      'h2',
      'span.a-size-base-plus.a-color-base.a-text-normal',
      '.s-title-instructions-style span',
      'span[role="heading"]'
    ];
    for (const sel of selectors) {
      const els = item.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        // Ignore empty / placeholder titles (never used for sponsored detection)
        if (text.length >= 3 && !/^sponsored$/i.test(text)) {
          return text;
        }
      }
    }
    return null;
  }

  function extractAsin(item, canonicalUrl) {
    // Prefer data-asin (Amazon sets it on the search-result root element)
    let asin = null;
    if (item.getAttribute) {
      const raw = item.getAttribute('data-asin');
      if (raw) asin = raw.trim();
    }
    // Fallback: ASIN parsed from the canonical product URL
    if (!asin && canonicalUrl) {
      asin = extractAsinFromUrl(canonicalUrl);
    }
    // Always normalize to uppercase and validate the 10-char shape
    if (asin) {
      const normalized = asin.toUpperCase();
      if (/^[A-Z0-9]{10}$/.test(normalized)) {
        return normalized;
      }
    }
    return null;
  }

  function extractProductUrl(item) {
    const selectorGroups = [
      'h2 a',
      'a.a-link-normal.s-no-outline',
      'a[href*="/dp/"]',
      'a[href*="/gp/product"]'
    ];
    for (const sel of selectorGroups) {
      const links = item.querySelectorAll(sel);
      for (const link of links) {
        const href = (link.getAttribute('href') || '').trim();
        if (!href || href === '#' || href.charAt(0) === '#') continue;
        // Reject non-product navigation links (reviews, wishlist, JS, etc.)
        if (/customerReviews|product-reviews|wishlist|boughtTogether|javascript:/i.test(href)) continue;
        // Prefer links that point to an actual product detail page
        if (/\/dp\/|\/(?:gp\/)?product\//i.test(href)) {
          return href.indexOf('http') === 0 ? href : 'https://www.amazon.in' + href;
        }
      }
    }
    return null;
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

  function extractImageUrl(item) {
    const selectors = [
      'img.s-image',
      'img.a-dynamic-image',
      'img[data-image-latency*="product"]'
    ];
    for (const sel of selectors) {
      const imgs = item.querySelectorAll(sel);
      for (const img of imgs) {
        let src = img.getAttribute('src');
        if (!src) src = img.getAttribute('data-src');
        if (!src) src = srcsetToUrl(img.getAttribute('srcset'));
        if (!src) continue;
        // Skip blank/data placeholders and sprite/logo assets
        if (/^data:/i.test(src)) continue;
        if (/sprites|g-ecx|gno/i.test(src)) continue;
        // Skip very small icons when explicit dimensions are present
        const w = parseInt(img.getAttribute('width'), 10);
        const h = parseInt(img.getAttribute('height'), 10);
        if ((!isNaN(w) && w > 0 && w < 20) || (!isNaN(h) && h > 0 && h < 20)) continue;
        return src;
      }
    }
    return null;
  }

  function srcsetToUrl(srcset) {
    if (!srcset) return null;
    let best = null;
    let bestSize = -1;
    const parts = srcset.split(',');
    for (let i = 0; i < parts.length; i++) {
      const tokens = parts[i].trim().split(/\s+/);
      if (!tokens[0]) continue;
      const url = tokens[0];
      let size = 0;
      if (tokens.length >= 2) {
        size = parseInt(tokens[1], 10) || 0;
      }
      if (size > bestSize) {
        bestSize = size;
        best = url;
      } else if (best === null) {
        best = url;
      }
    }
    return best;
  }

  function extractPrice(item) {
    // Iterate over .a-price containers so struck-through / old prices can be skipped
    const anchors = item.querySelectorAll('.a-price');
    for (const anchor of anchors) {
      const strike = anchor.getAttribute('data-a-strike');
      const cls = anchor.getAttribute('class') || '';
      if (strike === 'true' || cls.indexOf('a-text-price') !== -1) {
        continue; // old / struck-through price, not the current selling price
      }
      const offScreens = anchor.querySelectorAll('.a-offscreen');
      for (const el of offScreens) {
        const price = parseIndianNumber(el.textContent);
        if (price !== null && price > 0) return price;
      }
      const wholes = anchor.querySelectorAll('.a-price-whole');
      for (const el of wholes) {
        const price = parseIndianNumber(el.textContent);
        if (price !== null && price > 0) return price;
      }
    }

    // Fallback: a bare .a-price-whole without an .a-price wrapper
    const bareWholes = item.querySelectorAll('.a-price-whole');
    for (const el of bareWholes) {
      const price = parseIndianNumber(el.textContent);
      if (price !== null && price > 0) return price;
    }

    return null;
  }

  function extractRating(item) {
    const selectors = [
      '.a-icon-star-small .a-icon-alt',
      '.a-icon-star .a-icon-alt',
      '.a-icon-star-medium .a-icon-alt',
      '[aria-label*="out of 5"]'
    ];
    for (const sel of selectors) {
      const els = item.querySelectorAll(sel);
      for (const el of els) {
        const text = el.textContent || el.getAttribute('aria-label') || '';
        const match = text.match(/(\d+(?:\.\d+)?)\s*out of 5/i);
        const num = match ? parseFloat(match[1]) : parseFloat(text);
        // Valid star ratings are 0–5; never confuse with review count
        if (!isNaN(num) && num >= 0 && num <= 5) {
          return num;
        }
      }
    }
    return null;
  }

  function extractReviewCount(item) {
    // ---------------------------------------------------------------
    // Strategy 1: aria-label carrying the count, e.g.
    //   "4.5 out of 5 stars, 92,431 ratings"
    //   "4.1 out of 5 stars, 1.2K ratings"
    // ---------------------------------------------------------------
    const ariaEls = item.querySelectorAll('[aria-label*="ratings"], [aria-label*="reviews"]');
    for (const el of ariaEls) {
      const label = el.getAttribute('aria-label') || '';
      const count = parseReviewCountText(label);
      if (count !== null && count > 0) {
        return count;
      }
    }

    // ---------------------------------------------------------------
    // Strategy 2: dedicated review-count elements (link + span variants)
    // ---------------------------------------------------------------
    const reviewSelectors = [
      'a[href*="customerReviews"] span',
      'a[href*="product-reviews"] span',
      'span.a-size-base.s-underline-text',
      'span.a-size-base.a-color-base',
      'a span.a-size-base'
    ];
    for (const sel of reviewSelectors) {
      const els = item.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.textContent || '').trim();
        const count = parseReviewCountText(text);
        if (count !== null && isPlausibleReviewCount(text, count)) {
          return count;
        }
      }
    }

    // ---------------------------------------------------------------
    // Strategy 3: scoped fallback scan with strict validation so
    // unrelated numbers (price, quantity, discount, title digits)
    // never become a review count.
    // ---------------------------------------------------------------
    const fallbackEls = item.querySelectorAll('span, a, div');
    for (const el of fallbackEls) {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 40) continue;
      if (isInsideHeading(el)) continue; // never scan product titles
      const count = parseReviewCountText(text);
      if (count !== null && isPlausibleReviewCount(text, count)) {
        return count;
      }
    }

    return null; // Review count unavailable — never invent data
  }

  // Converts Indian price text to a numeric value.
  //  ₹999        -> 999
  //  ₹1,099      -> 1099
  //  ₹1,29,999   -> 129999
  function parseIndianNumber(text) {
    if (!text) return null;
    const cleaned = text
      .replace(/rs\.?/i, '')
      .replace(/inr/i, '')
      .replace(/[₹,\s]/g, '')
      .replace(/[()]/g, '')
      .trim();
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Parses a review/rating count from text. Returns null when no valid
  // count can be derived. Supported formats:
  //   92,431 ratings       1200          12400       100000       10000000
  //   9,876 ratings        1.2K ratings  12.4K       1 lakh+      1 crore
  //   1,234 customer reviews / 1.2K / 500
  function parseReviewCountText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // Indian scale: lakh / crore
    const lakh = lower.match(/([\d,.]+)\s*lakh/);
    if (lakh) return Math.round(parseFloat(lakh[1].replace(/,/g, '')) * 100000);
    const crore = lower.match(/([\d,.]+)\s*crore/);
    if (crore) return Math.round(parseFloat(crore[1].replace(/,/g, '')) * 10000000);

    // Suffix scale: K / M
    const kMatch = lower.match(/(\d+(?:\.\d+)?)\s*k\b/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*m\b/);
    if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);

    // Plain comma-formatted number with optional keyword + trailing "+".
    const plain = lower.match(
      /([\d,]+)\s*\+?\s*(?:(?:global|customer|verified)\s+)?(?:ratings?|reviews?)?\s*$/
    );
    if (plain) {
      const num = parseInt(plain[1].replace(/,/g, ''), 10);
      if (!isNaN(num)) return num;
    }

    return null;
  }

  // Guards against unrelated numbers becoming a review count.
  function isPlausibleReviewCount(text, count) {
    if (count === null || count === undefined || count <= 0) return false;
    if (count >= 100000000) return false;
    const lower = text.toLowerCase();
    // Hard rejections that are never review counts
    if (/[₹$€]/.test(text)) return false;                    // prices / EMI
    if (/%/.test(text)) return false;                        // discounts
    if (/\b(bought|emi|month|quantity|discount|sold|offer|deal)\b/.test(lower)) return false;
    // Explicitly mentions ratings/reviews -> plausible at any magnitude
    if (/(ratings?|reviews?)/i.test(lower)) return true;
    const trimmed = text.trim();
    // Pure comma number that is clearly large enough to be a customer count
    if (/^[\d,]+$/.test(trimmed)) return count >= 100;
    // "1.2K" / "1M" short form without a keyword
    if (/^[\d.]+\s*[kKmM]\s*\+?$/.test(trimmed)) return count >= 100;
    return false;
  }

  // True when the element lives inside an <h2> (product title area).
  function isInsideHeading(el) {
    let node = el && el.parentNode ? el.parentNode : null;
    while (node) {
      const tag1 = (node.tagName || node.nodeName || '').toUpperCase();
      const tag2 = (node.tag || '').toUpperCase();
      if (tag1 === 'H2' || tag2 === 'H2') return true;
      node = node.parentNode;
    }
    return false;
  }

  // Expose internals for unit testing (no-op inside the browser extension)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      detectSponsored: detectSponsored,
      parseAmazonProduct: parseAmazonProduct,
      extractTitle: extractTitle,
      extractAsin: extractAsin,
      extractProductUrl: extractProductUrl,
      extractImageUrl: extractImageUrl,
      srcsetToUrl: srcsetToUrl,
      extractPrice: extractPrice,
      extractRating: extractRating,
      extractReviewCount: extractReviewCount,
      parseIndianNumber: parseIndianNumber,
      parseReviewCountText: parseReviewCountText,
      isPlausibleReviewCount: isPlausibleReviewCount,
      normalizeAmazonUrl: normalizeAmazonUrl,
      extractAsinFromUrl: extractAsinFromUrl
    };
  }
})();
