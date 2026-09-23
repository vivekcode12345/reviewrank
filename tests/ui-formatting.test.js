#!/usr/bin/env node
/**
 * ReviewRank — Ranking & Result Quality UI tests.
 *
 * Tests the pure display helpers in lib/display.js (used by popup.js):
 * price/count formatting, results header text, card HTML, empty states,
 * and error sanitization.
 *
 * Run: node tests/ui-formatting.test.js
 */
'use strict';

const UI = require('../lib/display.js');

var failures = 0;
function assert(cond, label) {
  if (cond) { console.log('PASS: ' + label); }
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(actual, expected, label) {
  assert(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

// ---------------------------------------------------------------------------
// Price formatting (Indian format)
// ---------------------------------------------------------------------------
console.log('--- PRICE FORMATTING ---');
eq(UI.formatINR(999), '₹999', 'price: 999 -> ₹999');
eq(UI.formatINR(1099), '₹1,099', 'price: 1099 -> ₹1,099');
eq(UI.formatINR(129999), '₹1,29,999', 'price: 129999 -> ₹1,29,999 (Indian grouping)');
eq(UI.formatINR(92431), '₹92,431', 'price: 92431 -> ₹92,431');
eq(UI.formatINR(null), null, 'price: null -> null (no ₹null)');
eq(UI.formatINR(undefined), null, 'price: undefined -> null');
eq(UI.formatPriceText({ price: 1099 }), '₹1,099', 'priceText: from product object');
eq(UI.formatPriceText({ price: null }), null, 'priceText: missing price -> null (field hidden/muted)');

// ---------------------------------------------------------------------------
// Review count + rating display (exact counts, correct terminology)
// ---------------------------------------------------------------------------
console.log('--- RATING COUNT FORMATTING ---');
eq(UI.formatRatingCountText({ reviewCount: 24532 }), '24,532 customer ratings', 'count: 24532 -> "24,532 customer ratings"');
eq(UI.formatRatingCountText({ reviewCount: 92431 }), '92,431 customer ratings', 'count: 92431 exact (no 92.4K abbreviation)');
eq(UI.formatRatingCountText({ reviewCount: 1200 }), '1,200 customer ratings', 'count: 1200 -> "1,200"');
eq(UI.formatRatingCountText({ reviewCount: 12400 }), '12,400 customer ratings', 'count: 12400 -> "12,400"');
eq(UI.formatRatingCountText({ reviewCount: 1234, countType: 'reviews' }), '1,234 customer reviews', 'count: written-reviews wording adapts');
eq(UI.formatRatingCountText({ reviewCount: 0 }), null, 'count: 0 -> null (never "0 ratings")');
eq(UI.formatRatingCountText({ reviewCount: null }), null, 'count: null -> null (never "null")');

console.log('--- AVERAGE RATING FORMATTING ---');
eq(UI.formatRatingText({ rating: 4.1 }), '4.1 average rating', 'rating: 4.1 -> "4.1 average rating"');
eq(UI.formatRatingText({ rating: 3.8 }), '3.8 average rating', 'rating: 3.8');
eq(UI.formatRatingText({ rating: 0 }), null, 'rating: 0 -> null (never renders "0")');
eq(UI.formatRatingText({ rating: null }), null, 'rating: null -> null (field hidden)');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Product card HTML
// ---------------------------------------------------------------------------
console.log('--- PRODUCT CARD HTML ---');

var sample = {
  title: 'boAt Rockerz 450 Bluetooth Headphones',
  price: 1299,
  rating: 4.1,
  reviewCount: 24532,
  imageUrl: 'https://m.media-amazon.com/images/I/51A.jpg',
  url: 'https://www.amazon.in/dp/B0ABC123DE',
  marketplace: 'Amazon'
};

var html = UI.buildProductCardHTML(sample, 1);

// Rank prominent
assert(html.indexOf('>#1<') !== -1 || html.indexOf('#1') !== -1, 'card: rank #1 rendered');
assert(html.indexOf('rank-badge') !== -1, 'card: rank badge present');

// Title
assert(html.indexOf('boAt Rockerz 450 Bluetooth Headphones') !== -1, 'card: product title rendered');

// Price
assert(html.indexOf('₹1,299') !== -1, 'card: price ₹1,299 rendered');

// Review count (prominent, correct wording, exact)
assert(html.indexOf('24,532 customer ratings') !== -1, 'card: "24,532 customer ratings" rendered');

// Average rating (secondary)
assert(html.indexOf('4.1 average rating') !== -1, 'card: "4.1 average rating" rendered');

// Image with meaningful alt text
assert(html.indexOf('<img src="https://m.media-amazon.com/images/I/51A.jpg"') !== -1, 'card: image tag with product image URL');
assert(html.indexOf('alt="boAt Rockerz 450 Bluetooth Headphones"') !== -1, 'card: image alt = product title');

// View on {site} uses the product's own URL, opens new tab
assert(html.indexOf('View on Amazon') !== -1, 'card: "View on Amazon" button present for Amazon product');
assert(html.indexOf('href="https://www.amazon.in/dp/B0ABC123DE"') !== -1, 'card: link uses product URL (not fake URL)');
assert(html.indexOf('target="_blank"') !== -1, 'card: link opens in new tab');

// Multi-site button text
assert(UI.buildProductCardHTML({ title: 'T', url: 'https://www.flipkart.com/p/itm123', source: 'Flipkart' }, 1).indexOf('View on Flipkart') !== -1,
  'card: Flipkart product shows "View on Flipkart"');
assert(UI.buildProductCardHTML({ title: 'T', url: 'https://www.meesho.com/p/abc', source: 'Meesho' }, 1).indexOf('View on Meesho') !== -1,
  'card: Meesho product shows "View on Meesho"');
assert(UI.buildProductCardHTML({ title: 'T', url: 'https://www.myntra.com/p/xyz', source: 'Myntra' }, 1).indexOf('View on Myntra') !== -1,
  'card: Myntra product shows "View on Myntra"');
// Missing source falls back to Amazon
assert(UI.buildProductCardHTML({ title: 'T', url: 'https://www.amazon.in/dp/B0ABC123DE' }, 1).indexOf('View on Amazon') !== -1,
  'card: missing source falls back to "View on Amazon"');

// Rank numbering contiguous across a list
var ranksOk = true;
for (var r = 1; r <= 8; r++) {
  var cardHtml = UI.buildProductCardHTML(sample, r);
  if (cardHtml.indexOf('#' + r) === -1) ranksOk = false;
}
assert(ranksOk, 'card: ranks #1..#8 render with no gaps');

// No sales / purchase claims anywhere
var claimsOk = ['bought this', 'sales', 'purchased', 'people bought'].every(function (phrase) {
  return html.toLowerCase().indexOf(phrase) === -1;
});
assert(claimsOk, 'card: no "bought/sales/purchased" claims (popularity wording only)');

// Escape injection: title with HTML is escaped
var xssHtml = UI.buildProductCardHTML({ title: '<script>alert(1)</script>', url: 'https://www.amazon.in/dp/B0X1', reviewCount: 5 }, 2);
assert(xssHtml.indexOf('<script>') === -1, 'card: title HTML is escaped (XSS-safe)');

// ---------------------------------------------------------------------------
// Missing data rendering
// ---------------------------------------------------------------------------
console.log('--- MISSING DATA RENDERING ---');

var noPrice = UI.buildProductCardHTML({ title: 'T', rating: 4, reviewCount: 100, url: 'u' }, 1);
assert(noPrice.indexOf('Price unavailable') !== -1, 'missing price: neutral "Price unavailable" shown');
assert(noPrice.indexOf('₹null') === -1 && noPrice.indexOf('₹undefined') === -1, 'missing price: never "₹null"/"₹undefined"');

var noRating = UI.buildProductCardHTML({ title: 'T', price: 100, reviewCount: 100, url: 'u' }, 1);
assert(noRating.indexOf('average rating') === -1, 'missing rating: no rating block rendered (never "0")');
assert(noRating.indexOf('NaN') === -1, 'missing rating: never "NaN"');

var noCount = UI.buildProductCardHTML({ title: 'T', price: 100, rating: 4, url: 'u' }, 1);
assert(noCount.indexOf('Review count unavailable') !== -1, 'missing count: neutral "Review count unavailable" shown');
assert(noCount.indexOf('0 ratings') === -1 && noCount.indexOf('null') === -1, 'missing count: never "0 ratings"/"null"');

var noImage = UI.buildProductCardHTML({ title: 'T', price: 100, rating: 4, reviewCount: 100, url: 'u' }, 1);
assert(noImage.indexOf('<img') === -1, 'missing image: no broken <img> tag');
assert(noImage.indexOf('product-image-empty') !== -1, 'missing image: placeholder box used');

var noUrl = UI.buildProductCardHTML({ title: 'T', price: 100, rating: 4, reviewCount: 100 }, 1);
assert(noUrl.indexOf('View on Amazon') === -1, 'missing URL: no fake/empty Amazon link rendered');
assert(noUrl.indexOf('View on Flipkart') === -1, 'missing URL: no fake/empty Flipkart link rendered');
assert(noUrl.indexOf('View on Meesho') === -1, 'missing URL: no fake/empty Meesho link rendered');
assert(noUrl.indexOf('View on Myntra') === -1, 'missing URL: no fake/empty Myntra link rendered');

// ---------------------------------------------------------------------------
// Empty states + error sanitization
// ---------------------------------------------------------------------------
console.log('--- EMPTY STATES / ERROR SANITIZATION ---');
eq(UI.MESSAGES.noProducts, 'No products found on this page.', 'empty: no products message');
eq(UI.MESSAGES.budgetNoMatch, 'No products found within your budget.', 'empty: budget no-match message');
eq(UI.MESSAGES.allSponsored, 'No non-sponsored products found.', 'empty: all-sponsored message');

eq(UI.friendlyErrorMessage('Cannot read properties of undefined (reading "x")'), UI.MESSAGES.genericError,
  'sanitize: raw JS TypeError replaced with generic message');
eq(UI.friendlyErrorMessage('No products found on this page.'), 'No products found on this page.',
  'sanitize: known message passes through');
eq(UI.friendlyErrorMessage(undefined), UI.MESSAGES.genericError, 'sanitize: undefined error -> generic message');
eq(UI.friendlyErrorMessage({ code: -32000 }), UI.MESSAGES.genericError, 'sanitize: non-string error -> generic message');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
// Results header text
// ---------------------------------------------------------------------------
console.log('--- RESULTS HEADER ---');
eq(UI.resultsHeaderText(8, null, null), '8 PRODUCTS FOUND', 'header: no budget -> "8 PRODUCTS FOUND"');
eq(UI.resultsHeaderText(1, null, null), '1 PRODUCT FOUND', 'header: singular -> "1 PRODUCT FOUND"');
eq(UI.resultsHeaderText(8, 600, 1500), '8 PRODUCTS IN ₹600 – ₹1,500', 'header: budget -> "8 PRODUCTS IN ₹600 – ₹1,500"');
eq(UI.resultsHeaderText(3, null, 1500), '3 PRODUCTS IN under ₹1,500', 'header: max only');
eq(UI.resultsHeaderText(0, null, null), '0 PRODUCTS FOUND', 'header: zero count');
eq(UI.RESULTS_SUBTEXT, 'RANKED BY CUSTOMER RATING COUNT', 'header: subtext "RANKED BY CUSTOMER RATING COUNT"');
eq(UI.RANKED_BY_NOTE, 'Ranked by customer rating volume', 'note: ranked-by line present');
assert(UI.POPULARITY_DISCLAIMER.indexOf('popularity indicator') !== -1 && UI.POPULARITY_DISCLAIMER.indexOf('verified sales') !== -1,
  'disclaimer: mentions popularity indicator + not verified sales');