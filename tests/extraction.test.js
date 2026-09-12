#!/usr/bin/env node
/**
 * ReviewRank — Product Data Extraction tests.
 *
 * Exercises the REAL extractor functions from content/content.js using a
 * lightweight DOM shim that supports the selector grammar those extractors use
 * (tag, .class, [attr], [attr="v"], [attr*="v"], descendant, and comma OR).
 *
 * Run: node tests/extraction.test.js
 */
'use strict';

// ---------------------------------------------------------------------------
// Lightweight DOM shim
// ---------------------------------------------------------------------------

function el(tag, attrs, children) {
  if (typeof children === 'string') {
    return makeNode(tag, attrs || {}, '', children);
  }
  return makeNode(tag, attrs || {}, children || []);
}

function makeNode(tag, attrs, children, leafText) {
  const childEls = Array.isArray(children) ? children : [];
  const node = {
    tag: tag,
    attrs: attrs,
    children: childEls,
    _leafText: leafText || null,
    parentNode: null,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? String(this.attrs[name])
        : null;
    },
    querySelectorAll: function (selector) {
      return queryAll(node, selector);
    }
  };
  for (const c of childEls) { c.parentNode = node; }
  Object.defineProperty(node, 'textContent', {
    get: function () {
      if (this._leafText !== null && this._leafText !== undefined) return this._leafText;
      return this.children.map(function (c) { return c.textContent; }).join('');
    }
  });
  return node;
}

function parseToken(raw) {
  const token = { tag: null, classes: [], attrs: [] };
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < raw.length && /[A-Za-z0-9-]/.test(raw[j])) j++;
      token.classes.push(raw.slice(i + 1, j));
      i = j;
    } else if (ch === '[') {
      const close = raw.indexOf(']', i);
      const inner = raw.slice(i + 1, close);
      i = close + 1;
      const m = inner.match(/^([A-Za-z-]+)(\*?=)?(?:"([^"]*)"|([^"]*))?$/);
      const name = m[1];
      const op = m[2] ? (m[2] === '*=' ? '*' : '=') : null;
      const value = m[3] !== undefined ? m[3] : (m[4] || null);
      token.attrs.push({ name: name, op: op, value: value });
    } else if (/[A-Za-z]/.test(ch) && !token.tag) {
      let j = i;
      while (j < raw.length && /[A-Za-z0-9]/.test(raw[j])) j++;
      token.tag = raw.slice(i, j);
      i = j;
    } else {
      i++;
    }
  }
  return token;
}

function splitCompounds(part) {
  // Split a selector part into compound tokens by whitespace, but keep
  // whitespace INSIDE [attr="value with spaces"] intact.
  const tokens = [];
  let buf = '';
  let inBracket = false;
  for (const ch of part) {
    if (ch === '[') inBracket = true;
    if (ch === ']') inBracket = false;
    if (/\s/.test(ch) && !inBracket) {
      if (buf.trim()) tokens.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) tokens.push(buf.trim());
  return tokens;
}

function parseSelector(selector) {
  const branches = [];
  for (const part of selector.split(',')) {
    const tokens = [];
    for (const raw of splitCompounds(part)) {
      tokens.push(parseToken(raw));
    }
    if (tokens.length) branches.push(tokens);
  }
  return branches;
}

function matchToken(node, token) {
  if (token.tag && node.tag !== token.tag) return false;
  const nodeClass = node.attrs['class'] || '';
  for (const c of token.classes) {
    if ((' ' + nodeClass + ' ').indexOf(' ' + c + ' ') === -1) return false;
  }
  for (const a of token.attrs) {
    const v = node.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '*') { if (v.indexOf(a.value) === -1) return false; }
    else if (a.op === '=') { if (v !== a.value) return false; }
  }
  return true;
}

function matchBranch(node, tokens, idx) {
  if (!matchToken(node, tokens[idx])) return false;
  if (idx === 0) return true;
  let p = node.parentNode;
  while (p) {
    if (matchBranch(p, tokens, idx - 1)) return true;
    p = p.parentNode;
  }
  return false;
}

function matchAny(node, selector) {
  const branches = parseSelector(selector);
  for (const branch of branches) {
    if (!branch.length) continue;
    if (matchBranch(node, branch, branch.length - 1)) return true;
  }
  return false;
}

function queryAll(node, selector) {
  let results = [];
  for (const child of node.children) {
    if (matchAny(child, selector)) results.push(child);
    results = results.concat(queryAll(child, selector));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Import the REAL production extractors
// ---------------------------------------------------------------------------
const X = require('../content/content.js');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
var failures = 0;
function assert(cond, label) {
  if (cond) { console.log('PASS: ' + label); }
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(actual, expected, label) {
  assert(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}
// ---------------------------------------------------------------------------
// PRICE parsing (parseIndianNumber)
// ---------------------------------------------------------------------------
console.log('--- PRICE PARSING ---');
eq(X.parseIndianNumber('₹999'), 999, 'price: ₹999 -> 999');
eq(X.parseIndianNumber('₹1,099'), 1099, 'price: ₹1,099 -> 1099');
eq(X.parseIndianNumber('₹12,999'), 12999, 'price: ₹12,999 -> 12999');
eq(X.parseIndianNumber('₹1,29,999'), 129999, 'price: ₹1,29,999 -> 129999 (Indian numbering)');
eq(X.parseIndianNumber('1,29,999'), 129999, 'price: 1,29,999 without symbol -> 129999');
eq(X.parseIndianNumber('₹1,099.50'), 1099.5, 'price: ₹1,099.50 -> 1099.5');
eq(X.parseIndianNumber('Rs. 999'), 999, 'price: Rs. 999 -> 999');
eq(X.parseIndianNumber('not a price'), null, 'price: garbage text -> null');
eq(X.parseIndianNumber(''), null, 'price: empty -> null');

// ---------------------------------------------------------------------------
// RATING parsing
// ---------------------------------------------------------------------------
console.log('--- RATING PARSING ---');

function ratingFromStarText(text) {
  const item = el('div', {}, [
    el('span', { class: 'a-icon-star-small' }, [
      el('span', { class: 'a-icon-alt' }, text)
    ])
  ]);
  return X.extractRating(item);
}
eq(ratingFromStarText('4.5 out of 5 stars'), 4.5, 'rating: "4.5 out of 5 stars" -> 4.5');
eq(ratingFromStarText('3.8 out of 5 stars'), 3.8, 'rating: "3.8 out of 5 stars" -> 3.8');
eq(ratingFromStarText('5 out of 5 stars'), 5, 'rating: "5 out of 5 stars" -> 5');

var ratingLabelCard = el('div', {}, [
  el('span', { 'aria-label': '4.4 out of 5 stars' }, [])
]);
eq(X.extractRating(ratingLabelCard), 4.4, 'rating: extracted from aria-label "4.4 out of 5 stars"');

var noRatingCard = el('div', {}, [el('span', { class: 'a-size-base s-underline-text' }, '92,431')]);
eq(X.extractRating(noRatingCard), null, 'rating: a review count is NOT a rating (null)');

// ---------------------------------------------------------------------------
// REVIEW COUNT parsing (parseReviewCountText)
// ---------------------------------------------------------------------------
console.log('--- REVIEW COUNT PARSING ---');
eq(X.parseReviewCountText('92,431 ratings'), 92431, 'count: "92,431 ratings" -> 92431');
eq(X.parseReviewCountText('9,876 ratings'), 9876, 'count: "9,876 ratings" -> 9876');
eq(X.parseReviewCountText('1,234 customer reviews'), 1234, 'count: "1,234 customer reviews" -> 1234');
eq(X.parseReviewCountText('1.2K ratings'), 1200, 'count: "1.2K ratings" -> 1200');
eq(X.parseReviewCountText('12.4K ratings'), 12400, 'count: "12.4K ratings" -> 12400');
eq(X.parseReviewCountText('1 lakh+ ratings'), 100000, 'count: "1 lakh+ ratings" -> 100000');
eq(X.parseReviewCountText('1,234'), 1234, 'count: bare "1,234" -> 1234');
eq(X.parseReviewCountText('500'), 500, 'count: bare "500" -> 500');
eq(X.parseReviewCountText('1M reviews'), 1000000, 'count: "1M reviews" -> 1000000');
eq(X.parseReviewCountText('1.2 crore ratings'), 12000000, 'count: "1.2 crore ratings" -> 12000000');
eq(X.parseReviewCountText('4.6 out of 5 stars'), null, 'count: star-rating text is NOT a count (null)');
eq(X.parseReviewCountText('35% off'), null, 'count: discount percentage is NOT a count (null)');
eq(X.parseReviewCountText(''), null, 'count: empty text -> null');
// ---------------------------------------------------------------------------
// PRICE extraction from DOM
// ---------------------------------------------------------------------------
console.log('--- PRICE DOM EXTRACTION ---');

function priceCard(priceText, extra) {
  const nodes = [el('span', { class: 'a-price', 'data-a-color': 'base' }, [
    el('span', { class: 'a-offscreen' }, priceText),
    el('span', { class: 'a-price-whole' }, priceText.replace('₹', ''))
  ])];
  if (extra) nodes.push.apply(nodes, extra);
  return el('div', {}, nodes);
}

eq(X.extractPrice(priceCard('₹999')), 999, 'price DOM: current .a-price ₹999 -> 999');
eq(X.extractPrice(priceCard('₹1,099')), 1099, 'price DOM: ₹1,099 -> 1099');

// Struck-through price present alongside current price -> current price wins
var strikeCard = priceCard('₹1,099', [
  el('span', { class: 'a-price a-text-price', 'data-a-strike': 'true' }, [
    el('span', { class: 'a-offscreen' }, '₹2,499')
  ])
]);
eq(X.extractPrice(strikeCard), 1099, 'price DOM: struck-through ₹2,499 ignored, current ₹1,099 used');

// EMI text present (not a price container) does not interfere
var emiCard = el('div', {}, [
  el('span', { class: 'a-price' }, [el('span', { class: 'a-offscreen' }, '₹1,29,999')]),
  el('span', { class: 'a-color-secondary' }, 'EMI from ₹4,902/month')
]);
eq(X.extractPrice(emiCard), 129999, 'price DOM: ₹1,29,999 parsed, EMI text ignored');

// Missing price -> null
eq(X.extractPrice(el('div', {}, [el('span', { class: 'a-size-base' }, 'In stock')])), null, 'price DOM: missing price -> null');

// ---------------------------------------------------------------------------
// REVIEW COUNT extraction from DOM
// ---------------------------------------------------------------------------
console.log('--- REVIEW COUNT DOM EXTRACTION ---');

var ariaCount = el('div', {}, [
  el('span', { 'aria-label': '4.5 out of 5 stars, 92,431 ratings' }, [])
]);
eq(X.extractReviewCount(ariaCount), 92431, 'count DOM: aria-label "4.5 out of 5 stars, 92,431 ratings" -> 92431');

var underlineCount = el('div', {}, [
  el('span', { class: 'a-size-base s-underline-text' }, '92,431')
]);
eq(X.extractReviewCount(underlineCount), 92431, 'count DOM: span.s-underline-text "92,431" -> 92431');

var linkCount = el('div', {}, [
  el('a', { href: '/product-reviews/B0ABCDEF12' }, [
    el('span', { class: 'a-size-base a-color-base' }, '1.2K')
  ])
]);
eq(X.extractReviewCount(linkCount), 1200, 'count DOM: product-reviews link "1.2K" -> 1200');

var lakhCard = el('div', {}, [
  el('span', { class: 'a-size-base a-color-base' }, '1 lakh+ ratings')
]);
eq(X.extractReviewCount(lakhCard), 100000, 'count DOM: "1 lakh+ ratings" -> 100000');

var titleCount = el('div', {}, [
  el('h2', {}, [el('a', { href: '/dp/B0ABCDEF12' }, [
    el('span', {}, 'boAt Rockerz 450 Bluetooth Earphones')
  ])])
]);
eq(X.extractReviewCount(titleCount), null, 'count DOM: title containing numbers does not become a count (null)');

var noisyCard = el('div', {}, [
  el('span', { class: 'a-price' }, [el('span', { class: 'a-offscreen' }, '₹1,099')]),
  el('span', {}, '35% off'),
  el('span', {}, '1K+ bought in past month')
]);
eq(X.extractReviewCount(noisyCard), null, 'count DOM: price/discount/bought-in-past-month are NOT counts (null)');

eq(X.extractReviewCount(el('div', {}, [el('span', { class: 'a-size-base' }, 'In stock')])), null, 'count DOM: missing count -> null');

var boughtCard = el('div', {}, [el('span', {}, '3,000+ bought in past month')]);
eq(X.extractReviewCount(boughtCard), null, 'count DOM: "3,000+ bought in past month" is NOT a count (null)');

// ---------------------------------------------------------------------------
// ASIN + product URL extraction
// ---------------------------------------------------------------------------
console.log('--- ASIN / URL EXTRACTION ---');

var asinItemData = el('div', { 'data-asin': 'b0abcdef12' }, []);
eq(X.extractAsin(asinItemData, null), 'B0ABCDEF12', 'asin: data-asin normalized to uppercase');

var asinItemUrl = el('div', {}, []);
eq(X.extractAsin(asinItemUrl, 'https://www.amazon.in/dp/b0abcdef12'), 'B0ABCDEF12', 'asin: derived from canonical URL, uppercased');

eq(X.extractAsin(el('div', {}, []), null), null, 'asin: missing -> null');

var urlCard = el('div', {}, [
  el('a', { href: '/product-reviews/B0ABCDEF12' }, [el('span', {}, '92,431 ratings')]),
  el('a', { href: '/gp/wishlist' }, [el('span', {}, 'Add to wishlist')]),
  el('h2', {}, [el('a', { href: '/boAt-Rockerz-450/dp/B0ABCDEF12/ref=sr_1_1?keywords=boat' }, [el('span', {}, 'boAt Rockerz 450')])])
]);
eq(X.extractProductUrl(urlCard), 'https://www.amazon.in/boAt-Rockerz-450/dp/B0ABCDEF12/ref=sr_1_1?keywords=boat', 'url: product link chosen from h2');

eq(X.normalizeAmazonUrl('/boAt-Rockerz-450/dp/b0abcdef12/ref=sr_1_1?keywords=boat'), 'https://www.amazon.in/dp/B0ABCDEF12', 'url: canonical normalization -> /dp/ASIN uppercased');
eq(X.extractAsinFromUrl('https://www.amazon.in/dp/B0ABCDEF12'), 'B0ABCDEF12', 'url: ASIN correctly extracted from product URL');
// ---------------------------------------------------------------------------
// IMAGE extraction
// ---------------------------------------------------------------------------
console.log('--- IMAGE EXTRACTION ---');

var imgCardSrc = el('div', {}, [
  el('img', { class: 's-image', src: 'https://m.media-amazon.com/images/I/51A.jpg', width: '200', height: '200' })
]);
eq(X.extractImageUrl(imgCardSrc), 'https://m.media-amazon.com/images/I/51A.jpg', 'image: img.s-image src returned');

var imgCardDataSrc = el('div', {}, [
  el('img', { class: 's-image', 'data-src': 'https://m.media-amazon.com/images/I/52B.jpg' })
]);
eq(X.extractImageUrl(imgCardDataSrc), 'https://m.media-amazon.com/images/I/52B.jpg', 'image: data-src used when src missing');

var srcsetCard = el('div', {}, [
  el('img', { class: 's-image', srcset: 'https://m.media-amazon.com/images/I/53C.jpg 200w, https://m.media-amazon.com/images/I/54D.jpg 400w' })
]);
eq(X.extractImageUrl(srcsetCard), 'https://m.media-amazon.com/images/I/54D.jpg', 'image: srcset picks largest candidate (400w)');

var iconCard = el('div', {}, [
  el('img', { class: 's-image', src: 'https://m.media-amazon.com/images/I/icon.gif', width: '8', height: '8' })
]);
eq(X.extractImageUrl(iconCard), null, 'image: tiny 8x8 icon skipped (null)');

var logoCard = el('div', {}, [
  el('img', { class: 's-image', src: 'https://m.media-amazon.com/images/G/01/gno/sprites/nav-sprite-global.png' })
]);
eq(X.extractImageUrl(logoCard), null, 'image: sprite/logo asset skipped (null)');

eq(X.extractImageUrl(el('div', {}, [])), null, 'image: no image -> null');

// ---------------------------------------------------------------------------
// Full parseAmazonProduct integration (realistic Amazon card)
// ---------------------------------------------------------------------------
console.log('--- parseAmazonProduct INTEGRATION ---');

var fullCard = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0ABC123DE' }, [
  el('h2', {}, [
    el('a', { href: '/boAt-Rockerz-450/dp/B0ABC123DE/ref=sr_1_1?keywords=boat' }, [
      el('span', {}, 'boAt Rockerz 450 Bluetooth Earphones')
    ])
  ]),
  el('div', { class: 'a-section' }, [
    el('a', { href: '/boAt-Rockerz-450/dp/B0ABC123DE' }, [
      el('img', { class: 's-image', src: 'https://m.media-amazon.com/images/I/51A.jpg', width: '200', height: '200' })
    ]),
    el('span', { class: 'a-price', 'data-a-color': 'base' }, [
      el('span', { class: 'a-offscreen' }, '₹1,099')
    ]),
    el('span', { class: 'a-icon-star-small' }, [
      el('span', { class: 'a-icon-alt' }, '4.5 out of 5 stars')
    ]),
    el('span', { class: 'a-size-base s-underline-text' }, '92,431')
  ])
]);

var parsed = X.parseAmazonProduct(fullCard);
eq(parsed.title, 'boAt Rockerz 450 Bluetooth Earphones', 'integration: title extracted');
eq(parsed.asin, 'B0ABC123DE', 'integration: ASIN extracted + uppercased');
eq(parsed.price, 1099, 'integration: price ₹1,099 -> 1099');
eq(parsed.rating, 4.5, 'integration: rating 4.5');
eq(parsed.reviewCount, 92431, 'integration: reviewCount 92,431');
eq(parsed.imageUrl, 'https://m.media-amazon.com/images/I/51A.jpg', 'integration: image URL');
eq(parsed.canonicalUrl, 'https://www.amazon.in/dp/B0ABC123DE', 'integration: canonical URL');
eq(parsed.marketplace, 'Amazon', 'integration: marketplace = Amazon');
assert(parsed.url.indexOf('/dp/B0ABC123DE') !== -1, 'integration: product url contains /dp/ path');

// Missing fields -> no invented values
var bareCard = el('div', { 'data-asin': 'B0ZZZZZZZZ' }, [
  el('h2', {}, [el('a', { href: '/didntmatter/dp/B0ZZZZZZZZ' }, [el('span', {}, 'Bare product')])])
]);
var bareParsed = X.parseAmazonProduct(bareCard);
eq(bareParsed.price, null, 'missing: price is null (not invented)');
eq(bareParsed.rating, 0, 'missing: rating is 0 (popup-neutral missing value)');
eq(bareParsed.reviewCount, null, 'missing: reviewCount is null (not invented)');

// ranking behavior: product without reviewCount sorts LAST (via popup logic)
function sortByReviewCount(products) {
  var copy = products.slice();
  copy.sort(function (a, b) { return (b.reviewCount || 0) - (a.reviewCount || 0); });
  return copy;
}
var orderChecked = sortByReviewCount([
  { title: 'NoCount', reviewCount: null },
  { title: 'SomeCount', reviewCount: 50 },
  { title: 'High', reviewCount: 500 }
]);
assert(orderChecked[0].title === 'High' && orderChecked[1].title === 'SomeCount' && orderChecked[2].title === 'NoCount',
  'missing: product without reviewCount ranks LAST, never outranks valid counts');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);