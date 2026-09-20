/**
 * ReviewRank — Product validation & normalization (pure functions, no DOM).
 *
 * Defensive layer that runs AFTER deduplication and BEFORE budget filtering.
 * Guarantees that every product reaching ranking has trustworthy field types,
 * and that missing data stays null (never invented, never a fake value).
 *
 * Eligibility rule:
 *   Eligible for ranking requires:
 *     - a meaningful title, AND
 *     - at least one usable identity: valid ASIN OR valid canonical product URL.
 *   Optional fields (price, rating, imageUrl, reviewCount) do NOT affect
 *   eligibility — a product missing them can still be ranked. However a
 *   product whose reviewCount is null must never outrank a product with a
 *   valid reviewCount (sorting keeps null-count products at the bottom).
 */
var ReviewRankValidation = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Field validators
  // ------------------------------------------------------------------

  var PLACEHOLDER_TITLES = [
    'sponsored',
    'untitled',
    'no title',
    'n/a',
    'na',
    'unknown',
    'product',
    'loading'
  ];

  // Meaningful title: non-empty after trimming, at least 3 chars,
  // and not an obvious placeholder. (Extraction logic is untouched.)
  function isValidTitle(title) {
    if (typeof title !== 'string') return false;
    var trimmed = title.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 3) return false;
    var lower = trimmed.toLowerCase();
    for (var i = 0; i < PLACEHOLDER_TITLES.length; i++) {
      if (lower === PLACEHOLDER_TITLES[i]) return false;
    }
    return true;
  }

  // Normalize lowercase ASINs to uppercase; invalid ASIN becomes null.
  // Also supports generic productId (same shape for Amazon, opaque for others via alias).
  function normalizeAsin(asin) {
    if (typeof asin !== 'string') return null;
    var upper = asin.trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(upper) ? upper : null;
  }

  function normalizeProductId(productId) {
    if (typeof productId !== 'string') return null;
    var trimmed = productId.trim();
    if (!trimmed) return null;
    // Amazon IDs are strict 10-char; other sites use opaque IDs - accept any non-empty string
    // For Amazon, delegate to normalizeAsin for strictness; for others, accept as-is.
    var upper = trimmed.toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(upper)) return upper;
    return trimmed;
  }

  // Accept legitimate product URLs; reject null/empty, javascript:,
  // "#", review-only, wishlist and other unrelated navigation links.
  // Supports Amazon and generic hosts (Flipkart/Meesho/Myntra) via normalized shape.
  function isValidProductUrl(url) {
    if (typeof url !== 'string') return false;
    var trimmed = url.trim();
    if (trimmed === '' || trimmed === '#') return false;
    var lower = trimmed.toLowerCase();
    if (lower.indexOf('javascript:') === 0) return false;
    if (lower.indexOf('data:') === 0) return false;
    if (/customerReviews|product-reviews|wishlist|boughtTogether|nav|cart/i.test(trimmed)) return false;
    // Must look like a product URL: Amazon (/dp/, /gp/product) OR generic shopping hosts
    if (/amazon\.[a-z.]+\/|\/dp\/|\/gp\/product\//i.test(trimmed)) return true;
    // Generic fallback for Flipkart/Myntra/Meesho - any https URL with host
    if (/^https?:\/\/[^\/]+\//i.test(trimmed)) {
      if (/flipkart\.com|myntra\.com|meesho\.com/i.test(trimmed)) return true;
      // Allow site-relative product paths (/product/, /p/, etc) for future adapters
      if (/\/product\/|\/p\//i.test(trimmed)) return true;
    }
    // Site-relative URLs (e.g. /dp/... already handled; fallback for generic /product)
    if (trimmed.charAt(0) === '/' && trimmed.length > 2) return true;
    return false;
  }

  // Price: finite number >= 0. Strings were already parsed by extraction;
  // any non-number (NaN, Infinity, strings) is invalid. Never invents a price.
  function isValidPrice(price) {
    if (typeof price !== 'number') return false;
    if (!isFinite(price)) return false;
    if (isNaN(price)) return false;
    return price >= 0;
  }

  // Rating: 0 <= rating <= 5. Missing stays null — a real 0-star rating is
  // distinct from an unknown rating, so missing is NEVER converted to 0.
  function isValidRating(rating) {
    if (typeof rating !== 'number') return false;
    if (!isFinite(rating) || isNaN(rating)) return false;
    return rating >= 0 && rating <= 5;
  }

  // Review count: finite, integer, >= 0. Rejects NaN, Infinity, negatives,
  // decimals, and anything currency/discount/EMI-derived (extraction already
  // screens those; this guards the resulting value). Missing stays null.
  function isValidReviewCount(count) {
    if (typeof count !== 'number') return false;
    if (!isFinite(count) || isNaN(count)) return false;
    if (count < 0) return false;
    return Math.floor(count) === count;
  }

  // Image URL: reject data:/javascript: URIs and empty strings. A missing
  // image never disqualifies the product (UI shows its placeholder).
  function isValidImageUrl(url) {
    if (typeof url !== 'string') return false;
    var trimmed = url.trim();
    if (trimmed === '') return false;
    var lower = trimmed.toLowerCase();
    if (lower.indexOf('data:') === 0) return false;
    if (lower.indexOf('javascript:') === 0) return false;
    return true;
  }

  // ------------------------------------------------------------------
  // Eligibility
  // ------------------------------------------------------------------

  // A product can participate in ranking when it has a meaningful title and
  // at least one usable identity: valid productId/ASIN OR valid canonical product URL.
  // Supports both normalized (productId/source) and legacy (asin/marketplace) fields.
  // Amazon products require strict 10-char ASIN; non-Amazon allows generic IDs.
  function isEligibleForRanking(product) {
    if (!product || typeof product !== 'object') return false;
    if (!isValidTitle(product.title)) return false;
    var pid = product.productId || product.asin;
    var source = product.source || product.marketplace || '';
    var isAmazon = !source || source === 'Amazon';
    var hasId = false;
    if (typeof pid === 'string' && pid.trim()) {
      var trimmed = pid.trim();
      if (isAmazon) {
        hasId = normalizeAsin(trimmed) !== null;
      } else {
        // Non-Amazon: allow any non-empty ID >=2 chars (Flipkart/Meesho/Myntra)
        hasId = trimmed.length >= 2;
      }
    }
    // Fallback: also check asin field strictly for Amazon
    if (!hasId && isAmazon) {
      hasId = normalizeAsin(product.asin) !== null;
    }
    var hasUrl = isValidProductUrl(product.canonicalUrl) || isValidProductUrl(product.url);
    return hasId || hasUrl;
  }

  // ------------------------------------------------------------------
  // Normalization — returns a NEW product object with trustworthy fields.
  // Missing/invalid optional fields become null; eligibility failures
  // return null so the caller drops the product entirely.
  // ------------------------------------------------------------------
  function normalizeProduct(product) {
    if (!isEligibleForRanking(product)) return null;

    var rawPid = product.productId || product.asin;
    var pid = null;
    if (typeof rawPid === 'string' && rawPid.trim()) {
      var trimmed = rawPid.trim();
      // Preserve generic IDs as-is; normalize Amazon ASINs to uppercase strict form
      var normalizedAsin = normalizeAsin(trimmed);
      pid = normalizedAsin !== null ? normalizedAsin : trimmed;
    }

    // Keep the working product URL; null it out if it is not a legit
    // product link (canonicalUrl is preserved for eligibility/dedup trust).
    var url = isValidProductUrl(product.url)
      ? product.url
      : (isValidProductUrl(product.canonicalUrl) ? product.canonicalUrl : null);

    var rawImage = product.image || product.imageUrl;
    var normalizedImage = isValidImageUrl(rawImage) ? rawImage : null;
    var sponsored = !!(product.sponsored || product.isSponsored);
    var source = product.source || product.marketplace || 'Amazon';
    var canonical = product.canonicalUrl || url || null;

    return {
      title: typeof product.title === 'string' ? product.title.trim().replace(/\s+/g, ' ') : null,
      // Normalized canonical fields
      price: isValidPrice(product.price) ? product.price : null,
      rating: isValidRating(product.rating) ? product.rating : null,
      reviewCount: isValidReviewCount(product.reviewCount) ? product.reviewCount : null,
      image: normalizedImage,
      url: url,
      productId: pid,
      sponsored: sponsored,
      source: source,
      // Legacy aliases (backward compatibility with existing pipeline/UI)
      asin: pid,
      canonicalUrl: canonical,
      imageUrl: normalizedImage,
      isSponsored: sponsored,
      marketplace: source
    };
  }

  // Validates a list, dropping ineligible products. Order is preserved.
  function validateProducts(products) {
    if (!Array.isArray(products)) return [];
    var result = [];
    for (var i = 0; i < products.length; i++) {
      var normalized = normalizeProduct(products[i]);
      if (normalized !== null) {
        result.push(normalized);
      }
    }
    return result;
  }

  return {
    isValidTitle: isValidTitle,
    normalizeAsin: normalizeAsin,
    normalizeProductId: normalizeProductId,
    isValidProductUrl: isValidProductUrl,
    isValidPrice: isValidPrice,
    isValidRating: isValidRating,
    isValidReviewCount: isValidReviewCount,
    isValidImageUrl: isValidImageUrl,
    isEligibleForRanking: isEligibleForRanking,
    normalizeProduct: normalizeProduct,
    validateProducts: validateProducts
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewRankValidation;
}