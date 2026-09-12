#!/usr/bin/env node
/**
 * ReviewRank — Load More Products tests.
 *
 * Covers the "Load More / More Products" feature:
 *   - findLoadMoreTrigger() detection across multiple Amazon DOM patterns
 *   - merging newly-loaded products with the existing set
 *   - the shared pipeline (dedup -> validate -> budget -> sponsored -> sort)
 *     producing ONE global ranking, with contiguous ranks and header count
 *   - safeguards: max load limit, no-double-click, empty/no-change fallback,
 *     and preserving existing results when loading fails.
 *
 * findLoadMoreTrigger is imported from the REAL content/content.js; the pure
 * pipeline helpers are mirrored from popup/popup.js (same convention as
 * tests/sponsored-products.test.js, since popup.js is browser-only).
 *
 * Run: node tests/load-more.test.js
 */
'use strict';

var failures = 0;
var count = 0;
function assert(cond, label) {
  count++;
  if (cond) console.log('PASS: ' + label);
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(a, b, label) {
  assert(a === b, label + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')');
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  var ka = Object.keys(a); var kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}
function assertDeep(actual, expected, label) {
  count++;
  if (deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))) {
    console.log('PASS: ' + label);
  } else {
    failures++;
    console.log('FAIL: ' + label + '\n  actual:   ' + JSON.stringify(actual) + '\n  expected: ' + JSON.stringify(expected));
  }
}
function titlesOf(ranked) { return ranked.map(function (p) { return p.title; }); }
// Lightweight DOM shim supporting: tag, #id, .class, [attr], [attr="v"],
// [attr*="v"], descendant (space), comma OR — enough for findLoadMoreTrigger.

function el(tag, attrs, children) {
  if (typeof children === 'string') {
    return makeNode(tag, attrs || {}, '', children);
  }
  return makeNode(tag, attrs || {}, children || []);
}

function makeNode(tag, attrs, children, leafText) {
  var childEls = Array.isArray(children) ? children : [];
  var node = {
    tag: tag, attrs: attrs, children: childEls,
    _leafText: leafText || null, parentNode: null,
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? String(this.attrs[name]) : null;
    },
    querySelectorAll: function (selector) { return queryAll(node, selector); }
  };
  for (var i = 0; i < childEls.length; i++) { childEls[i].parentNode = node; }
  Object.defineProperty(node, 'textContent', {
    get: function () {
      if (this._leafText !== null && this._leafText !== undefined) return this._leafText;
      return this.children.map(function (c) { return c.textContent; }).join('');
    }
  });
  node.offsetParent = node; // truthy => visible (isHidden treats display:none as null)
  if (node.attrs && node.attrs.disabled === true) node.disabled = true;
  return node;
}

function splitCompounds(part) {
  var tokens = []; var buf = ''; var inBracket = false;
  for (var i = 0; i < part.length; i++) {
    var ch = part[i];
    if (ch === '[') inBracket = true;
    if (ch === ']') inBracket = false;
    if (/\s/.test(ch) && !inBracket) {
      if (buf.trim()) tokens.push(buf.trim());
      buf = '';
    } else { buf += ch; }
  }
  if (buf.trim()) tokens.push(buf.trim());
  return tokens;
}

function parseToken(raw) {
  var token = { tag: null, id: null, classes: [], attrs: [] };
  var i = 0;
  while (i < raw.length) {
    var ch = raw[i];
    if (ch === '#') {
      var j = i + 1;
      while (j < raw.length && /[A-Za-z0-9_-]/.test(raw[j])) j++;
      token.id = raw.slice(i + 1, j); i = j;
    } else if (ch === '.') {
      var j2 = i + 1;
      while (j2 < raw.length && /[A-Za-z0-9-]/.test(raw[j2])) j2++;
      token.classes.push(raw.slice(i + 1, j2)); i = j2;
    } else if (ch === '[') {
      var close = raw.indexOf(']', i);
      var inner = raw.slice(i + 1, close); i = close + 1;
      var m = inner.match(/^([A-Za-z-]+)(\*?=)?(?:"([^"]*)"|'([^']*)'|([^"']*))?$/);
      var op = m[2] ? (m[2] === '*=' ? '*' : '=') : null;
      var value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] || null));
      token.attrs.push({ name: m[1], op: op, value: value });
    } else if (token.tag === null && /[A-Za-z]/.test(ch)) {
      var j3 = i;
      while (j3 < raw.length && /[A-Za-z0-9]/.test(raw[j3])) j3++;
      token.tag = raw.slice(i, j3); i = j3;
    } else { i++; }
  }
  return token;
}

function tokenMatches(node, token) {
  if (token.tag && node.tag !== token.tag) return false;
  if (token.id) {
    var id = node.getAttribute ? node.getAttribute('id') : null;
    if (id !== token.id) return false;
  }
  if (token.classes.length) {
    var cls = (node.attrs && node.attrs.class) ? String(node.attrs.class) : '';
    var clsArr = cls.split(/\s+/).filter(Boolean);
    for (var i = 0; i < token.classes.length; i++) {
      if (clsArr.indexOf(token.classes[i]) === -1) return false;
    }
  }
  for (var k = 0; k < token.attrs.length; k++) {
    var a = token.attrs[k];
    var val = node.getAttribute ? node.getAttribute(a.name) : null;
    if (val === null) return false;
    if (a.op === '*') { if (val.indexOf(a.value) === -1) return false; }
    else if (val !== a.value) { return false; }
  }
  return true;
}

function matches(node, selector) {
  if (selector.indexOf(',') !== -1) {
    var parts = selector.split(',');
    for (var i = 0; i < parts.length; i++) {
      if (matches(node, parts[i].trim())) return true;
    }
    return false;
  }
  var tokens = splitCompounds(selector).map(parseToken);
  if (tokens.length > 1) return matchDescendant(node, tokens);
  return tokens.length === 1 ? tokenMatches(node, tokens[0]) : false;
}

// tokens[last] is the deepest element; earlier tokens must be ancestors.
function matchDescendant(node, tokens) {
  if (!tokenMatches(node, tokens[tokens.length - 1])) return false;
  if (tokens.length === 1) return true;
  var anc = node.parentNode;
  for (var t = tokens.length - 2; t >= 0; t--) {
    var found = false;
    while (anc) {
      if (tokenMatches(anc, tokens[t])) { found = true; break; }
      anc = anc.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function queryAll(root, selector) {
  var results = [];
  if (matches(root, selector)) results.push(root);
  for (var i = 0; i < (root.children || []).length; i++) {
    var kids = queryAll(root.children[i], selector);
    for (var j = 0; j < kids.length; j++) results.push(kids[j]);
  }
  return results;
}
// --- Import REAL production logic ---
var Content = require('../content/content.js');
var findLoadMoreTrigger = Content.findLoadMoreTrigger;
var V = require('../lib/product-validation.js');
var UI = require('../lib/display.js');

// --- Mirrors of popup.js pure pipeline functions (identical logic) ---
var MAX_LOADS = 5;

function deduplicateProducts(products) {
  var seen = {}; var order = [];
  for (var i = 0; i < products.length; i++) {
    var product = products[i];
    var key = getProductKey(product, i);
    if (seen.hasOwnProperty(key)) {
      seen[key] = mergeProductRecords(seen[key], product);
    } else {
      seen[key] = product;
      order.push(key);
    }
  }
  var result = [];
  for (var j = 0; j < order.length; j++) { result.push(seen[order[j]]); }
  return result;
}

function getProductKey(product, index) {
  if (product.asin) return 'asin:' + product.asin;
  if (product.canonicalUrl) return 'url:' + product.canonicalUrl;
  return 'fallback:' + index;
}

function mergeProductRecords(existing, incoming) {
  if (!existing.isSponsored && incoming.isSponsored) return existing;
  if (existing.isSponsored && !incoming.isSponsored) return incoming;
  return recordCompleteness(incoming) > recordCompleteness(existing) ? incoming : existing;
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
  copy.sort(function (a, b) {
    var aCount = (typeof a.reviewCount === 'number' && isFinite(a.reviewCount)) ? a.reviewCount : -1;
    var bCount = (typeof b.reviewCount === 'number' && isFinite(b.reviewCount)) ? b.reviewCount : -1;
    return bCount - aCount;
  });
  return copy;
}

// The SINGLE shared pipeline: dedup -> validate -> budget -> sponsored -> sort.
function runPipeline(products, budget) {
  var unique = deduplicateProducts(products);
  var valid = V.validateProducts(unique);
  var filtered = filterByPriceRange(valid, budget.min, budget.max);
  var organic = excludeSponsoredProducts(filtered);
  return sortByReviewCount(organic);
}

// Model of popup's load-more merge: concat new products, re-run pipeline.
function mergeForLoadMore(existingRaw, newProducts, budget) {
  return runPipeline(existingRaw.concat(newProducts), budget);
}

// State-machine mirror of popup.js load-more guards.
function createController() {
  return {
    loadMoreCount: 0,
    isLoadingMore: false,
    canClick: function () { return !this.isLoadingMore && this.loadMoreCount < MAX_LOADS; },
    beginLoad: function () { this.isLoadingMore = true; },
    finishLoad: function (ok) { this.isLoadingMore = false; if (ok) this.loadMoreCount++; }
  };
}

// Sample product factory.
function p(title, asin, overrides) {
  var base = { title: title, asin: asin, price: 500, rating: 4, reviewCount: 1000,
    imageUrl: 'https://img/a.jpg', url: 'https://www.amazon.in/dp/' + asin,
    canonicalUrl: 'https://www.amazon.in/dp/' + asin, isSponsored: false, marketplace: 'Amazon' };
  if (overrides) for (var k in overrides) base[k] = overrides[k];
  return base;
}

var NO_BUDGET = { min: null, max: null };
var BUDGET_600_1500 = { min: 600, max: 1500 };
console.log('--- findLoadMoreTrigger detection ---');

var emptyPage = el('body', {}, [el('div', { id: 'search' }, [el('div', { 'data-component-type': 's-search-result', 'data-asin': 'B0AAA11111' }, [])])]);
eq(findLoadMoreTrigger(emptyPage) === null, true, 'detection: no load-more button -> null');

var dataAttrPage = el('body', {}, [
  el('button', { 'data-action': 'load-more' }, 'Load more'),
  el('div', { 'data-component-type': 's-search-result' }, [])
]);
var a1 = findLoadMoreTrigger(dataAttrPage);
assert(!!a1, 'detection: [data-action="load-more"] button found');

var idPage = el('body', {}, [
  el('button', { id: 'pabk-button' }, 'Load more'),
  el('div', { 'data-component-type': 's-search-result' }, [])
]);
assert(!!findLoadMoreTrigger(idPage), 'detection: #pabk-button id found');

var classPage = el('body', {}, [
  el('button', { class: 'load-more-button' }, 'Load more'),
  el('div', { 'data-component-type': 's-search-result' }, [])
]);
assert(!!findLoadMoreTrigger(classPage), 'detection: .load-more-button class found');

var textPage = el('body', {}, [
  el('button', {}, 'See more results'),
  el('div', { 'data-component-type': 's-search-result' }, [])
]);
assert(!!findLoadMoreTrigger(textPage), 'detection: "See more results" text found');

var ariaPage = el('body', {}, [
  el('button', { 'aria-label': 'Load more' }),
  el('div', { 'data-component-type': 's-search-result' }, [])
]);
assert(!!findLoadMoreTrigger(ariaPage), 'detection: aria-label "Load more" found');

var noFalse = el('body', {}, [
  el('button', {}, 'Cancel'),
  el('button', {}, 'Add to Cart'),
  el('a', { href: '/gp/cart' }, 'Cart')
]);
eq(findLoadMoreTrigger(noFalse) === null, true, 'detection: non-load-more buttons ignored');

var hiddenPage = el('body', {}, [
  el('button', { 'data-action': 'load-more', disabled: true }, 'Load more')
]);
eq(findLoadMoreTrigger(hiddenPage) === null, true, 'detection: disabled load-more ignored');
assert(findLoadMoreTrigger(dataAttrPage) === a1, 'detection: returns the exact element to click');

// ---------------------------------------------------------------------------
// Merge + pipeline tests
// ---------------------------------------------------------------------------
console.log('--- merge + pipeline ---');

var initialProducts = [p('Alpha', 'B0AAA11111'), p('Bravo', 'B0BBB22222')];
var newLoaded = [p('Charlie', 'B0CCC33333'), p('Delta', 'B0DDD44444')];
var merged = mergeForLoadMore(initialProducts.slice(), newLoaded, NO_BUDGET);
var byAsin = {};
merged.forEach(function (x) { byAsin[x.asin] = x; });
assert(byAsin['B0AAA11111'] && byAsin['B0BBB22222'], 'merge: initial products preserved (Alpha, Bravo)');
assert(byAsin['B0CCC33333'] && byAsin['B0DDD44444'], 'merge: newly loaded products extracted (Charlie, Delta)');

var dupAsin = mergeForLoadMore(
  [p('Alpha', 'B0AAA11111', { reviewCount: 100, price: null, rating: null, imageUrl: null })],
  [p('Alpha', 'B0AAA11111', { reviewCount: 200 })],
  NO_BUDGET
);
eq(dupAsin.length, 1, 'dedup: duplicate ASIN collapsed to one');
eq(dupAsin[0].price, 500, 'dedup: duplicate ASIN keeps the more-complete record (price filled in)');
eq(dupAsin[0].reviewCount, 200, 'dedup: kept record is the more-complete one (reviewCount 200)');

var dupUrl = mergeForLoadMore(
  [p('Alpha', null, { reviewCount: 100, url: 'https://www.amazon.in/dp/B0AAA11111' })],
  [p('Alpha', null, { reviewCount: 200, url: 'https://www.amazon.in/dp/B0AAA11111' })],
  NO_BUDGET
);
eq(dupUrl.length, 1, 'dedup: duplicate canonical URL collapsed to one');

var sponMix = mergeForLoadMore(
  [p('Org', 'B0OOO11111', { reviewCount: 50000 })],
    [p('SponsoredAd', 'B0AAA22222', { reviewCount: 999999, isSponsored: true })],
  NO_BUDGET
);
eq(sponMix.length, 1, 'sponsored: new sponsored product excluded');
assert(sponMix.every(function (x) { return !x.isSponsored; }), 'sponsored: all outputs organic');

var invalidMix = mergeForLoadMore(
  [p('Good', 'B0OOO11111', { reviewCount: 50000 })],
  [
    { title: 'B', asin: 'B0AAA22222' },
        { title: 'No Identity', asin: 'bad', canonicalUrl: 'https://www.amazon.in/hz/cart' }
  ],
  NO_BUDGET
);
eq(invalidMix.length, 1, 'validation: invalid new products rejected');
eq(invalidMix[0].title, 'Good', 'validation: only the valid initial product remains');

var budgetMix = mergeForLoadMore(
  [p('Org', 'B0OOO11111', { price: 700, reviewCount: 10000 })],
  [p('TooCheap', 'B0AAA22222', { price: 100, reviewCount: 90000 })],
  BUDGET_600_1500
);
eq(budgetMix.length, 1, 'budget: out-of-range new product filtered');
eq(budgetMix[0].asin, 'B0OOO11111', 'budget: in-range product retained');

var globalRanked = mergeForLoadMore(
  [p('AAA', 'B0AAA11111', { price: 999, reviewCount: 10000 }),
   p('BBB', 'B0BBB22222', { price: 999, reviewCount: 8000 })],
  [p('CCC', 'B0CCC33333', { price: 999, reviewCount: 25000 }),
   p('DDD', 'B0DDD44444', { price: 999, reviewCount: 5000 })],
  BUDGET_600_1500
);
assertDeep(titlesOf(globalRanked), ['CCC', 'AAA', 'BBB', 'DDD'], 'ranking: global recalculation CCC(25k)>AAA(10k)>BBB(8k)>DDD(5k)');

var hiLoaded = mergeForLoadMore(
  [p('Low', 'B0AAA11111', { price: 999, reviewCount: 10000 })],
  [p('High', 'B0BBB22222', { price: 999, reviewCount: 999999 })],
  BUDGET_600_1500
);
eq(hiLoaded[0].title, 'High', 'ranking: higher-count loaded product becomes #1');

var contig = mergeForLoadMore(
  [p('AAA', 'B0AAA11111', { price: 999, reviewCount: 100 }),
   p('BBB', 'B0BBB22222', { price: 999, reviewCount: 50 })],
  [p('CCC', 'B0CCC33333', { price: 999, reviewCount: 200 })],
  BUDGET_600_1500
);
eq(contig.length, 3, 'ranking: three products after merge');
assert(contig[0].reviewCount === 200 && contig[1].reviewCount === 100 && contig[2].reviewCount === 50,
  'ranking: contiguous #1..#3 by review count DESC');

eq(UI.resultsHeaderText(contig.length, 600, 1500), '3 PRODUCTS IN ₹600 – ₹1,500', 'header: count updates to 3 after load');
eq(UI.resultsHeaderText(2, null, null), '2 PRODUCTS FOUND', 'header: initial 2 products, no budget');
console.log('--- safeguards ---');

// Load-more stops when no new products appear (existing still visible)
var noneNew = mergeForLoadMore(
  [p('AAA', 'B0AAA11111', { price: 999, reviewCount: 10000 })],
  [], NO_BUDGET
);
eq(noneNew.length, 1, 'no-new: existing product still present, none added');
eq(noneNew[0].title, 'AAA', 'no-new: existing product unchanged');

// Maximum load-more limit prevents infinite loops
var ctrl = createController();
var clicks = 0;
for (var mi = 0; mi < 20; mi++) {
  if (!ctrl.canClick()) break;
  ctrl.beginLoad(); clicks++; ctrl.finishLoad(true);
}
eq(clicks, MAX_LOADS, 'max-limit: exactly ' + MAX_LOADS + ' loads before stopping (no infinite loop)');
assert(ctrl.loadMoreCount === MAX_LOADS, 'max-limit: counter capped at ' + MAX_LOADS);
assert(!ctrl.canClick(), 'max-limit: further clicks rejected after cap');

// Double-click while loading does not trigger multiple operations
var dbl = createController();
assert(dbl.canClick() === true, 'double-click: button enabled initially');
dbl.beginLoad();
assert(dbl.isLoadingMore === true, 'double-click: first click sets loading=true');
assert(dbl.canClick() === false, 'double-click: second click rejected while loading');
dbl.finishLoad(true);
assert(dbl.isLoadingMore === false, 'double-click: loading flag cleared on completion');
assert(dbl.canClick() === true, 'double-click: button re-enabled after completion');

// Existing products remain visible if loading fails (merge of empty new set)
var afterFail = mergeForLoadMore(
  [p('AAA', 'B0AAA11111', { price: 999, reviewCount: 10000 })],
  [], BUDGET_600_1500
);
eq(afterFail.length, 1, 'failure: existing product still visible after failed/empty load');
eq(afterFail[0].title, 'AAA', 'failure: existing product unchanged');

// Regression: shared pipeline ranks correctly on a fresh set
var baseline = runPipeline(
  [p('XXX', 'B0X11111111', { price: 999, reviewCount: 50000 }),
   p('YYY', 'B0Y22222222', { price: 999, reviewCount: 90000 }),
   p('ZZZ', 'B0Z33333333', { price: 999, reviewCount: 10000 })],
  BUDGET_600_1500
);
assertDeep(titlesOf(baseline), ['YYY', 'XXX', 'ZZZ'], 'regression: shared pipeline ranks YYY(90k)>XXX(50k)>ZZZ(10k)');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : (failures + ' TEST(S) FAILED (out of ' + count + ')'));
process.exit(failures === 0 ? 0 : 1);




