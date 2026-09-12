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
  function normalizeAsin(asin) {
    if (typeof asin !== 'string') return null;
    var upper = asin.trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(upper) ? upper : null;
  }

  // Accept legitimate Amazon product URLs; reject null/empty, javascript:,
  // "#", review-only, wishlist and other unrelated navigation links.
  function isValidProductUrl(url) {
    if (typeof url !== 'string') return false;
    var trimmed = url.trim();
    if (trimmed === '' || trimmed === '#') return false;
    var lower = trimmed.toLowerCase();
    if (lower.indexOf('javascript:') === 0) return false;
    if (lower.indexOf('data:') === 0) return false;
    if (/customerReviews|product-reviews|wishlist|boughtTogether|nav|cart/i.test(trimmed)) return false;
    // Must point to a product detail page (absolute or site-relative)
    return /amazon\.[a-z.]+\/|\/dp\/|\/gp\/product\//i.test(trimmed);
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
  // at least one usable identity (valid ASIN OR valid canonical product URL).
  function isEligibleForRanking(product) {
    if (!product || typeof product !== 'object') return false;
    if (!isValidTitle(product.title)) return false;
    var hasAsin = normalizeAsin(product.asin) !== null;
    var hasUrl = isValidProductUrl(product.canonicalUrl) || isValidProductUrl(product.url);
    return hasAsin || hasUrl;
  }

  // ------------------------------------------------------------------
  // Normalization — returns a NEW product object with trustworthy fields.
  // Missing/invalid optional fields become null; eligibility failures
  // return null so the caller drops the product entirely.
  // ------------------------------------------------------------------
  function normalizeProduct(product) {
    if (!isEligibleForRanking(product)) return null;

    var asin = normalizeAsin(product.asin);

    // Keep the working product URL; null it out if it is not a legit
    // product link (canonicalUrl is preserved for eligibility/dedup trust).
    var url = isValidProductUrl(product.url)
      ? product.url
      : (isValidProductUrl(product.canonicalUrl) ? product.canonicalUrl : null);

    return {
      title: typeof product.title === 'string' ? product.title.trim().replace(/\s+/g, ' ') : null,
      asin: asin,
      url: url,
      canonicalUrl: product.canonicalUrl || null,
      // Optional fields: null when missing/invalid — never invented
      price: isValidPrice(product.price) ? product.price : null,
      rating: isValidRating(product.rating) ? product.rating : null,
      reviewCount: isValidReviewCount(product.reviewCount) ? product.reviewCount : null,
      imageUrl: isValidImageUrl(product.imageUrl) ? product.imageUrl : null,
      isSponsored: product.isSponsored === true,
      marketplace: product.marketplace || 'Amazon'
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