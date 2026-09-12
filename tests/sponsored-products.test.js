#!/usr/bin/env node
/**
 * ReviewRank — Sponsored Product Handling tests.
 *
 * Tests detectSponsored() from content/content.js (via a lightweight DOM shim)
 * and the pipeline functions from popup/popup.js (mirrored here so the pure
 * logic can run outside the browser).
 *
 * Run: node tests/sponsored-products.test.js
 */
'use strict';

// ---------------------------------------------------------------------------
// Lightweight DOM shim — supports exactly the selector subset used by
// detectSponsored() so the REAL production function can be exercised in Node.
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
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
        ? String(this.attrs[name])
        : null;
    },
    querySelectorAll: function (selector) {
      return queryAll(node, selector);
    }
  };
  Object.defineProperty(node, 'textContent', {
    get: function () {
      if (this._leafText !== null && this._leafText !== undefined) return this._leafText;
      return this.children.map(function (c) { return c.textContent; }).join('');
    }
  });
  return node;
}

function matches(elNode, selector) {
  selector = selector.trim();
  if (selector.indexOf(',') !== -1) {
    return selector.split(',').some(function (s) { return matches(elNode, s); });
  }
  let m = selector.match(/^\[([a-zA-Z-]+)="([^"]*)"\]$/);
  if (m) return elNode.getAttribute(m[1]) === m[2];
  m = selector.match(/^\[([a-zA-Z-]+)\]$/);
  if (m) return elNode.getAttribute(m[1]) !== null;
  if (/^[a-z]+$/.test(selector)) return elNode.tag === selector;
  if (selector.charAt(0) === '.') {
    const classes = selector.split('.').filter(Boolean);
    const elClass = elNode.attrs['class'] || '';
    return classes.every(function (c) {
      return (' ' + elClass + ' ').indexOf(' ' + c + ' ') !== -1;
    });
  }
  return false;
}

function queryAll(elNode, selector) {
  let results = [];
  if (matches(elNode, selector)) results.push(elNode);
  for (const child of elNode.children) {
    results = results.concat(queryAll(child, selector));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Import the REAL production detection logic
// ---------------------------------------------------------------------------
const { detectSponsored } = require('../content/content.js');

// ---------------------------------------------------------------------------
// Mirrors of the pure pipeline functions from popup/popup.js.
// Kept identical to the production implementations.
// ---------------------------------------------------------------------------

function deduplicateProducts(products) {
  var seen = {};
  var order = [];
  for (var i = 0; i < products.length; i++) {
    var product = products[i];
    var key = getProductKey(product, i);
    if (seen.hasOwnProperty(key)) {
      var best = mergeProductRecords(seen[key], product);
      seen[key] = best;
    } else {
      seen[key] = product;
      order.push(key);
    }
  }
  var result = [];
  for (var j = 0; j < order.length; j++) {
    result.push(seen[order[j]]);
  }
  return result;
}

function getProductKey(product, index) {
  if (product.asin) return 'asin:' + product.asin;
  if (product.canonicalUrl) return 'url:' + product.canonicalUrl;
  return 'fallback:' + index;
}

function mergeProductRecords(existing, incoming) {
  // Sponsored occurrence must never override the organic occurrence.
  if (!existing.isSponsored && incoming.isSponsored) return existing;
  if (existing.isSponsored && !incoming.isSponsored) return incoming;
  var scoreA = recordCompleteness(existing);
  var scoreB = recordCompleteness(incoming);
  return scoreB > scoreA ? incoming : existing;
}

function recordCompleteness(product) {
  var score = 0;
  if (product.title) score += 1;
  if (product.price != null && product.price > 0) score += 2;
  if (product.rating > 0) score += 1;
  if (product.reviewCount > 0) score += 3;
  if (product.imageUrl) score += 1;
  return score;
}

function filterByPriceRange(products, minPrice, maxPrice) {
  if (minPrice === null && maxPrice === null) return products;
  var result = [];
  for (var i = 0; i < products.length; i++) {
    var product = products[i];
    if (product.price == null || product.price === 0) continue;
    if (minPrice !== null && product.price < minPrice) continue;
    if (maxPrice !== null && product.price > maxPrice) continue;
    result.push(product);
  }
  return result;
}

function excludeSponsoredProducts(products) {
  var result = [];
  for (var i = 0; i < products.length; i++) {
    if (!products[i].isSponsored) result.push(products[i]);
  }
  return result;
}

function sortByReviewCount(products) {
  var copy = products.slice();
  copy.sort(function (a, b) { return (b.reviewCount || 0) - (a.reviewCount || 0); });
  return copy;
}

// Full production pipeline order: dedup -> budget filter -> exclude sponsored -> sort
function pipeline(products, minPrice, maxPrice) {
  var unique = deduplicateProducts(products);
  var filtered = filterByPriceRange(unique, minPrice, maxPrice);
  var organic = excludeSponsoredProducts(filtered);
  return sortByReviewCount(organic);
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
var failures = 0;
// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

// --- detectSponsored(): sponsored detection ---
// Strategy 1: root data-component-type="sp-sponsored-result"
var s1 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0SPON1' }, [
  el('h2', {}, [
    el('a', { href: '/dp/B0SPON1' }, [
      el('span', {}, 'Sponsored Wireless Earbuds')
    ])
  ])
]);
assert(detectSponsored(s1) === false, 'detectSponsored: root s-search-result without marker is NOT sponsored');

// Root with sp-sponsored-result -> sponsored
var s2 = el('div', { 'data-component-type': 'sp-sponsored-result', 'data-asin': 'B0SPON2' }, [
  el('h2', {}, [el('a', { href: '/dp/B0SPON2' }, [el('span', {}, 'Ad Product')])])
]);
assert(detectSponsored(s2) === true, 'detectSponsored: root data-component-type=sp-sponsored-result detected');

// Strategy 2: descendant with modern puis-sponsored-label-text class + "Sponsored" text
var s3 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0SPON3' }, [
  el('div', { 'class': 'a-section a-spacing-small puis-sponsored-label-txt' }, [
    el('span', { 'class': 'puis-sponsored-label-text' }, 'Sponsored')
  ]),
  el('h2', {}, [el('a', { href: '/dp/B0SPON3' }, [el('span', {}, 'Product')])])
]);
assert(detectSponsored(s3) === true, 'detectSponsored: modern puis-sponsored-label-text detected');

// Strategy 2 legacy: s-sponsored-label-text
var s4 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0SPON4' }, [
  el('div', { 'class': 'a-row' }, [
    el('span', { 'class': 'a-size-base s-sponsored-label-text' }, 'Sponsored')
  ]),
  el('h2', {}, [el('a', { href: '/dp/B0SPON4' }, [el('span', {}, 'Legacy Product')])])
]);
assert(detectSponsored(s4) === true, 'detectSponsored: legacy s-sponsored-label-text detected');

// Strategy 4: aria-label "Sponsored product information" on info icon
var s5 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0SPON5' }, [
  el('a', { 'class': 's-sponsored-label-info-icon', 'aria-label': 'Sponsored product information', title: 'Sponsored product information' }, []),
  el('h2', {}, [el('a', { href: '/dp/B0SPON5' }, [el('span', {}, 'Product 5')])])
]);
assert(detectSponsored(s5) === true, 'detectSponsored: aria-label/title "Sponsored product information" detected');

// Full modern Amazon card with heading-less sponsored label (standalone "Sponsored" leaf text)
var s6 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0SPON6' }, [
  el('span', { 'class': 's-sponsored-label-text' }, 'Sponsored'),
  el('h2', {}, [el('a', { href: '/dp/B0SPON6' }, [el('span', {}, 'Product 6')])])
]);
assert(detectSponsored(s6) === true, 'detectSponsored: standalone "Sponsored" leaf label detected');

// --- detectSponsored(): organic detection (no false positives) ---
var o1 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0ORG001' }, [
  el('div', { 'class': 'a-section' }, [
    el('span', { 'class': 'a-size-small' }, 'Sponsored Wireless Earbuds') // word inside title, NOT exact label
  ]),
  el('h2', {}, [el('a', { href: '/dp/B0ORG001' }, [el('span', {}, 'Sponsored Wireless Earbuds')])])
]);
assert(detectSponsored(o1) === false, 'detectSponsored: product titled "Sponsored ..." is NOT flagged as a sponsored ad');

var o2 = el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0ORG002' }, [
  el('div', { 'class': 'a-section' }, [
    el('span', { 'class': 'a-size-small' }, ' '
    ),
    el('img', { 'class': 's-image', src: 'http://img' }, []),
    el('h2', {}, [el('a', { href: '/dp/B0ORG002' }, [el('span', {}, 'Plain Organic Product')])])
  ])
]);
assert(detectSponsored(o2) === false, 'detectSponsored: plain organic card NOT sponsored');

// keep results visible
console.log('');
function assert(cond, label) {
  if (cond) { console.log('PASS: ' + label); }
  else { failures++; console.log('FAIL: ' + label); }
}
// --- Pipeline: excludeSponsoredProducts ---
var e1 = [
  { title: 'A', isSponsored: false, price: 100, reviewCount: 10 },
  { title: 'B', isSponsored: true, price: 200, reviewCount: 99999 },
  { title: 'C', isSponsored: false, price: 300, reviewCount: 20 }
];
var outE1 = excludeSponsoredProducts(e1);
assert(outE1.length === 2, 'pipeline: sponsored products excluded (got ' + outE1.length + ')');
assert(outE1[0].title === 'A' && outE1[1].title === 'C', 'pipeline: organic products preserved');

// --- Pipeline: sponsored + organic duplicate keeps organic ---
var d1 = [
  { title: 'Watch', asin: 'B0WATCH1', canonicalUrl: 'u1', isSponsored: true, price: 3000, reviewCount: 50000, rating: 4.5, imageUrl: 'http://img' },
  { title: 'Watch', asin: 'B0WATCH1', canonicalUrl: 'u1', isSponsored: false, price: 2999, reviewCount: 40000, rating: 4.3, imageUrl: null }
];
var dedup1 = deduplicateProducts(d1);
assert(dedup1.length === 1, 'pipeline: sponsored+organic duplicate merged to 1 (got ' + dedup1.length + ')');
assert(dedup1[0].isSponsored === false, 'pipeline: organic occurrence wins over sponsored duplicate');
assert(dedup1[0].reviewCount === 40000, 'pipeline: sponsored occurrence review data does not leak in (got ' + dedup1[0].reviewCount + ')');

// Organic first, sponsored second (different order) — organic must still win
var d2 = [
  { title: 'Phone', asin: 'B0PHONE1', canonicalUrl: 'u2', isSponsored: false, price: 2000, reviewCount: 1000 },
  { title: 'Phone', asin: 'B0PHONE1', canonicalUrl: 'u2', isSponsored: true, price: 2000, reviewCount: 99999 }
];
var dedup2 = deduplicateProducts(d2);
assert(dedup2.length === 1 && dedup2[0].isSponsored === false, 'pipeline: even when sponsored appears later, organic still wins');

// --- Pipeline: sponsored-only product is excluded entirely ---
var sOnly = [
  { title: 'AdOnly', asin: 'B0ADONLY', canonicalUrl: 'u3', isSponsored: true, reviewCount: 200000, price: 500 }
];
var pipelineOnly = pipeline(sOnly, null, null);
assert(pipelineOnly.length === 0, 'pipeline: sponsored-only product removed from ranking (got ' + pipelineOnly.length + ')');

// --- Pipeline: normal products remain unchanged (no sponsored, no dup) ---
var normal = [
  { title: 'X', asin: 'B0X0001', canonicalUrl: 'u4', isSponsored: false, price: 500, reviewCount: 50000 },
  { title: 'Y', asin: 'B0Y0002', canonicalUrl: 'u5', isSponsored: false, price: 600, reviewCount: 90000 },
  { title: 'Z', asin: 'B0Z0003', canonicalUrl: 'u6', isSponsored: false, price: 700, reviewCount: 10000 }
];
var normOut = pipeline(normal, null, null);
assert(normOut.length === 3, 'pipeline: normal products unchanged in count (got ' + normOut.length + ')');
assert(normOut.map(function (p) { return p.title; }).join(',') === 'Y,X,Z', 'pipeline: ranking remains review-count based Y,X,Z (got ' + normOut.map(function (p) { return p.title; }).join(',') + ')');

// --- Pipeline: budget filtering still works together with sponsored exclusion ---
var budgetMix = [
  { title: 'SponHigh', asin: 'B0S001', canonicalUrl: 'u7', isSponsored: true, price: 1200, reviewCount: 200000 },
  { title: 'OrgA', asin: 'B0O001', canonicalUrl: 'u8', isSponsored: false, price: 999, reviewCount: 90000 },
  { title: 'OrgB', asin: 'B0O002', canonicalUrl: 'u9', isSponsored: false, price: 1999, reviewCount: 120000 },
  { title: 'OrgC', asin: 'B0O003', canonicalUrl: 'u10', isSponsored: false, price: 1099, reviewCount: 14553 }
];
var budgetOut = pipeline(budgetMix, 600, 1500);
assert(budgetOut.length === 2, 'pipeline+budget: in-range organic only (got ' + budgetOut.length + ')');
assert(budgetOut.every(function (p) { return p.isSponsored === false; }), 'pipeline+budget: no sponsored products in output');
assert(budgetOut.every(function (p) { return p.price >= 600 && p.price <= 1500; }), 'pipeline+budget: all outputs within budget');
assert(budgetOut.map(function (p) { return p.title; }).join(',') === 'OrgA,OrgC', 'pipeline+budget: ranking by review count OrgA(90k),OrgC(14.5k) (got ' + budgetOut.map(function (p) { return p.title; }).join(',') + ')');

// --- Pipeline: full example from spec — sponsored with highest reviews excluded, ranking by review count afterwards ---
var spec = [
  { title: 'Product A', asin: 'B0A001', canonicalUrl: 'u11', isSponsored: false, price: 999, reviewCount: 90794, rating: 3.8 },
  { title: 'Product B', asin: 'B0B001', canonicalUrl: 'u12', isSponsored: false, price: 1099, reviewCount: 31823, rating: 3.8 },
  { title: 'Product SPONSORED', asin: 'B0S002', canonicalUrl: 'u13', isSponsored: true, price: 599, reviewCount: 999999, rating: 4.9 },
  { title: 'Product D', asin: 'B0D001', canonicalUrl: 'u14', isSponsored: false, price: 1199, reviewCount: 14553, rating: 3.7 }
];
var specOut = pipeline(spec, 600, 2000);
assert(specOut.length === 3, 'spec: sponsored largest-review product excluded (got ' + specOut.length + ')');
assert(specOut.every(function (p) { return p.isSponsored === false; }), 'spec: only organic in output');
assert(specOut[0].title === 'Product A' && specOut[0].reviewCount === 90794, 'spec: #1 has highest organic review count');
assert(specOut[1].reviewCount === 31823 && specOut[2].reviewCount === 14553, 'spec: subsequent ranks by review count DESC');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);