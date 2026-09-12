/**
 * ReviewRank — Price comparison / price insights (Feature #9).
 *
 * Pure functions, no DOM / no network / no AI / no backend.
 * Current-page price comparison only.
 *
 * CRITICAL INVARIANT: price is an INSIGHT ONLY. Nothing in this module
 * sorts, filters, or re-ranks products. The review-count ranking in
 * popup.js is untouched — callers pass the FINAL ranked set in and get
 * statistics back.
 *
 * Price validity mirrors lib/product-validation.js `isValidPrice`
 * (finite number >= 0; null/NaN/Infinity/negatives/strings rejected).
 * Missing prices are never invented and never treated as zero.
 */
var ReviewRankPriceInsights = (function () {
  'use strict';

  // Same rule as ReviewRankValidation.isValidPrice — kept local so this
  // module stays dependency-free and usable in any context. Intentionally
  // NOT a second conflicting system: identical semantics (>= 0, finite).
  function isUsablePrice(price) {
    if (typeof price !== 'number') return false;
    if (!isFinite(price)) return false;
    if (isNaN(price)) return false;
    return price >= 0;
  }

  function validPrices(products) {
    var out = [];
    if (!Array.isArray(products)) return out;
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var price = p ? p.price : undefined;
      if (isUsablePrice(price)) out.push(price);
    }
    return out;
  }

  // Lowest / highest / average over VALID prices only.
  // average is Math.round(sum / n) for clean INR display.
  // Returns { count, validCount, lowest, highest, average, hasPrices }.
  // lowest/highest/average are null when no valid prices exist.
  function calculatePriceStats(products) {
    var prices = validPrices(products);
    var count = Array.isArray(products) ? products.length : 0;
    if (prices.length === 0) {
      return { count: count, validCount: 0, lowest: null, highest: null, average: null, hasPrices: false };
    }
    var lowest = prices[0];
    var highest = prices[0];
    var sum = 0;
    for (var i = 0; i < prices.length; i++) {
      if (prices[i] < lowest) lowest = prices[i];
      if (prices[i] > highest) highest = prices[i];
      sum += prices[i];
    }
    return {
      count: count,
      validCount: prices.length,
      lowest: lowest,
      highest: highest,
      average: Math.round(sum / prices.length),
      hasPrices: true
    };
  }

  // Deterministic lowest-priced pick. Ties: higher reviewCount wins, then
  // first encountered. Ranking is NEVER modified — informational only.
  function getLowestPricedProduct(products) {
    if (!Array.isArray(products) || products.length === 0) return null;
    var best = null;
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      if (!p || !isUsablePrice(p.price)) continue;
      if (best === null) { best = p; continue; }
      if (p.price < best.price) { best = p; continue; }
      if (p.price === best.price) {
        var aCount = (typeof p.reviewCount === 'number' && isFinite(p.reviewCount)) ? p.reviewCount : -1;
        var bCount = (typeof best.reviewCount === 'number' && isFinite(best.reviewCount)) ? best.reviewCount : -1;
        if (aCount > bCount) best = p;
      }
    }
    return best;
  }

  // (price / maxBudget) * 100, rounded to 1 decimal. Null when maxBudget
  // is missing/invalid or price is unusable. Never negative.
  function budgetUtilization(price, maxBudget) {
    if (!isUsablePrice(price)) return null;
    if (typeof maxBudget !== 'number' || !isFinite(maxBudget) || isNaN(maxBudget)) return null;
    if (maxBudget <= 0) return null;
    var pct = (price / maxBudget) * 100;
    if (!isFinite(pct) || isNaN(pct) || pct < 0) return null;
    return Math.round(pct * 10) / 10;
  }

  function formatBudgetUtilization(price, maxBudget) {
    var pct = budgetUtilization(price, maxBudget);
    if (pct === null || pct === undefined) return null;
    return pct + '%';
  }

  // Subtle per-product position against the ranked-set stats.
  // Returns { type, diff } where type is 'lowest' | 'below' | 'above' | null.
  // diff is the absolute rupee distance from the average (rounded).
  // Null when the product has no usable price or stats lack an average.
  function pricePosition(product, stats) {
    if (!product || !isUsablePrice(product.price)) return { type: null, diff: null };
    if (!stats || !stats.hasPrices || typeof stats.average !== 'number') return { type: null, diff: null };
    if (product.price === stats.lowest) return { type: 'lowest', diff: 0 };
    var diff = Math.round(stats.average - product.price);
    if (diff > 0) return { type: 'below', diff: diff };
    if (diff < 0) return { type: 'above', diff: -diff };
    return { type: null, diff: null };
  }

  // Internal INR fallback (identical output to display.formatINR) used only
  // when the caller does not supply a formatter. Popup passes UI.formatINR
  // so there is exactly one canonical formatter in the extension.
  function defaultFormatINR(num) {
    if (num === null || num === undefined || (typeof num === 'number' && isNaN(num))) return null;
    return '₹' + Number(num).toLocaleString('en-IN');
  }

  // Human-readable insight for a single value ("₹1,066").
  function formatPriceInsight(value, formatFn) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) return null;
    var fmt = (typeof formatFn === 'function') ? formatFn : defaultFormatINR;
    try { return fmt(value); } catch (e) { return defaultFormatINR(value); }
  }

  return {
    isUsablePrice: isUsablePrice,
    validPrices: validPrices,
    calculatePriceStats: calculatePriceStats,
    getLowestPricedProduct: getLowestPricedProduct,
    budgetUtilization: budgetUtilization,
    formatBudgetUtilization: formatBudgetUtilization,
    pricePosition: pricePosition,
    formatPriceInsight: formatPriceInsight
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewRankPriceInsights;
}
try {
  if (typeof window !== 'undefined') window.ReviewRankPriceInsights = ReviewRankPriceInsights;
  if (typeof globalThis !== 'undefined') globalThis.ReviewRankPriceInsights = ReviewRankPriceInsights;
} catch (e) { /* non-browser runtimes */ }
