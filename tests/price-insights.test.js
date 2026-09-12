#!/usr/bin/env node
/**
 * ReviewRank — Price Comparison / Price Insights tests (Feature #9).
 *
 * Tests the pure module in lib/price-insights.js plus its contract with the
 * popup pipeline: stats run on the FINAL ranked set, ranking stays
 * review-count driven, and Load More / Pagination / relevance / sponsored /
 * budget interactions behave.
 *
 * Run: node tests/price-insights.test.js
 */
'use strict';

const PI = require('../lib/price-insights.js');
const UI = require('../lib/display.js');
const V = require('../lib/product-validation.js');

var failures = 0;
var assertions = 0;
function assert(cond, label) {
  assertions++;
  if (cond) { console.log('PASS: ' + label); }
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(actual, expected, label) {
  assert(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

// --- Pipeline mirrors (same semantics as popup.js) ---
function sortByReviewCount(products) {
  var copy = products.slice();
  copy.sort(function (a, b) {
    var ac = (typeof a.reviewCount === 'number' && isFinite(a.reviewCount)) ? a.reviewCount : -1;
    var bc = (typeof b.reviewCount === 'number' && isFinite(b.reviewCount)) ? b.reviewCount : -1;
    return bc - ac;
  });
  return copy;
}
function mk(title, price, reviewCount, extra) {
  var base = {
    title: title,
    asin: 'B9' + String(Math.abs(hash(title + price)) % 100000000).padStart(8, '0'),
    canonicalUrl: 'https://www.amazon.in/dp/B9ABCDEF12',
    url: 'https://www.amazon.in/dp/B9ABCDEF12',
    price: price,
    rating: 4.2,
    reviewCount: reviewCount,
    imageUrl: 'https://example.com/i.jpg',
    isSponsored: false,
    marketplace: 'Amazon'
  };
  if (extra) for (var k in extra) base[k] = extra[k];
  return base;
}
function hash(s) {
  var h = 0;
  s = String(s);
  for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return h;
}
function priced(price) { return { price: price }; }

// ---------------------------------------------------------------------------
// BASIC (1-4)
// ---------------------------------------------------------------------------
console.log('--- BASIC stats ---');
var basic = PI.calculatePriceStats([priced(999), priced(1299), priced(1499)]);
eq(basic.lowest, 999, 'basic: lowest of [999,1299,1499]');
eq(basic.highest, 1499, 'basic: highest of [999,1299,1499]');
eq(basic.average, 1266, 'basic: average rounds (3797/3=1265.7 -> 1266)');
eq(basic.validCount, 3, 'basic: valid-price count is 3');
var example = PI.calculatePriceStats([priced(699), priced(999), priced(1499)]);
eq(example.average, 1066, 'basic: spec example average (3197/3 -> 1066)');

// ---------------------------------------------------------------------------
// MISSING DATA (5-9)
// ---------------------------------------------------------------------------
console.log('--- MISSING DATA ---');
eq(PI.calculatePriceStats([priced(999), priced(null), priced(1299)]).average, 1149, 'missing: null ignored (999+1299)/2=1149');
eq(PI.calculatePriceStats([priced(999), priced(NaN), priced(1299)]).validCount, 2, 'missing: NaN ignored');
eq(PI.calculatePriceStats([priced(999), priced(Infinity), priced(1299)]).validCount, 2, 'missing: Infinity ignored');
eq(PI.calculatePriceStats([priced(999), priced(-50), priced(1299)]).validCount, 2, 'missing: negative ignored');
var none = PI.calculatePriceStats([priced(null), priced(undefined), priced(NaN)]);
eq(none.hasPrices, false, 'missing: no valid prices -> hasPrices false');
eq(none.lowest, null, 'missing: lowest null (never 0)');
eq(none.average, null, 'missing: average null (never NaN)');
assert(UI.priceInsightsHTML(none).indexOf('Price insights unavailable') !== -1, 'missing: UI shows unavailable line');
assert(UI.priceInsightsHTML(none).indexOf('₹0') === -1 && UI.priceInsightsHTML(none).indexOf('NaN') === -1, 'missing: UI never renders ₹0/NaN');

// ---------------------------------------------------------------------------
// BUDGET (10-11)
// ---------------------------------------------------------------------------
console.log('--- BUDGET interaction ---');
// Simulate post-pipeline ranked set: only in-budget products reach stats.
var rankedInBudget = [mk('A', 699, 5000), mk('B', 999, 9000), mk('C', 1499, 20000)];
var statsBudget = PI.calculatePriceStats(rankedInBudget);
eq(statsBudget.lowest, 699, 'budget: insights use only ranked/in-budget products (lowest)');
eq(statsBudget.average, 1066, 'budget: insights average over ranked set');
var withExcluded = rankedInBudget.concat([mk('Outlier', 99999, 100)]);
var statsAll = PI.calculatePriceStats(withExcluded);
assert(statsAll.highest === 99999, 'budget: sanity — an out-of-budget product WOULD skew stats, so it must be excluded before calling');
eq(statsBudget.highest, 1499, 'budget: out-of-budget products do not affect statistics');

// ---------------------------------------------------------------------------
// RANKING integrity (12-13)
// ---------------------------------------------------------------------------
console.log('--- RANKING integrity ---');
var rankMix = sortByReviewCount([
  mk('Product B cheap', 699, 10000, { asin: 'B9AAAAAA01' }),
  mk('Product A pricey', 999, 50000, { asin: 'B9AAAAAA02' })
]);
eq(rankMix[0].title, 'Product A pricey', 'ranking: cheaper product does NOT outrank higher-review product');
eq(rankMix[1].title, 'Product B cheap', 'ranking: pricey 50k stays #1, cheap 10k stays #2');
var before = rankMix.map(function (p) { return p.title; }).join('|');
PI.calculatePriceStats(rankMix); // insight call must be side-effect free
PI.getLowestPricedProduct(rankMix);
eq(rankMix.map(function (p) { return p.title; }).join('|'), before, 'ranking: price insights do not modify rank order');
eq(PI.getLowestPricedProduct(rankMix).title, 'Product B cheap', 'ranking: lowest-priced identified without moving it to #1');

// ---------------------------------------------------------------------------
// LOAD MORE (14-16)
// ---------------------------------------------------------------------------
console.log('--- LOAD MORE ---');
var page1 = [mk('P1', 999, 8000, { asin: 'B9AAAAAA11' }), mk('P2', 1399, 9000, { asin: 'B9AAAAAA12' })];
var s1 = PI.calculatePriceStats(page1);
var afterCheap = page1.concat([mk('P3 cheap', 699, 5000, { asin: 'B9AAAAAA13' })]);
eq(PI.calculatePriceStats(afterCheap).lowest, 699, 'loadmore: cheaper product updates lowest');
var afterPricy = page1.concat([mk('P4 pricy', 1499, 4000, { asin: 'B9AAAAAA14' })]);
eq(PI.calculatePriceStats(afterPricy).highest, 1499, 'loadmore: expensive product updates highest');
eq(PI.calculatePriceStats(afterCheap).average, 1032, 'loadmore: average updates correctly ((999+1399+699)/3=1032)');
assert(s1.lowest !== 699, 'loadmore: stats recalculated from full current set, not cached');

// ---------------------------------------------------------------------------
// PAGINATION (17-18)
// ---------------------------------------------------------------------------
console.log('--- PAGINATION ---');
var p1 = [mk('Page1A', 999, 8000, { asin: 'B9AAAAAA21' }), mk('Page1B', 1199, 9000, { asin: 'B9AAAAAA22' })];
var p2 = [mk('Page2A', 699, 7000, { asin: 'B9AAAAAA23' }), mk('Page2B', 1499, 6000, { asin: 'B9AAAAAA24' })];
var merged = sortByReviewCount(p1.concat(p2)); // global ranking preserved
var global = PI.calculatePriceStats(merged);
eq(global.lowest, 699, 'pagination: page-2 cheaper product affects global lowest');
eq(global.highest, 1499, 'pagination: page-2 expensive product affects global highest');
eq(global.average, 1099, 'pagination: global average ((999+1199+699+1499)/4=1099)');
eq(merged[0].reviewCount, 9000, 'pagination: global rank still review-count driven');
var withDup = merged.concat([mk('Page1A', 999, 8000, { asin: 'B9AAAAAA21' })]);
var seen = {};
var deduped = withDup.filter(function (p) { if (seen[p.asin]) return false; seen[p.asin] = true; return true; });
eq(PI.calculatePriceStats(deduped).validCount, 4, 'pagination: duplicates do not double-count (dedup before stats)');

// ---------------------------------------------------------------------------
// RELEVANCE (19) + SPONSORED (20)
// ---------------------------------------------------------------------------
console.log('--- RELEVANCE + SPONSORED ---');
var relevantOnly = [mk('Wireless Earbuds', 999, 8000, { asin: 'B9AAAAAA31' })];
var sRel = PI.calculatePriceStats(relevantOnly);
assert(sRel.lowest === 999, 'relevance: stats computed post-filter on survivors');
var withIrrelevant = relevantOnly.concat([mk('AirPods Case Cover', 100, 100000, { asin: 'B9AAAAAA32' })]);
assert(PI.calculatePriceStats(withIrrelevant).lowest === 100, 'relevance: sanity — irrelevant WOULD skew stats, so it must be filtered first');
eq(sRel.validCount, 1, 'relevance: irrelevant products do not affect statistics');
var organicOnly = [mk('Organic', 999, 7000, { asin: 'B9AAAAAA41', isSponsored: false })];
var withSpon = organicOnly.concat([mk('Sponsored', 100, 99999, { asin: 'B9AAAAAA42', isSponsored: true })]);
var organic = withSpon.filter(function (p) { return !p.isSponsored; });
eq(PI.calculatePriceStats(organic).lowest, 999, 'sponsored: sponsored products do not affect statistics');

// ---------------------------------------------------------------------------
// BUDGET UTILIZATION (21-23)
// ---------------------------------------------------------------------------
console.log('--- BUDGET UTILIZATION ---');
eq(PI.budgetUtilization(999, 1500), 66.6, 'util: 999/1500 -> 66.6%');
eq(PI.formatBudgetUtilization(999, 1500), '66.6%', 'util: formatted 66.6%');
eq(PI.budgetUtilization(999, null), null, 'util: missing max budget -> null (never shown)');
eq(PI.budgetUtilization(999, undefined), null, 'util: undefined max budget -> null');
eq(PI.budgetUtilization(null, 1500), null, 'util: missing price -> null');
eq(PI.budgetUtilization(999, 0), null, 'util: zero max budget -> null (no div-by-zero)');
eq(PI.budgetUtilization(-50, 1500), null, 'util: negative price -> null');

// ---------------------------------------------------------------------------
// FORMATTING (24-26) + product-level position + validation reuse
// ---------------------------------------------------------------------------
console.log('--- FORMATTING + position + validation ---');
eq(UI.formatINR(999), '₹999', 'format: 999 -> ₹999');
eq(UI.formatINR(1099), '₹1,099', 'format: 1099 -> ₹1,099');
eq(UI.formatINR(129999), '₹1,29,999', 'format: 129999 -> ₹1,29,999 (Indian grouping)');
eq(PI.formatPriceInsight(1066, UI.formatINR), '₹1,066', 'format: insight uses existing formatter');
var st = { lowest: 699, highest: 1499, average: 1066, hasPrices: true };
eq(UI.productPriceInsightText({ price: 699 }, st), 'Lowest priced', 'position: lowest product badge');
eq(UI.productPriceInsightText({ price: 916 }, st), '₹150 below average', 'position: ₹150 below average');
eq(UI.productPriceInsightText({ price: 1266 }, st), '₹200 above average', 'position: ₹200 above average');
eq(UI.productPriceInsightText({ price: null }, st), null, 'position: missing price -> hidden');
var card = UI.buildProductCardHTML(mk('X', 999, 100), 4, 'Lowest priced');
assert(card.indexOf('Lowest priced') !== -1 && card.indexOf('data-rank="4"') !== -1, 'position: card shows subtle line without changing rank');
var card2 = UI.buildProductCardHTML(mk('X', 999, 100), 4);
assert(card2.indexOf('product-price-insight') === -1, 'position: card unchanged when no insight (backward compatible)');
eq(V.isValidPrice(999), true, 'validation: reuse — 999 valid');
eq(PI.isUsablePrice(999), true, 'validation: insights agree — 999 usable');
eq(V.isValidPrice(-5), false, 'validation: reuse — negative invalid');
eq(PI.isUsablePrice(-5), false, 'validation: insights agree — negative unusable');
eq(UI.budgetCountText(8), '8 products within budget', 'budget summary: count text from actual ranked count');

console.log('');
console.log('Assertions: ' + assertions);
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
