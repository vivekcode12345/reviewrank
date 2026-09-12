/**
 * ReviewRank — Display pagination (UI pagination for the popup).
 *
 * Pure functions, no DOM / no network.
 * Slices a globally-ranked product set into pages of fixed size.
 * This is separate from Amazon search-result pagination
 * (background/background.js), which scrapes additional product pages.
 *
 * Ranking is calculated globally BEFORE slicing into pages.
 * Price insights operate on the full ranked set (not just visible page).
 */
var ReviewRankPagination = (function () {
  'use strict';

  // Products per page in the popup display
  var PAGE_SIZE = 4;

  // Returns the total number of pages for a given ranked set and page size
  function getTotalPages(products, pageSize) {
    var count = Array.isArray(products) ? products.length : 0;
    var size = (typeof pageSize === 'number' && pageSize > 0) ? pageSize : PAGE_SIZE;
    if (count === 0) return 0;
    return Math.ceil(count / size);
  }

  // Returns the products for a specific 1-indexed page
  function getPageProducts(products, page, pageSize) {
    var count = Array.isArray(products) ? products.length : 0;
    var size = (typeof pageSize === 'number' && pageSize > 0) ? pageSize : PAGE_SIZE;
    if (count === 0) return [];
    if (page < 1) return [];
    var start = (page - 1) * size;
    if (start >= count) return [];
    var end = Math.min(start + size, count);
    var result = [];
    for (var i = start; i < end; i++) {
      result.push(products[i]);
    }
    return result;
  }

  // Returns { start, end, total } display range info for a page
  // e.g. { start: 1, end: 4, total: 12 } for page 1 of 3 (PAGE_SIZE=4)
  function getPageRange(page, products, pageSize) {
    var count = Array.isArray(products) ? products.length : 0;
    var size = (typeof pageSize === 'number' && pageSize > 0) ? pageSize : PAGE_SIZE;
    var total = count;
    if (count === 0 || page < 1) return { start: 0, end: 0, total: total };
    var totalPages = Math.ceil(count / size);
    if (page > totalPages) return { start: 0, end: 0, total: total };
    var start = (page - 1) * size + 1;
    var end = Math.min(start + size - 1, count);
    return { start: start, end: end, total: total };
  }

  return {
    PAGE_SIZE: PAGE_SIZE,
    getTotalPages: getTotalPages,
    getPageProducts: getPageProducts,
    getPageRange: getPageRange
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewRankPagination;
}
try {
  if (typeof window !== 'undefined') window.ReviewRankPagination = ReviewRankPagination;
  if (typeof globalThis !== 'undefined') globalThis.ReviewRankPagination = ReviewRankPagination;
} catch (e) { /* non-browser runtimes */ }
