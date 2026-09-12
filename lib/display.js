/**
 * ReviewRank — UI display helpers (pure functions, no DOM access).
 *
 * Shared by popup.js (browser) and tests (Node via module.exports).
 * Contains ONLY presentation logic: formatting and message strings.
 * Ranking/filtering/dedup logic lives elsewhere and is NOT here.
 */
var ReviewRankUI = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Number / currency formatting (Indian locale)
  // ------------------------------------------------------------------

  // 999 -> "₹999", 1099 -> "₹1,099", 129999 -> "₹1,29,999"
  function formatINR(num) {
    if (num === null || num === undefined || isNaN(num)) return null;
    return '₹' + num.toLocaleString('en-IN');
  }

  // 24532 -> "24,532" (exact count always shown — no "92.4K" abbreviation)
  function formatExactCount(num) {
    if (num === null || num === undefined || isNaN(num)) return null;
    return num.toLocaleString('en-IN');
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------------
  // Field display formatting — missing fields return null so the caller
  // can hide them gracefully (never "undefined", "null", "₹null", "0 ratings")
  // ------------------------------------------------------------------

  function formatPriceText(product) {
    return formatINR(product.price); // null when price missing
  }

  // "24,532 customer ratings" — ratings volume is the primary signal.
  // If the data specifically indicates written reviews, wording adapts.
  function formatRatingCountText(product) {
    if (product.reviewCount === null || product.reviewCount === undefined || product.reviewCount <= 0) {
      return null;
    }
    var noun = product.countType === 'reviews' ? 'customer reviews' : 'customer ratings';
    return formatExactCount(product.reviewCount) + ' ' + noun;
  }

  // "4.1 average rating" — secondary quality signal only.
  function formatRatingText(product) {
    if (product.rating === null || product.rating === undefined || product.rating <= 0) {
      return null;
    }
    return product.rating.toFixed(1) + ' average rating';
  }

  function formatBudgetRange(minPrice, maxPrice) {
    var hasMin = minPrice !== null && minPrice !== undefined;
    var hasMax = maxPrice !== null && maxPrice !== undefined;
    if (hasMin && hasMax) return formatINR(minPrice) + ' – ' + formatINR(maxPrice);
    if (hasMin) return 'above ' + formatINR(minPrice);
    if (hasMax) return 'under ' + formatINR(maxPrice);
    return null;
  }

  // ------------------------------------------------------------------
  // Results header text
  // ------------------------------------------------------------------

  function resultsHeaderText(displayCount, minPrice, maxPrice, relevanceActive) {
    var count = displayCount === null || displayCount === undefined ? 0 : displayCount;
    var noun = count === 1 ? 'PRODUCT' : 'PRODUCTS';
    var range = formatBudgetRange(minPrice, maxPrice);
    // Feature #8: small relevance indication without exposing raw scores.
    var adjective = relevanceActive ? 'RELEVANT ' : '';
    if (range) {
      return count + ' ' + adjective + noun + ' IN ' + range;
    }
    if (relevanceActive) {
      return count + ' RELEVANT ' + noun + ' FOUND';
    }
    return count + ' ' + noun + ' FOUND';
  }

  var RESULTS_SUBTEXT = 'RANKED BY CUSTOMER RATING COUNT';
  var RANKED_BY_NOTE = 'Ranked by customer rating volume';
  var POPULARITY_DISCLAIMER = 'Rating volume is a popularity indicator and does not represent verified sales.';
  var RELEVANCE_NOTE = 'Filtered for search relevance';
  var RELEVANCE_UNAVAILABLE_NOTE = 'Search relevance unavailable';

  // ------------------------------------------------------------------
  // Empty / error state messages (user-facing, never raw JS errors)
  // ------------------------------------------------------------------

  var MESSAGES = {
    noProducts: 'No Amazon products found on this page.',
    noProductsHint: 'Make sure an Amazon search-results page is open, then analyze again.',
    budgetNoMatch: 'No products found within your budget.',
    budgetNoMatchHint: 'Try widening or increasing your budget range.',
    allSponsored: 'No non-sponsored products found.',
    allSponsoredHint: 'Sponsored listings are excluded from ReviewRank rankings.',
    noRelevant: 'No relevant products found for this search.',
    noRelevantHint: 'Products were detected, but none closely match your search. Try a different search term.',
    notAmazonPage: 'Open an Amazon search-results page first.',
    notSearchResults: 'Navigate to an Amazon search results page, then click Analyze.',
    cannotAccessTab: 'Cannot access the current tab. Please try again.',
    analyzeFailed: 'Could not analyze this page. Please refresh the Amazon page and try again.',
    genericError: 'Something went wrong while analyzing this page. Please refresh and try again.'
  };

  // Whitelist of messages safe to display; anything else becomes generic.
  var SAFE_MESSAGES = [
    MESSAGES.noProducts, MESSAGES.noProductsHint,
    MESSAGES.budgetNoMatch, MESSAGES.budgetNoMatchHint,
    MESSAGES.allSponsored, MESSAGES.allSponsoredHint,
    MESSAGES.noRelevant, MESSAGES.noRelevantHint,
    MESSAGES.notAmazonPage, MESSAGES.notSearchResults,
    MESSAGES.cannotAccessTab, MESSAGES.analyzeFailed
  ];

  function friendlyErrorMessage(err) {
    if (typeof err === 'string' && err) {
      for (var i = 0; i < SAFE_MESSAGES.length; i++) {
        if (err === SAFE_MESSAGES[i]) return err;
      }
    }
    return MESSAGES.genericError; // never leak raw JS / runtime errors
  }

  // ------------------------------------------------------------------
  // Product card HTML builder
  // ------------------------------------------------------------------

  function buildProductCardHTML(product, rank) {
    var p = product || {};
    var safeTitle = escapeHtml(p.title || '');
    var rankClass = rank <= 3 ? 'rank-' + rank : 'rank-default';
    var url = p.url || p.canonicalUrl || '';

    var html = '';
    html += '<div class="product-card" data-rank="' + rank + '">';

    // Prominent rank
    html += '<div class="product-rank">';
    html += '<div class="rank-badge ' + rankClass + '" aria-hidden="true">#' + rank + '</div>';
    html += '<span class="sr-only">Rank ' + rank + '</span>';
    html += '</div>';

    // Product image (placeholder when unavailable — never a broken <img>)
    if (p.imageUrl) {
      html += '<div class="product-image">';
      html += '<img src="' + escapeHtml(p.imageUrl) + '" alt="' + safeTitle + '" loading="lazy">';
      html += '</div>';
    } else {
      html += '<div class="product-image product-image-empty" aria-hidden="true">📦</div>';
    }

    // Info column
    html += '<div class="product-info">';
    html += '<div class="product-title">' + (safeTitle || 'Title unavailable') + '</div>';

    var priceText = formatPriceText(p);
    if (priceText) {
      html += '<div class="product-price">' + priceText + '</div>';
    } else {
      html += '<div class="product-price unavailable">Price unavailable</div>';
    }

    var countText = formatRatingCountText(p);
    if (countText) {
      html += '<div class="review-count">' + countText + '</div>';
    } else {
      html += '<div class="review-count unavailable">Review count unavailable</div>';
    }

    var ratingText = formatRatingText(p);
    if (ratingText) {
      html += '<div class="product-rating">';
      html += '<span class="rating-stars" aria-hidden="true">★</span>';
      html += '<span class="rating-value">' + ratingText + '</span>';
      html += '</div>';
    }

    html += '</div>'; // /product-info

    // Action — uses the product's own URL, opens in a new tab
    html += '<div class="product-actions">';
    if (url) {
      html += '<a class="view-btn" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">View on Amazon</a>';
    }
    html += '</div>';

    html += '</div>'; // /product-card
    return html;
  }

  return {
    formatINR: formatINR,
    formatExactCount: formatExactCount,
    formatPriceText: formatPriceText,
    formatRatingCountText: formatRatingCountText,
    formatRatingText: formatRatingText,
    formatBudgetRange: formatBudgetRange,
    resultsHeaderText: resultsHeaderText,
    RESULTS_SUBTEXT: RESULTS_SUBTEXT,
    RANKED_BY_NOTE: RANKED_BY_NOTE,
    POPULARITY_DISCLAIMER: POPULARITY_DISCLAIMER,
    MESSAGES: MESSAGES,
    friendlyErrorMessage: friendlyErrorMessage,
    buildProductCardHTML: buildProductCardHTML,
    escapeHtml: escapeHtml,
    RELEVANCE_NOTE: RELEVANCE_NOTE,
    RELEVANCE_UNAVAILABLE_NOTE: RELEVANCE_UNAVAILABLE_NOTE
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewRankUI;
}