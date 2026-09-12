#!/usr/bin/env node
/**
 * ReviewRank — Missing/Invalid Data Handling tests.
 *
 * Tests the pure validation layer in lib/product-validation.js, plus
 * ranking/budget interactions using mirrors of the popup pipeline functions.
 *
 * Run: node tests/product-validation.test.js
 */
'use strict';

const V = require('../lib/product-validation.js');

var failures = 0;
function assert(cond, label) {
  if (cond) { console.log('PASS: ' + label); }
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(actual, expected, label) {
  assert(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

// ---------------------------------------------------------------------------
// TITLE
// ---------------------------------------------------------------------------
console.log('--- TITLE VALIDATION ---');
eq(V.isValidTitle('boAt Rockerz 450 Bluetooth Headphones'), true, 'title: valid title accepted');
eq(V.isValidTitle('Wireless Earbuds'), true, 'title: another valid title accepted');
eq(V.isValidTitle(null), false, 'title: null rejected');
eq(V.isValidTitle(undefined), false, 'title: undefined rejected');
eq(V.isValidTitle(''), false, 'title: empty rejected');
eq(V.isValidTitle('   '), false, 'title: whitespace-only rejected');
eq(V.isValidTitle('ab'), false, 'title: too short rejected');
eq(V.isValidTitle('Sponsored'), false, 'title: "Sponsored" placeholder rejected');
eq(V.isValidTitle('Untitled'), false, 'title: "Untitled" placeholder rejected');

// ---------------------------------------------------------------------------
// ASIN
// ---------------------------------------------------------------------------
console.log('--- ASIN VALIDATION ---');
eq(V.normalizeAsin('B0ABCDEF12'), 'B0ABCDEF12', 'asin: valid ASIN kept');
eq(V.normalizeAsin('b0abcdef12'), 'B0ABCDEF12', 'asin: lowercase normalized to uppercase');
eq(V.normalizeAsin(' b0abcdeF12 '), 'B0ABCDEF12', 'asin: whitespace trimmed + uppercased');
eq(V.normalizeAsin('B0ABC'), null, 'asin: too short rejected -> null');
eq(V.normalizeAsin('B0ABCDEF12345'), null, 'asin: too long rejected -> null');
eq(V.normalizeAsin('B0ABC!@#12'), null, 'asin: invalid characters rejected -> null');
eq(V.normalizeAsin(null), null, 'asin: null -> null (missing, product NOT auto-discarded)');
eq(V.normalizeAsin(12345), null, 'asin: non-string rejected -> null');

// Missing ASIN allowed when URL is valid (eligibility via canonical URL)
var noAsinWithUrl = { title: 'Valid Product', asin: null, canonicalUrl: 'https://www.amazon.in/dp/B0ABCDEF12' };
// ---------------------------------------------------------------------------
// PRICE
// ---------------------------------------------------------------------------
console.log('--- PRICE VALIDATION ---');
eq(V.isValidPrice(999), true, 'price: 999 valid');
eq(V.isValidPrice(129999), true, 'price: 129999 valid');
eq(V.isValidPrice(0), true, 'price: 0 is finite and >= 0 (valid value)');
eq(V.isValidPrice(null), false, 'price: null invalid (missing)');
eq(V.isValidPrice(undefined), false, 'price: undefined invalid');
eq(V.isValidPrice(NaN), false, 'price: NaN invalid');
eq(V.isValidPrice(Infinity), false, 'price: Infinity invalid');
eq(V.isValidPrice(-999), false, 'price: negative invalid');
eq(V.isValidPrice('999'), false, 'price: unparsed string invalid');

// ---------------------------------------------------------------------------
// RATING
// ---------------------------------------------------------------------------
console.log('--- RATING VALIDATION ---');
eq(V.isValidRating(4.5), true, 'rating: 4.5 valid');
eq(V.isValidRating(0), true, 'rating: 0 valid (a real 0 value)');
eq(V.isValidRating(5), true, 'rating: 5 valid');
eq(V.isValidRating(3.8), true, 'rating: 3.8 valid');
eq(V.isValidRating(5.1), false, 'rating: 5.1 invalid (> 5)');
eq(V.isValidRating(-1), false, 'rating: -1 invalid (negative)');
eq(V.isValidRating(NaN), false, 'rating: NaN invalid');
eq(V.isValidRating(Infinity), false, 'rating: Infinity invalid');
eq(V.isValidRating(null), false, 'rating: null invalid as a value (missing stays null)');

// Normalization keeps missing rating null, never converts to 0
var noRatingProduct = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12' });
eq(noRatingProduct.rating, null, 'rating: missing rating stays null after normalization (not 0)');

// ---------------------------------------------------------------------------
// REVIEW COUNT (most important field)
// ---------------------------------------------------------------------------
console.log('--- REVIEW COUNT VALIDATION ---');
eq(V.isValidReviewCount(92431), true, 'count: 92431 valid');
eq(V.isValidReviewCount(0), true, 'count: 0 valid (integer >= 0)');
eq(V.isValidReviewCount(100), true, 'count: 100 valid');
eq(V.isValidReviewCount(1.2), false, 'count: 1.2 invalid (decimal — counts must be integers)');
eq(V.isValidReviewCount(24532.5), false, 'count: 24532.5 invalid (decimal)');
eq(V.isValidReviewCount(-500), false, 'count: negative invalid');
eq(V.isValidReviewCount(NaN), false, 'count: NaN invalid');
eq(V.isValidReviewCount(Infinity), false, 'count: Infinity invalid');
eq(V.isValidReviewCount('92431'), false, 'count: unparsed string invalid');
eq(V.isValidReviewCount(null), false, 'count: null invalid as a value (missing stays null)');

var noCountProduct = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12', url: 'https://www.amazon.in/dp/B0ABCDEF12' });
eq(noCountProduct.reviewCount, null, 'count: missing reviewCount stays null after normalization (never invented)');

// No sales estimation: validation never relabels ratings as sales
var salesSafe = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12', reviewCount: 10000 });
eq(salesSafe.reviewCount, 10000, 'count: 10,000 ratings stays 10,000 ratings (never converted to sales)');
eq(V.isEligibleForRanking(noAsinWithUrl), true, 'asin: missing ASIN allowed when canonical URL is valid');

// ---------------------------------------------------------------------------
// PRODUCT URL
// ---------------------------------------------------------------------------
console.log('--- PRODUCT URL VALIDATION ---');
eq(V.isValidProductUrl('https://www.amazon.in/dp/B0ABCDEF12'), true, 'url: valid dp URL accepted');
eq(V.isValidProductUrl('https://www.amazon.in/Some-Product/dp/B0ABCDEF12/ref=sr_1_1'), true, 'url: dp URL with slug/ref accepted');
eq(V.isValidProductUrl('/Some-Product/dp/B0ABCDEF12'), true, 'url: site-relative product URL accepted');
eq(V.isValidProductUrl('https://www.amazon.in/gp/product/B0ABCDEF12'), true, 'url: gp/product URL accepted');
eq(V.isValidProductUrl(null), false, 'url: null rejected');
eq(V.isValidProductUrl(''), false, 'url: empty rejected');
eq(V.isValidProductUrl('#'), false, 'url: "#" rejected');
eq(V.isValidProductUrl('javascript:void(0)'), false, 'url: javascript: rejected');
eq(V.isValidProductUrl('https://www.amazon.in/product-reviews/B0ABCDEF12'), false, 'url: review-only link rejected');
eq(V.isValidProductUrl('https://www.amazon.in/gp/wishlist'), false, 'url: wishlist link rejected');
eq(V.isValidProductUrl('https://www.google.com/search?q=x'), false, 'url: unrelated navigation rejected');

// ---------------------------------------------------------------------------
// IMAGE URL
// ---------------------------------------------------------------------------
console.log('--- IMAGE URL VALIDATION ---');
eq(V.isValidImageUrl('https://m.media-amazon.com/images/I/51A.jpg'), true, 'image: https URL valid');
eq(V.isValidImageUrl('data:image/png;base64,AAAA'), false, 'image: data: URI rejected');
eq(V.isValidImageUrl('javascript:void(0)'), false, 'image: javascript: rejected');
eq(V.isValidImageUrl(''), false, 'image: empty string rejected');
eq(V.isValidImageUrl(null), false, 'image: null rejected (missing image never disqualifies product)');

// ---------------------------------------------------------------------------
// RANKING with validation (mirrors popup pipeline)
// ---------------------------------------------------------------------------
console.log('--- RANKING ---');

function sortByReviewCount(products) {
  var copy = products.slice();
  copy.sort(function (a, b) {
    var aCount = (typeof a.reviewCount === 'number' && isFinite(a.reviewCount)) ? a.reviewCount : -1;
    var bCount = (typeof b.reviewCount === 'number' && isFinite(b.reviewCount)) ? b.reviewCount : -1;
    return bCount - aCount;
  });
  return copy;
}

function processPipeline(products, minPrice, maxPrice) {
  // Pipeline: dedup -> VALIDATE -> budget -> sponsored exclusion -> sort
  var seen = {};
  var order = [];
  for (var i = 0; i < products.length; i++) {
    var key = products[i].asin ? 'asin:' + products[i].asin : (products[i].canonicalUrl ? 'url:' + products[i].canonicalUrl : 'fb:' + i);
    if (!seen.hasOwnProperty(key)) { seen[key] = products[i]; order.push(key); }
  }
  var unique = order.map(function (k) { return seen[k]; });
  var valid = V.validateProducts(unique);
  var filtered = filterByPriceRange(valid, minPrice, maxPrice);
  var organic = filtered.filter(function (p) { return !p.isSponsored; });
  return sortByReviewCount(organic);
}

function filterByPriceRange(products, minPrice, maxPrice) {
  if (minPrice === null && maxPrice === null) return products;
  var result = [];
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (p.price == null || p.price === 0) continue; // missing price never passes an active budget
    if (minPrice !== null && p.price < minPrice) continue;
    if (maxPrice !== null && p.price > maxPrice) continue;
    result.push(p);
  }
  return result;
}

// 50,000 ranks above 10,000
var rankOut = processPipeline([
  { title: 'High', asin: 'B0AAAAAA01', reviewCount: 50000, rating: 4.2 },
  { title: 'Mid', asin: 'B0AAAAAA02', reviewCount: 10000, rating: 4.8 }
], null, null);
eq(rankOut[0].title, 'High', 'ranking: 50,000 ratings ranks above 10,000');
eq(rankOut[1].title, 'Mid', 'ranking: 10,000 ranks second');

// Higher star rating does NOT outrank review-count leader
var starVsCount = processPipeline([
  { title: 'FewHighStars', asin: 'B0AAAAAA03', reviewCount: 500, rating: 4.8 },
  { title: 'ManyLowStars', asin: 'B0AAAAAA04', reviewCount: 50000, rating: 4.2 }
], null, null);
eq(starVsCount[0].title, 'ManyLowStars', 'ranking: review count primary (50k@4.2 beats 500@4.8)');

// 10,000 ranks above null; nulls stay at the bottom
var nullLast = processPipeline([
  { title: 'UnknownCount', asin: 'B0AAAAAA05', reviewCount: null },
  { title: 'TenK', asin: 'B0AAAAAA06', reviewCount: 10000 },
  { title: 'UnknownCount2', asin: 'B0AAAAAA07', reviewCount: null }
], null, null);
eq(nullLast.length, 3, 'ranking: null-count products still eligible (kept in list)');
eq(nullLast[0].title, 'TenK', 'ranking: 10,000 ranks above null');
eq(nullLast[1].reviewCount, null, 'ranking: null-count products at bottom (position 2)');
eq(nullLast[2].reviewCount, null, 'ranking: null-count products at bottom (position 3)');

// Zero count ranks above null count
var zeroVsNull = sortByReviewCount([
  { title: 'NullCount', reviewCount: null },
  { title: 'ZeroCount', reviewCount: 0 }
]);
eq(zeroVsNull[0].title, 'ZeroCount', 'ranking: reviewCount 0 ranks above null');

// ---------------------------------------------------------------------------
// BUDGET interaction with validation
// ---------------------------------------------------------------------------
console.log('--- BUDGET ---');

var budgetList = [
  { title: 'Inside', asin: 'B0BBBBBB01', price: 999, reviewCount: 5000 },
  { title: 'Outside', asin: 'B0BBBBBB02', price: 2999, reviewCount: 90000 },
  { title: 'NoPrice', asin: 'B0BBBBBB03', price: null, reviewCount: 200000 },
  { title: 'BadPrice', asin: 'B0BBBBBB04', price: -50, reviewCount: 150000 },
  { title: 'NaNPrice', asin: 'B0BBBBBB05', price: NaN, reviewCount: 100000 }
];

// Budget active: only valid prices inside the range survive
var budgetActive = processPipeline(budgetList, 600, 1500);
eq(budgetActive.length, 1, 'budget: only in-range valid prices included (got ' + budgetActive.length + ')');
eq(budgetActive[0].title, 'Inside', 'budget: valid price inside range -> included');

// Price outside range excluded
var outsideOnly = processPipeline([{ title: 'Outside', asin: 'B0BBBBBB06', price: 2999, reviewCount: 90000 }], 600, 1500);
eq(outsideOnly.length, 0, 'budget: valid price outside range -> excluded');

// Missing/invalid price with active budget: must NOT silently pass
var noPriceActive = processPipeline([{ title: 'NoPrice', asin: 'B0BBBBBB07', price: null, reviewCount: 500000 }], 600, 1500);
eq(noPriceActive.length, 0, 'budget: missing price with active budget -> excluded (never silently passes)');

var nanPriceActive = processPipeline([{ title: 'NaNPrice', asin: 'B0BBBBBB08', price: NaN, reviewCount: 500000 }], 600, 1500);
eq(nanPriceActive.length, 0, 'budget: NaN price with active budget -> excluded');

var negPriceActive = processPipeline([{ title: 'BadPrice', asin: 'B0BBBBBB09', price: -50, reviewCount: 500000 }], 600, 1500);
eq(negPriceActive.length, 0, 'budget: negative price with active budget -> excluded');

// Normalized invalid prices become null, then the budget filter drops them
var normalizedPrice = V.normalizeProduct({ title: 'Price Test Product', asin: 'B0BBBBBB10', price: Infinity, reviewCount: 10 });
eq(normalizedPrice.price, null, 'budget: Infinity price normalized to null');

// No budget: missing price is allowed and product still ranks
var noBudget = processPipeline(budgetList, null, null);
assert(noBudget.some(function (p) { return p.title === 'NoPrice'; }), 'budget: missing price with NO budget -> allowed and ranked');
eq(noBudget[0].title, 'NoPrice', 'budget: missing-price product (200k count) ranks first when no budget set');

// ---------------------------------------------------------------------------
// PRODUCT ELIGIBILITY
// ---------------------------------------------------------------------------
console.log('--- PRODUCT ELIGIBILITY ---');

// Eligible: valid title + ASIN
eq(V.isEligibleForRanking({ title: 'Valid Product', asin: 'B0ABCDEF12' }), true, 'eligibility: valid title + ASIN -> eligible');

// Eligible: valid title + canonical URL (no ASIN)
eq(V.isEligibleForRanking({ title: 'Valid Product', asin: null, canonicalUrl: 'https://www.amazon.in/dp/B0ABCDEF12' }), true, 'eligibility: valid title + canonical URL -> eligible');

// Rejected: no title
eq(V.isEligibleForRanking({ title: null, asin: 'B0ABCDEF12' }), false, 'eligibility: no title -> rejected');
eq(V.isEligibleForRanking({ title: '', asin: 'B0ABCDEF12' }), false, 'eligibility: empty title -> rejected');

// Rejected: no ASIN + no usable URL
eq(V.isEligibleForRanking({ title: 'Valid Product', asin: null, canonicalUrl: null }), false, 'eligibility: no ASIN + no URL -> rejected');
eq(V.isEligibleForRanking({ title: 'Valid Product', asin: null, url: 'javascript:void(0)' }), false, 'eligibility: only javascript: URL -> rejected');

// Missing optional fields do NOT remove the product
var missingImage = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12', imageUrl: null });
assert(missingImage !== null, 'eligibility: missing image -> still eligible');

var missingRating = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12', rating: null });
assert(missingRating !== null, 'eligibility: missing rating -> still eligible');

var missingCount = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12', reviewCount: null });
assert(missingCount !== null, 'eligibility: missing reviewCount -> still eligible (ranked last)');

var missingPriceNoBudget = V.normalizeProduct({ title: 'Valid Product', asin: 'B0ABCDEF12', price: null });
assert(missingPriceNoBudget !== null, 'eligibility: missing price -> still eligible (allowed when no budget)');

// validateProducts drops ineligible and keeps eligible in order
var mixed = V.validateProducts([
  { title: null, asin: 'B0AAAAAA11' },                                            // dropped: no title
  { title: 'Keep Me 1', asin: 'B0AAAAAA12', reviewCount: 100 },                   // kept
  { title: 'Dropped No Identity', asin: null, canonicalUrl: null },               // dropped
  { title: 'Keep Me 2', asin: null, canonicalUrl: 'https://www.amazon.in/dp/B0AAAAAA13', reviewCount: null } // kept
]);
eq(mixed.length, 2, 'eligibility: validateProducts drops ineligible (got ' + mixed.length + ', expected 2)');
eq(mixed[0].title, 'Keep Me 1', 'eligibility: eligible product 1 preserved in order');
eq(mixed[1].title, 'Keep Me 2', 'eligibility: eligible product 2 preserved in order');

// Sponsored flag preserved through validation (does not break sponsored exclusion)
var sponsoredKept = V.normalizeProduct({ title: 'Sponsored Product', asin: 'B0AAAAAA14', isSponsored: true, reviewCount: 999999 });
eq(sponsoredKept.isSponsored, true, 'eligibility: isSponsored preserved through validation');
var organicKept = V.normalizeProduct({ title: 'Organic Product', asin: 'B0AAAAAA15', isSponsored: false, reviewCount: 10 });
eq(organicKept.isSponsored, false, 'eligibility: organic flag preserved');

// Validation does not merge duplicates (dedup remains a separate, unchanged step)
var dupList = V.validateProducts([
  { title: 'Dup', asin: 'B0AAAAAA16', reviewCount: 500 },
  { title: 'Dup', asin: 'B0AAAAAA16', reviewCount: 500 }
]);
eq(dupList.length, 2, 'eligibility: validation itself does not merge duplicates');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);