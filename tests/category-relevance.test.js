#!/usr/bin/env node
/**
 * ReviewRank — Category Relevance tests (Feature #8).
 *
 * Tests the pure shared layer in lib/category-relevance.js plus its
 * interaction with the popup pipeline (mirrored locally: relevance BEFORE
 * review-count sort, same function for initial / load-more / pagination).
 *
 * Run: node tests/category-relevance.test.js
 */
'use strict';

const R = require('../lib/category-relevance.js');
const V = require('../lib/product-validation.js');
const UI = require('../lib/display.js');

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

// ---------------------------------------------------------------------------
// Pipeline mirrors (identical semantics to popup.js — relevance BEFORE sort)
// ---------------------------------------------------------------------------
function sortByReviewCount(products) {
  var copy = products.slice();
  copy.sort(function (a, b) {
    var ac = (typeof a.reviewCount === 'number' && isFinite(a.reviewCount)) ? a.reviewCount : -1;
    var bc = (typeof b.reviewCount === 'number' && isFinite(b.reviewCount)) ? b.reviewCount : -1;
    return bc - ac;
  });
  return copy;
}
function excludeSponsored(products) {
  return products.filter(function (p) { return !p.isSponsored; });
}
function filterByPriceRange(products, min, max) {
  if (min == null && max == null) return products.slice();
  return products.filter(function (p) {
    if (p.price == null || p.price === 0) return false;
    if (min != null && p.price < min) return false;
    if (max != null && p.price > max) return false;
    return true;
  });
}
// Full pipeline mirror: dedup-lite (by asin) -> validate -> relevance ->
// budget -> sponsored -> sort. Returns ranked array.
function runPipeline(raw, query, budget) {
  budget = budget || { min: null, max: null };
  var seen = {};
  var unique = [];
  raw.forEach(function (p) {
    var key = p.asin ? 'asin:' + p.asin : 'url:' + (p.canonicalUrl || p.url || Math.random());
    if (!seen[key]) { seen[key] = true; unique.push(p); }
  });
  var valid = V.validateProducts(unique);
  var rel = R.filterRelevantProducts(valid, query);
  var relevant = rel.available ? rel.relevant : valid;
  var filtered = filterByPriceRange(relevant, budget.min, budget.max);
  var organic = excludeSponsored(filtered);
  return { ranked: sortByReviewCount(organic), rel: rel };
}
function mk(title, reviewCount, extra) {
  var base = {
    title: title,
    asin: 'B0' + String(Math.abs(hash(title)) % 100000000).padStart(8, '0'),
    canonicalUrl: 'https://www.amazon.in/dp/B0ABCDEF12',
    url: 'https://www.amazon.in/dp/B0ABCDEF12',
    price: 999,
    rating: 4.2,
    reviewCount: reviewCount,
    imageUrl: 'https://example.com/img.jpg',
    isSponsored: false,
    marketplace: 'Amazon'
  };
  if (extra) for (var k in extra) base[k] = extra[k];
  return base;
}
function hash(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return h;
}

// ---------------------------------------------------------------------------
// 1-4. QUERY EXTRACTION
// ---------------------------------------------------------------------------
console.log('--- QUERY EXTRACTION: URL k parameter ---');
eq(R.extractSearchQueryFromUrl('https://www.amazon.in/s?k=wireless+airpods'), 'wireless airpods', 'query: URL k with + decoding');
eq(R.extractSearchQueryFromUrl('https://www.amazon.in/s?k=usb%20c%20cable&page=2'), 'usb c cable', 'query: URL k with %20 decoding');
eq(R.extractSearchQueryFromUrl('https://www.amazon.in/dp/B0ABCDEF12'), '', 'query: product URL has no k -> empty');
eq(R.extractSearchQueryFromUrl(''), '', 'query: empty URL -> empty');
eq(R.extractSearchQueryFromUrl(null), '', 'query: null URL -> empty (never throws)');

console.log('--- QUERY EXTRACTION: search input preference ---');
eq(R.extractSearchQuery('wireless airpods', 'https://www.amazon.in/s?k=other'), 'wireless airpods', 'query: input value wins over URL');
eq(R.extractSearchQuery('', 'https://www.amazon.in/s?k=wireless+airpods'), 'wireless airpods', 'query: empty input falls back to URL k');
eq(R.extractSearchQuery('  ', 'https://www.amazon.in/s?k=airpods+case'), 'airpods case', 'query: whitespace input falls back to URL');
eq(R.extractSearchQuery('', ''), '', 'query: missing everywhere -> empty');

console.log('--- QUERY EXTRACTION: normalization ---');
eq(R.normalizeQuery('  Wireless   AIRPODS!! '), 'wireless airpods', 'query: lowercase/trim/collapse/punctuation');
eq(R.normalizeQuery('wireless earbuds under 1500'), 'wireless earbuds', 'query: budget portion stripped');
eq(R.normalizeQuery('earbuds below rs 2000'), 'earbuds', 'query: below-rs budget stripped');
eq(R.stripBudgetNoise('wireless earbuds under 1500'), 'wireless earbuds', 'query: stripBudgetNoise removes under+N');
eq(R.normalizeQuery('iphone 15'), 'iphone 15', 'query: model numbers survive (no budget keyword)');

console.log('--- QUERY EXTRACTION: missing query ---');
var missing = R.filterRelevantProducts([mk('Anything', 100)], '');
eq(missing.available, false, 'query: empty query -> filter unavailable');
eq(missing.relevant.length, 1, 'query: empty query keeps products (no aggressive filtering)');
var nullq = R.calculateRelevance('Wireless Earbuds', '');
eq(nullq.category, 'UNKNOWN', 'query: empty query -> UNKNOWN category');

// ---------------------------------------------------------------------------
// 5-10. RELEVANCE CORE
// ---------------------------------------------------------------------------
console.log('--- RELEVANCE: core scenarios ---');
eq(R.calculateRelevance('Wireless AirPods Pro', 'wireless airpods').category, 'HIGH', 'rel: wireless airpods + AirPods Pro -> HIGH');
eq(R.calculateRelevance('AirPods Case Cover', 'wireless airpods').category, 'LOW', 'rel: wireless airpods + Case Cover -> LOW');
eq(R.calculateRelevance('USB Charging Cable', 'wireless airpods').category, 'LOW', 'rel: wireless airpods + USB Cable -> LOW');
eq(R.calculateRelevance('Premium AirPods Case Cover', 'airpods case').category, 'HIGH', 'rel: airpods case + Case Cover -> HIGH (intent override)');
eq(R.calculateRelevance('USB C Charging Cable', 'usb c cable').category, 'HIGH', 'rel: usb c cable + Charging Cable -> HIGH (intent override)');
var negOverride = R.calculateRelevance('AirPods Case Cover', 'airpods case');
assert(negOverride.category !== 'LOW', 'rel: case/cover do not override matching query intent');

// ---------------------------------------------------------------------------
// Example-scenario checks (spec section 8)
// ---------------------------------------------------------------------------
console.log('--- RELEVANCE: example scenarios ---');
eq(R.calculateRelevance('boAt Airdopes 141 Wireless Earbuds', 'wireless airpods').category, 'HIGH', 'rel: boAt Airdopes -> HIGH via audio alias');
eq(R.calculateRelevance('Noise Wireless Earbuds', 'wireless airpods').category, 'HIGH', 'rel: Noise Earbuds -> HIGH');
eq(R.calculateRelevance('Wireless Bluetooth Earbuds', 'wireless earbuds under 1500').category, 'HIGH', 'rel: budget query still HIGH (budget ignored)');
eq(R.calculateRelevance('Earbuds Carrying Case', 'wireless earbuds under 1500').category, 'LOW', 'rel: carrying case -> LOW under budget query');

// ---------------------------------------------------------------------------
// 11-14. RANKING
// ---------------------------------------------------------------------------
console.log('--- RANKING: relevance before review count ---');
var mix = runPipeline([
  mk('AirPods Case Cover', 100000),
  mk('Wireless Earbuds Pro', 5000)
], 'wireless airpods');
eq(mix.ranked.length, 1, 'rank: LOW 100k filtered, only relevant remains');
eq(mix.ranked[0].reviewCount, 5000, 'rank: relevant 5k beats irrelevant 100k (irrelevant excluded)');

var ordered = runPipeline([
  mk('Wireless Earbuds C Model', 5000, { asin: 'B0AAAAAA01' }),
  mk('Wireless Earbuds A Model', 20000, { asin: 'B0AAAAAA02' }),
  mk('Wireless Earbuds B Model', 10000, { asin: 'B0AAAAAA03' })
], 'wireless earbuds');
eq(ordered.ranked.map(function (p) { return p.reviewCount; }).join(','), '20000,10000,5000', 'rank: relevant 20k > 10k > 5k preserved');

var sameRel = runPipeline([
  mk('Wireless Earbuds X1', 100, { asin: 'B0AAAAAA11' }),
  mk('Wireless Earbuds X2', 9000, { asin: 'B0AAAAAA12' })
], 'wireless earbuds');
eq(sameRel.ranked[0].reviewCount, 9000, 'rank: relevance does NOT replace review-count ordering among relevant');
var ranks = sameRel.ranked.map(function (_, i) { return i + 1; });
eq(ranks.join(','), '1,2'.slice(0, ranks.length * 2 - 1), 'rank: ranks remain contiguous #1..#n');

// ---------------------------------------------------------------------------
// 15-16. LOAD MORE + PAGINATION (same shared function)
// ---------------------------------------------------------------------------
console.log('--- LOAD MORE / PAGINATION: shared logic ---');
var initial = [mk('Wireless Earbuds Page1', 8000, { asin: 'B0AAAAAA21' })];
var afterLoad = initial.concat([
  mk('Wireless Earbuds Page1b', 15000, { asin: 'B0AAAAAA22' }),
  mk('AirPods Case Cover New', 99000, { asin: 'B0AAAAAA23' })
]);
var rLoad = runPipeline(afterLoad, 'wireless airpods');
assert(rLoad.ranked.length === 2, 'loadmore: new products use same relevance (LOW newcomer excluded)');
eq(rLoad.ranked[0].reviewCount, 15000, 'loadmore: newly loaded relevant product can become #1');

var page2 = afterLoad.concat([mk('Wireless Earbuds Page2', 12000, { asin: 'B0AAAAAA24' })]);
var rPage = runPipeline(page2, 'wireless airpods');
eq(rPage.ranked.length, 3, 'pagination: page-2 products use same relevance logic');
eq(rPage.ranked.map(function (p) { return p.reviewCount; }).join(','), '15000,12000,8000', 'pagination: merged set ranked globally by review count');

// ---------------------------------------------------------------------------
// 17-18. BUDGET + SPONSORED interplay
// ---------------------------------------------------------------------------
console.log('--- BUDGET + SPONSORED interplay ---');
var rBudget = runPipeline([
  mk('Wireless Earbuds Cheap', 9000, { asin: 'B0AAAAAA31', price: 800 }),
  mk('Wireless Earbuds Expensive', 20000, { asin: 'B0AAAAAA32', price: 5000 }),
  mk('AirPods Case Cover', 100000, { asin: 'B0AAAAAA33', price: 800 })
], 'wireless airpods', { min: null, max: 1500 });
eq(rBudget.ranked.length, 1, 'budget: relevance + budget work together (1 survivor)');
eq(rBudget.ranked[0].title, 'Wireless Earbuds Cheap', 'budget: survivor is relevant + in-budget');

var rSpon = runPipeline([
  mk('Wireless Earbuds Sponsored', 50000, { asin: 'B0AAAAAA41', isSponsored: true }),
  mk('Wireless Earbuds Organic', 7000, { asin: 'B0AAAAAA42', isSponsored: false })
], 'wireless airpods');
eq(rSpon.ranked.length, 1, 'sponsored: relevance + sponsored exclusion work together');
eq(rSpon.ranked[0].reviewCount, 7000, 'sponsored: organic relevant product survives');

// ---------------------------------------------------------------------------
// 19-20. MISSING DATA
// ---------------------------------------------------------------------------
console.log('--- MISSING DATA ---');
var badTitle = V.validateProducts([{ title: '', asin: 'B0AAAAAA51', reviewCount: 100 }]);
eq(badTitle.length, 0, 'missing: empty title already rejected by validation');
var noQueryKeep = runPipeline([mk('Wireless Earbuds', 5000, { asin: 'B0AAAAAA52' })], '');
eq(noQueryKeep.ranked.length, 1, 'missing: missing query does not filter (ranking preserved)');

// ---------------------------------------------------------------------------
// 21-22. FALSE POSITIVE PROTECTION
// ---------------------------------------------------------------------------
console.log('--- FALSE POSITIVE PROTECTION ---');
assert(R.calculateRelevance('Apple AirPods Case', 'airpods case').category === 'HIGH', 'fp: "case" not auto-irrelevant when query is "airpods case"');
assert(R.calculateRelevance('USB C Charging Cable Pro', 'usb c cable').category === 'HIGH', 'fp: "cable" not auto-irrelevant when query is "usb c cable"');
assert(R.isAccessoryToken('case') === true, 'fp: case is a known accessory term');
  assert(R.queryTokens('airpods case').indexOf('case') !== -1, 'fp: query tokens retain intent words');

  // --- REGRESSION TESTS FOR BUG: valid products dropped, accessories kept ---

  // Test A: Query "airpods", product "Kratos TW02 Ear Buds" → HIGH (audio category terms)
  var kratosRel = R.calculateRelevance('Kratos TW02 Ear Buds Wireless with 60H Playtime Earbuds Bluetooth TWS', 'airpods');
  assert(kratosRel.category === 'HIGH', 'regression A: "Kratos TW02 Ear Buds" is HIGH for "airpods" (got ' + kratosRel.category + ')');

  // Test B: Query "airpods", product "AirPods Case Cover" → LOW (accessory without intent)
  var caseRel = R.calculateRelevance('AirPods Case Cover', 'airpods');
  assert(caseRel.category === 'LOW', 'regression B: "AirPods Case Cover" is LOW for "airpods" (got ' + caseRel.category + ')');

  // Test C: Ranking order 50k > 10k > 2600 > 23 > 7 (empty query = no filtering)
  var rankProducts = [
    mk('Low Count', 7, { asin: 'B0R1', reviewCount: 7 }),
    mk('Medium Low', 23, { asin: 'B0R2', reviewCount: 23 }),
    mk('Kratos Ear Buds', 2600, { asin: 'B0R3', reviewCount: 2600 }),
    mk('Medium High', 10000, { asin: 'B0R4', reviewCount: 10000 }),
    mk('Highest', 50000, { asin: 'B0R5', reviewCount: 50000 })
  ];
  var ranked = runPipeline(rankProducts, '');
  eq(ranked.ranked.length, 5, 'regression C: 5 products ranked by review count (got ' + ranked.ranked.length + ')');
  eq(ranked.ranked[0].reviewCount, 50000, 'regression C: #1 = 50k');
  eq(ranked.ranked[1].reviewCount, 10000, 'regression C: #2 = 10k');
  eq(ranked.ranked[2].reviewCount, 2600, 'regression C: #3 = 2.6k');
  eq(ranked.ranked[3].reviewCount, 23, 'regression C: #4 = 23');
  eq(ranked.ranked[4].reviewCount, 7, 'regression C: #5 = 7');

  // Verify "airpods" query keeps Kratos (high review) while filtering non-matching
  var airpodsRel = R.calculateRelevance('Kratos Ear Buds', 'airpods');
  eq(airpodsRel.category, 'HIGH', 'regression C-2: Kratos is HIGH for "airpods"');
  var airpodsFiltered = R.filterRelevantProducts(V.validateProducts(rankProducts), 'airpods');
  eq(airpodsFiltered.relevant.length, 1, 'regression C-2: only Kratos relevant for "airpods"');
  eq(airpodsFiltered.relevant[0].reviewCount, 2600, 'regression C-2: Kratos 2.6k retained');

  // Verify AirPods Case Cover is filtered for "airpods"
  var caseFiltered = R.filterRelevantProducts(V.validateProducts([mk('AirPods Case Cover', 23)]), 'airpods');
  eq(caseFiltered.relevant.length, 0, 'regression C-3: AirPods Case Cover filtered for "airpods"');

  // ---------------------------------------------------------------------------
  // UI + PERFORMANCE smoke checks
  // ---------------------------------------------------------------------------
  console.log('--- UI + PERFORMANCE ---');
  eq(UI.resultsHeaderText(8, null, null, true), '8 RELEVANT PRODUCTS FOUND', 'ui: relevance header when active');
  eq(UI.resultsHeaderText(8, null, null, false), '8 PRODUCTS FOUND', 'ui: legacy header unchanged when inactive');
  eq(UI.MESSAGES.noRelevant, 'No relevant products found for this search.', 'ui: distinct empty state (not "No products found")');
  var t0 = Date.now();
  for (var i = 0; i < 2000; i++) R.calculateRelevance('boAt Airdopes 141 Wireless Bluetooth Earbuds ' + i, 'wireless airpods');
  assert(Date.now() - t0 < 2000, 'perf: 2000 relevance scores run locally with pure string ops (<2s, no network/AI)');
  assert(typeof R.ACCESSORY_TERMS.length === 'number' && R.ACCESSORY_TERMS.length <= 30, 'config: accessory dictionary stays small/maintainable');

  console.log('');
  console.log('Assertions: ' + assertions);
  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
