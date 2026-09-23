#!/usr/bin/env node
/**
 * ReviewRank — Site Adapter Interface tests.
 *
 * Validates the adapter registry, adapter interface contract, normalized
 * product format, and adapter-specific extraction behavior.
 *
 * Run: node tests/site-adapters.test.js
 */
'use strict';

var adapters = require('../lib/site-adapters.js');
var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log('FAIL: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a === b) {
    passed++;
  } else {
    failed++;
    console.log('FAIL: ' + message + ' (got ' + a + ', expected ' + b + ')');
  }
}

// ---- Registry structure ----

assert(typeof adapters.register === 'function', 'registry has register()');
assert(typeof adapters.getAdapterForCurrentSite === 'function', 'registry has getAdapterForCurrentSite()');
assert(typeof adapters.getAdapterForDomain === 'function', 'registry has getAdapterForDomain()');
assert(typeof adapters.getRegisteredAdapters === 'function', 'registry has getRegisteredAdapters()');

// ---- Registered adapters count ----

var registered = adapters.getRegisteredAdapters();
assertEqual(registered.length, 4, 'exactly 4 adapters registered');

// ---- Amazon adapter ----

var amazon = adapters.getAdapterForDomain('amazon.in');
assert(amazon !== null, 'Amazon adapter found for amazon.in');
assertEqual(amazon.name, 'Amazon', 'Amazon adapter name is Amazon');
assertEqual(amazon.implemented, true, 'Amazon adapter is implemented');
assert(Array.isArray(amazon.domains), 'Amazon adapter has domains array');
assert(amazon.domains.indexOf('amazon.in') !== -1, 'Amazon adapter includes amazon.in');
assert(amazon.domains.indexOf('amazon.com') !== -1, 'Amazon adapter includes amazon.com');

// ---- Amazon adapter interface contract ----

var requiredMethods = [
  'extractProducts',
  'findLoadMoreTrigger',
  'findNextPageLink',
  'extractSearchQuery',
  'getResultCardSelector',
  'detectSponsored',
  'parseAmazonProduct',
  'extractTitle',
  'extractAsin',
  'extractProductUrl',
  'extractImageUrl',
  'srcsetToUrl',
  'extractPrice',
  'extractRating',
  'extractReviewCount',
  'parseIndianNumber',
  'parseReviewCountText',
  'isPlausibleReviewCount',
  'normalizeAmazonUrl',
  'extractAsinFromUrl',
  'triggerAmazonLoadMore',
  'isNextPageHref',
  'canonicalPageUrl',
  'getSearchInputValue',
  'getQueryParamK',
  'extractSearchQueryContent'
];

for (var m = 0; m < requiredMethods.length; m++) {
  assert(typeof amazon[requiredMethods[m]] === 'function', 'Amazon adapter has ' + requiredMethods[m] + '()');
}

// ---- Adapter domain matching ----

assertEqual(adapters.getAdapterForDomain('amazon.in').name, 'Amazon', 'amazon.in -> Amazon');
assertEqual(adapters.getAdapterForDomain('www.amazon.in').name, 'Amazon', 'www.amazon.in -> Amazon');
assertEqual(adapters.getAdapterForDomain('amazon.com').name, 'Amazon', 'amazon.com -> Amazon');
assertEqual(adapters.getAdapterForDomain('www.amazon.com').name, 'Amazon', 'www.amazon.com -> Amazon');

// ---- Unknown domain returns null ----

assertEqual(adapters.getAdapterForDomain('unknown-site.com'), null, 'unknown domain -> null');
assertEqual(adapters.getAdapterForDomain(''), null, 'empty host -> null');

// ---- Flipkart adapter ----

var flipkart = adapters.getAdapterForDomain('flipkart.com');
assert(flipkart !== null, 'Flipkart adapter found');
assertEqual(flipkart.name, 'Flipkart', 'Flipkart adapter name');
assertEqual(flipkart.implemented, true, 'Flipkart adapter is implemented');
assertEqual(flipkart.getResultCardSelector(), 'div[data-id]', 'Flipkart result card selector');

// ---- Meesho / Myntra stubs ----

var meesho = adapters.getAdapterForDomain('meesho.com');
assert(meesho !== null, 'Meesho adapter found');
assertEqual(meesho.name, 'Meesho', 'Meesho adapter name');
assertEqual(meesho.implemented, true, 'Meesho adapter is implemented');
assertEqual(meesho.getResultCardSelector(), 'a[href*="/p/"]', 'Meesho result card selector');

var myntra = adapters.getAdapterForDomain('myntra.com');
assert(myntra !== null, 'Myntra adapter found');
assertEqual(myntra.name, 'Myntra', 'Myntra adapter name');
assertEqual(myntra.implemented, false, 'Myntra adapter not implemented');

// ---- isSearchPage ----

assert(amazon.isSearchPage('https://www.amazon.in/s?k=airpods'), 'Amazon /s? is search');
assert(amazon.isSearchPage('https://www.amazon.com/s/ref=nb_sb_noss?url=search-alias&field-keywords=airpods'), 'Amazon /s/ is search');
assert(amazon.isSearchPage('https://www.amazon.in/s?k=test&rh=n%3A123'), 'Amazon k= is search');
assert(!amazon.isSearchPage('https://www.amazon.in/dp/B08N5WRWNW'), 'Amazon /dp/ is not search');
assert(!amazon.isSearchPage('https://www.amazon.in/gp/cart/view.html'), 'Amazon cart is not search');

assert(flipkart.isSearchPage('https://www.flipkart.com/search?q=earbuds'), 'Flipkart /search? is search');
assert(flipkart.isSearchPage('https://www.flipkart.com/search?q=test&page=2'), 'Flipkart page= is search');
assert(flipkart.isSearchPage('https://www.flipkart.com/mobiles/pr?sid=tyy&q=phone'), 'Flipkart /pr? is search');
assert(!flipkart.isSearchPage('https://www.flipkart.com/p/some-product/p/itmabc?pid=MOB123'), 'Flipkart /p/ is not search');

assert(meesho.isSearchPage('https://www.meesho.com/search?q=earbuds'), 'Meesho /search? is search');
assert(meesho.isSearchPage('https://www.meesho.com/search?q=test&page=2'), 'Meesho q= is search');
assert(meesho.isSearchPage('https://www.meesho.com/mens-shirts/pl/3j3'), 'Meesho /pl/ is search');
assert(!meesho.isSearchPage('https://www.meesho.com/product-name/p/abc123'), 'Meesho /p/ is not search');

assert(!myntra.isSearchPage('https://www.myntra.com/search?q=shirt'), 'Myntra stub returns false');

// ---- Minimal DOM shim for adapter extraction tests ----

function el(tag, attrs, children) {
  if (typeof children === 'string') {
    return makeNode(tag, attrs || {}, '', children);
  }
  return makeNode(tag, attrs || {}, children || []);
}

function makeNode(tag, attrs, children, leafText) {
  var childEls = Array.isArray(children) ? children : [];
  var node = {
    tag: tag,
    tagName: tag,
    attrs: attrs || {},
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
    },
    querySelector: function (selector) {
      var results = queryAll(node, selector);
      return results.length > 0 ? results[0] : null;
    }
  };
  for (var c = 0; c < childEls.length; c++) { childEls[c].parentNode = node; }
  Object.defineProperty(node, 'textContent', {
    get: function () {
      if (this._leafText !== null && this._leafText !== undefined) return this._leafText;
      return this.children.map(function (c) { return c.textContent; }).join('');
    }
  });
  return node;
}

function parseToken(raw) {
  var token = { tag: null, classes: [], attrs: [] };
  var i = 0;
  while (i < raw.length) {
    var ch = raw[i];
    if (ch === '.') {
      var j = i + 1;
      while (j < raw.length && /[A-Za-z0-9_-]/.test(raw[j])) j++;
      token.classes.push(raw.slice(i + 1, j));
      i = j;
    } else if (ch === '[') {
      var close = raw.indexOf(']', i);
      var inner = raw.slice(i + 1, close);
      i = close + 1;
      var m = inner.match(/^([A-Za-z-]+)(\*?=)?(?:"([^"]*)"|([^"]*))?$/);
      var name = m[1];
      var op = m[2] ? (m[2] === '*=' ? '*' : '=') : null;
      var value = m[3] !== undefined ? m[3] : (m[4] || null);
      token.attrs.push({ name: name, op: op, value: value });
    } else if (/[A-Za-z]/.test(ch) && !token.tag) {
      var k = i;
      while (k < raw.length && /[A-Za-z0-9]/.test(raw[k])) k++;
      token.tag = raw.slice(i, k);
      i = k;
    } else {
      i++;
    }
  }
  return token;
}

function parseSelector(selector) {
  var branches = [];
  var parts = selector.split(',');
  for (var p = 0; p < parts.length; p++) {
    var tokens = [];
    var raw = parts[p];
    var buf = '';
    var inBracket = false;
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i];
      if (ch === '[') inBracket = true;
      if (ch === ']') inBracket = false;
      if (/\s/.test(ch) && !inBracket) {
        if (buf.trim()) tokens.push(parseToken(buf.trim()));
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) tokens.push(parseToken(buf.trim()));
    if (tokens.length) branches.push(tokens);
  }
  return branches;
}

function matchToken(node, token) {
  if (token.tag && node.tag !== token.tag) return false;
  var nodeClass = node.attrs['class'] || '';
  for (var c = 0; c < token.classes.length; c++) {
    if ((' ' + nodeClass + ' ').indexOf(' ' + token.classes[c] + ' ') === -1) return false;
  }
  for (var a = 0; a < token.attrs.length; a++) {
    var v = node.getAttribute(token.attrs[a].name);
    if (v === null) return false;
    if (token.attrs[a].op === '*') { if (v.indexOf(token.attrs[a].value) === -1) return false; }
    else if (token.attrs[a].op === '=') { if (v !== token.attrs[a].value) return false; }
  }
  return true;
}

function matchBranch(node, tokens, idx) {
  if (!matchToken(node, tokens[idx])) return false;
  if (idx === 0) return true;
  var p = node.parentNode;
  while (p) {
    if (matchBranch(p, tokens, idx - 1)) return true;
    p = p.parentNode;
  }
  return false;
}

function queryAll(node, selector) {
  var results = [];
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) {
    var branches = parseSelector(selector);
    for (var b = 0; b < branches.length; b++) {
      if (matchBranch(children[i], branches[b], branches[b].length - 1)) {
        results.push(children[i]);
        break;
      }
    }
    results = results.concat(queryAll(children[i], selector));
  }
  return results;
}

// ---- Normalized product format (Amazon adapter) ----

var card = el('div', { 'data-component-type': 's-search-result' });
var parsed = amazon.parseAmazonProduct(card);

assert(parsed === null, 'empty card -> null (no title)');

// Card with a title
var titledCard = el('div', { 'data-component-type': 's-search-result' }, [
  el('h2', {}, [
    el('a', { href: '/dp/B08N5WRWNW' }, [
      el('span', {}, 'Test Product Title')
    ])
  ])
]);

var titledParsed = amazon.parseAmazonProduct(titledCard);

assert(titledParsed !== null, 'titled card -> parsed product');

// Verify normalized fields exist (values may be null, but keys must be present)
var requiredFields = [
  'title', 'price', 'rating', 'reviewCount', 'image', 'url',
  'productId', 'sponsored', 'source'
];
for (var f = 0; f < requiredFields.length; f++) {
  assert(Object.prototype.hasOwnProperty.call(titledParsed, requiredFields[f]),
    'parsed product has field: ' + requiredFields[f]);
}

assertEqual(titledParsed.title, 'Test Product Title', 'title extracted');
assertEqual(titledParsed.source, 'Amazon', 'source defaults to Amazon');
assertEqual(titledParsed.sponsored, false, 'sponsored defaults to false');

// ---- getResultCardSelector ----

assertEqual(amazon.getResultCardSelector(), '[data-component-type="s-search-result"]',
  'Amazon result card selector');

// ============================================================
// Flipkart adapter tests
// ============================================================

// Helper to build a Flipkart-style product card using the DOM shim.
// Note: class selectors like ._4rR01T are parsed by our shim as class "4rR01T"
// because the leading dot is the selector token, not part of the class name.
function fkCard(attrs, children) {
  return el('div', attrs || {}, children || []);
}

function span(cls, text) {
  return el('span', { class: cls }, text);
}

function div(cls, text) {
  return el('div', { class: cls }, text || '');
}

function a(cls, href, text) {
  return el('a', { class: cls, href: href || '' }, text || '');
}

function img(src) {
  return el('img', { src: src || '', alt: '' });
}

// ---- Empty card returns null ----

var emptyFk = fkCard({ 'data-id': 'ABC123' });
assert(flipkart.parseProduct(emptyFk) === null, 'empty Flipkart card -> null (no title)');

// ---- Full Flipkart product card ----

var fullFk = fkCard({ 'data-id': 'MOBABC123XYZ' }, [
  a('_4rR01T', '/p/some-product/p/itmabc123?pid=MOBABC123XYZ&lid=LSTMOBABC123XYZ', 'Flipkart Wireless Earbuds'),
  span('_30jeq3', '₹1,499'),
  span('_3LWZlK', '4.3'),
  span('_2U9tEA', '12,345 Ratings'),
  img('https://rukminim2.flixcart.com/image/312/312/xif0q/earbuds/abc/original/abc123.jpeg?q=70')
]);

var fkParsed = flipkart.parseProduct(fullFk);

assert(fkParsed !== null, 'full Flipkart card -> parsed product');
assertEqual(fkParsed.title, 'Flipkart Wireless Earbuds', 'Flipkart title extracted');
assertEqual(fkParsed.price, 1499, 'Flipkart price parsed');
assertEqual(fkParsed.rating, 4.3, 'Flipkart rating parsed');
assertEqual(fkParsed.reviewCount, 12345, 'Flipkart reviewCount parsed');
assertEqual(fkParsed.productId, 'MOBABC123XYZ', 'Flipkart productId from pid');
assertEqual(fkParsed.source, 'Flipkart', 'Flipkart source');
assertEqual(fkParsed.sponsored, false, 'Flipkart non-sponsored defaults to false');
assert(fkParsed.url.indexOf('/p/') !== -1 || fkParsed.url.indexOf('flipkart') !== -1, 'Flipkart url is product or absolute');

// Verify normalized fields exist
var fkRequiredFields = [
  'title', 'price', 'rating', 'reviewCount', 'image', 'url',
  'productId', 'sponsored', 'source'
];
for (var ff = 0; ff < fkRequiredFields.length; ff++) {
  assert(Object.prototype.hasOwnProperty.call(fkParsed, fkRequiredFields[ff]),
    'Flipkart parsed product has field: ' + fkRequiredFields[ff]);
}

// ---- Price variations ----

var priceCard1 = fkCard({ 'data-id': 'P1' }, [
  a('_4rR01T', '/p/p1/p/itm1?pid=P1', 'Product 1'),
  span('_30jeq3', '₹9,999')
]);
assertEqual(flipkart.parseProduct(priceCard1).price, 9999, 'Flipkart comma price');

var priceCard2 = fkCard({ 'data-id': 'P2' }, [
  a('_4rR01T', '/p/p2/p/itm2?pid=P2', 'Product 2'),
  span('_1vC4OE', '₹1,09,999')
]);
assertEqual(flipkart.parseProduct(priceCard2).price, 109999, 'Flipkart lakhs price');

// ---- Rating variations ----

var ratingCard1 = fkCard({ 'data-id': 'R1' }, [
  a('_4rR01T', '/p/r1/p/itm1?pid=R1', 'Rated Product'),
  span('_3LWZlK', '4.7')
]);
assertEqual(flipkart.parseProduct(ratingCard1).rating, 4.7, 'Flipkart rating 4.7');

var ratingCard2 = fkCard({ 'data-id': 'R2' }, [
  a('_4rR01T', '/p/r2/p/itm2?pid=R2', 'Rated Product 2'),
  span('_2beYZw', '3.9')
]);
assertEqual(flipkart.parseProduct(ratingCard2).rating, 3.9, 'Flipkart alternate rating class');

// ---- Review count variations ----

var reviewCard1 = fkCard({ 'data-id': 'RV1' }, [
  a('_4rR01T', '/p/rv1/p/itm1?pid=RV1', 'Reviewed Product'),
  span('_2U9tEA', '5,678 Ratings')
]);
assertEqual(flipkart.parseProduct(reviewCard1).reviewCount, 5678, 'Flipkart review count with Ratings');

var reviewCard2 = fkCard({ 'data-id': 'RV2' }, [
  a('_4rR01T', '/p/rv2/p/itm2?pid=RV2', 'Reviewed Product 2'),
  span('_2U9tEA', '(1,234)')
]);
assertEqual(flipkart.parseProduct(reviewCard2).reviewCount, 1234, 'Flipkart review count in parens');

// ---- Sponsored detection ----

var sponsoredCard = fkCard({ 'data-id': 'SP1' }, [
  a('_4rR01T', '/p/sp1/p/itm1?pid=SP1', 'Sponsored Product'),
  span('_30jeq3', '₹999'),
  span('_3LWZlK', '4.0'),
  span('_2U9tEA', '100 Ratings')
]);
// Inject "Sponsored" text into the card
sponsoredCard.children.push(span('', 'Sponsored'));
var sponsoredParsed = flipkart.parseProduct(sponsoredCard);
assert(sponsoredParsed !== null, 'sponsored card parses');
assertEqual(sponsoredParsed.sponsored, true, 'Flipkart sponsored detected from text');

// ---- Image extraction ----

var imageCard = fkCard({ 'data-id': 'IMG1' }, [
  a('_4rR01T', '/p/img1/p/itm1?pid=IMG1', 'Image Product'),
  img('https://rukminim2.flixcart.com/image/312/312/xif0q/mobile/abc.jpg?q=70')
]);
var imageParsed = flipkart.parseProduct(imageCard);
assert(imageParsed !== null, 'image card parses');
assert(imageParsed.image && imageParsed.image.indexOf('flixcart') !== -1, 'Flipkart image URL preserved');

// ---- Product ID extraction ----

var pidCard = fkCard({ 'data-id': 'PID1' }, [
  a('_4rR01T', '/p/product-name/p/itm12345?pid=MOBPID123ABC&lid=LSTMOBPID123ABC', 'PID Product')
]);
var pidParsed = flipkart.parseProduct(pidCard);
assertEqual(pidParsed.productId, 'MOBPID123ABC', 'Flipkart productId from URL pid param');

// ---- Absolute URL handling ----

var absUrlCard = fkCard({ 'data-id': 'ABS1' }, [
  a('_4rR01T', 'https://www.flipkart.com/p/product/p/itm1?pid=ABS1', 'Abs URL Product')
]);
var absParsed = flipkart.parseProduct(absUrlCard);
assert(absParsed !== null, 'absolute URL card parses');
assert(absParsed.url.indexOf('https://') === 0, 'Flipkart absolute URL preserved');

// ---- Missing fields remain null ----

var partialCard = fkCard({ 'data-id': 'PART1' }, [
  a('_4rR01T', '/p/part/p/itm1?pid=PART1', 'Partial Product')
]);
var partialParsed = flipkart.parseProduct(partialCard);
assert(partialParsed !== null, 'partial card still parses');
assertEqual(partialParsed.price, null, 'Flipkart missing price -> null');
assertEqual(partialParsed.rating, null, 'Flipkart missing rating -> null');
assertEqual(partialParsed.reviewCount, null, 'Flipkart missing reviewCount -> null');

// ---- extractProducts with multiple cards ----

var multiCard = el('div', {}, [
  fkCard({ 'data-id': 'M1' }, [
    a('_4rR01T', '/p/m1/p/itm1?pid=M1', 'Multi Product 1'),
    span('_30jeq3', '₹500'),
    span('_3LWZlK', '4.1'),
    span('_2U9tEA', '100 Ratings')
  ]),
  fkCard({ 'data-id': 'M2' }, [
    a('_4rR01T', '/p/m2/p/itm2?pid=M2', 'Multi Product 2'),
    span('_30jeq3', '₹1,200'),
    span('_3LWZlK', '4.5'),
    span('_2U9tEA', '500 Ratings')
  ])
]);

var savedDocument = typeof globalThis !== 'undefined' ? globalThis.document : undefined;
try { globalThis.document = { querySelectorAll: function(sel) { return queryAll(multiCard, sel); } }; } catch (e) {}

var multiProducts = flipkart.extractProducts();

try { if (savedDocument !== undefined) globalThis.document = savedDocument; else if (typeof globalThis !== 'undefined') delete globalThis.document; } catch (e) {}

assertEqual(multiProducts.length, 2, 'Flipkart extractProducts returns 2 products');
assertEqual(multiProducts[0].title, 'Multi Product 1', 'first product title');
assertEqual(multiProducts[1].title, 'Multi Product 2', 'second product title');

// ============================================================
// Meesho adapter tests
// ============================================================

function msCard(attrs, children) {
  return el('div', attrs || {}, children || []);
}

function msLink(href, text) {
  return el('a', { href: href || '' }, text || '');
}

function msSpan(cls, text) {
  return el('span', { class: cls }, text);
}

function msDiv(cls, text) {
  return el('div', { class: cls }, text || '');
}

function msImg(src) {
  return el('img', { src: src || '', alt: '' });
}

// ---- Empty card returns null ----

var emptyMs = msCard({ 'data-testid': 'productCard' });
assert(meesho.parseProduct(emptyMs) === null, 'empty Meesho card -> null (no title)');

// ---- Full Meesho product card ----

var fullMs = msCard({ 'data-testid': 'productCard' }, [
  msLink('/p/wireless-earbuds/p/abc123', 'Meesho Wireless Earbuds'),
  msSpan('PriceTag__PriceText', '₹1,499'),
  msSpan('RatingAndReview__AverageRating', '4.3'),
  msSpan('RatingAndReview__RatingCount', '12,345 Ratings'),
  msImg('https://images.meesho.com/images/products/abc/123.webp')
]);

var msParsed = meesho.parseProduct(fullMs);

assert(msParsed !== null, 'full Meesho card -> parsed product');
assertEqual(msParsed.title, 'Meesho Wireless Earbuds', 'Meesho title extracted');
assertEqual(msParsed.price, 1499, 'Meesho price parsed');
assertEqual(msParsed.rating, 4.3, 'Meesho rating parsed');
assertEqual(msParsed.reviewCount, 12345, 'Meesho reviewCount parsed');
assertEqual(msParsed.productId, 'ABC123', 'Meesho productId from URL');
assertEqual(msParsed.source, 'Meesho', 'Meesho source');
assertEqual(msParsed.sponsored, false, 'Meesho non-sponsored defaults to false');
assert(msParsed.url.indexOf('/p/') !== -1 || msParsed.url.indexOf('meesho') !== -1, 'Meesho url is product or absolute');

// Verify normalized fields exist
var msRequiredFields = [
  'title', 'price', 'rating', 'reviewCount', 'image', 'url',
  'productId', 'sponsored', 'source'
];
for (var mf = 0; mf < msRequiredFields.length; mf++) {
  assert(Object.prototype.hasOwnProperty.call(msParsed, msRequiredFields[mf]),
    'Meesho parsed product has field: ' + msRequiredFields[mf]);
}

// ---- Price variations ----

var msPrice1 = msCard({}, [
  msLink('/p/p1/p/p1', 'Product 1'),
  msSpan('', '₹9,999')
]);
assertEqual(meesho.parseProduct(msPrice1).price, 9999, 'Meesho comma price');

var msPrice2 = msCard({}, [
  msLink('/p/p2/p/p2', 'Product 2'),
  msSpan('', '₹1,09,999')
]);
assertEqual(meesho.parseProduct(msPrice2).price, 109999, 'Meesho lakhs price');

// ---- Rating variations ----

var msRating1 = msCard({}, [
  msLink('/p/r1/p/r1', 'Rated Product'),
  msSpan('RatingAndReview__AverageRating', '4.7')
]);
assertEqual(meesho.parseProduct(msRating1).rating, 4.7, 'Meesho rating 4.7');

var msRating2 = msCard({}, [
  msLink('/p/r2/p/r2', 'Rated Product 2'),
  msSpan('RatingText', '3.9')
]);
assertEqual(meesho.parseProduct(msRating2).rating, 3.9, 'Meesho alternate rating class');

// ---- Review count variations ----

var msReview1 = msCard({}, [
  msLink('/p/rv1/p/rv1', 'Reviewed Product'),
  msSpan('RatingAndReview__RatingCount', '5,678 Ratings')
]);
assertEqual(meesho.parseProduct(msReview1).reviewCount, 5678, 'Meesho review count with Ratings');

var msReview2 = msCard({}, [
  msLink('/p/rv2/p/rv2', 'Reviewed Product 2'),
  msSpan('RatingAndReview__RatingCount', '(1,234)')
]);
assertEqual(meesho.parseProduct(msReview2).reviewCount, 1234, 'Meesho review count in parens');

// ---- Review count: false-positive prevention (#10) ----
// Bug: a card with "1,299 Ratings" and an unrelated "81,299" elsewhere
// was extracting 81,299 instead of 1,299.
var msReviewFalsePositive = msCard({}, [
  msLink('/p/fp/p/fp', 'False Positive Product'),
  msSpan('PriceTag__PriceText', '₹81,299'),
  msSpan('RatingAndReview__AverageRating', '3.8'),
  msSpan('RatingAndReview__RatingCount', '1,299 Ratings'),
  msSpan('RatingAndReview__ReviewCount', '493 Reviews'),
  msSpan('', '81299')
]);
assertEqual(meesho.parseProduct(msReviewFalsePositive).reviewCount, 1299, 'Meesho: 81,299 ignored, 1,299 Ratings extracted');

// Unrelated bare number in a span with no rating/review context is never matched
var msReviewNoBareNumber = msCard({}, [
  msLink('/p/bn/p/bn', 'Bare Number Product'),
  msSpan('PriceTag__PriceText', '₹81,299'),
  msSpan('RatingAndReview__RatingCount', '1,299 Ratings'),
  msSpan('', '81299')
]);
assertEqual(meesho.parseProduct(msReviewNoBareNumber).reviewCount, 1299, 'Meesho: bare 81,299 span ignored when rating count present');

// No rating count element → bare numbers are not extracted
var msReviewNoCount = msCard({}, [
  msLink('/p/nc/p/nc', 'No Count Product'),
  msSpan('', '81,299')
]);
assertEqual(meesho.parseProduct(msReviewNoCount).reviewCount, null, 'Meesho: bare number with no rating context -> null');

// ---- K / L suffix support ----
var msReviewK = msCard({}, [
  msLink('/p/k/p/k', 'K Suffix Product'),
  msSpan('RatingAndReview__RatingCount', '12.4K Ratings')
]);
assertEqual(meesho.parseProduct(msReviewK).reviewCount, 12400, 'Meesho: 12.4K Ratings -> 12400');

var msReviewL = msCard({}, [
  msLink('/p/l/p/l', 'L Suffix Product'),
  msSpan('RatingAndReview__RatingCount', '1.2L Ratings')
]);
assertEqual(meesho.parseProduct(msReviewL).reviewCount, 120000, 'Meesho: 1.2L Ratings -> 120000');

// No comma format
var msReviewNoComma = msCard({}, [
  msLink('/p/nc/p/nc2', 'No Comma Product'),
  msSpan('RatingAndReview__RatingCount', '1299 Ratings')
]);
assertEqual(meesho.parseProduct(msReviewNoComma).reviewCount, 1299, 'Meesho: 1299 Ratings (no comma) -> 1299');

// ---- Sponsored detection ----

var msSponsored = msCard({}, [
  msLink('/p/sp1/p/sp1', 'Sponsored Product'),
  msSpan('PriceTag__PriceText', '₹999'),
  msSpan('RatingAndReview__AverageRating', '4.0'),
  msSpan('RatingAndReview__RatingCount', '100 Ratings')
]);
msSponsored.children.push(msSpan('', 'Sponsored'));
var msSponsoredParsed = meesho.parseProduct(msSponsored);
assert(msSponsoredParsed !== null, 'sponsored Meesho card parses');
assertEqual(msSponsoredParsed.sponsored, true, 'Meesho sponsored detected from text');

// ---- Image extraction ----

var msImage = msCard({}, [
  msLink('/p/img1/p/img1', 'Image Product'),
  msImg('https://images.meesho.com/images/products/abc/123.webp')
]);
var msImageParsed = meesho.parseProduct(msImage);
assert(msImageParsed !== null, 'Meesho image card parses');
assert(msImageParsed.image && msImageParsed.image.indexOf('meesho') !== -1, 'Meesho image URL preserved');

// ---- Product ID extraction ----

var msPid = msCard({}, [
  msLink('/p/product-name/p/19yax6?pid=MSHPID123', 'PID Product')
]);
var msPidParsed = meesho.parseProduct(msPid);
assertEqual(msPidParsed.productId, 'MSHPID123', 'Meesho productId from URL pid param');

// ---- Absolute URL handling ----

var msAbsUrl = msCard({}, [
  msLink('https://www.meesho.com/product/p/abc123', 'Abs URL Product')
]);
var msAbsParsed = meesho.parseProduct(msAbsUrl);
assert(msAbsParsed !== null, 'absolute URL Meesho card parses');
assertEqual(msAbsParsed.url, 'https://www.meesho.com/product/p/abc123', 'Meesho absolute URL preserved');

// ---- Missing fields remain null ----

var msPartial = msCard({}, [
  msLink('/p/part/p/part1', 'Partial Product')
]);
var msPartialParsed = meesho.parseProduct(msPartial);
assert(msPartialParsed !== null, 'partial Meesho card still parses');
assertEqual(msPartialParsed.price, null, 'Meesho missing price -> null');
assertEqual(msPartialParsed.rating, null, 'Meesho missing rating -> null');
assertEqual(msPartialParsed.reviewCount, null, 'Meesho missing reviewCount -> null');

// ---- extractProducts with multiple cards ----

var msMultiCard = el('div', {}, [
  msCard({}, [
    msLink('/p/multi-product1/p/prod123', 'Multi Product 1'),
    msSpan('PriceTag__PriceText', '₹500'),
    msSpan('RatingAndReview__AverageRating', '4.1'),
    msSpan('RatingAndReview__RatingCount', '100 Ratings')
  ]),
  msCard({}, [
    msLink('/p/multi-product2/p/prod456', 'Multi Product 2'),
    msSpan('PriceTag__PriceText', '₹1,200'),
    msSpan('RatingAndReview__AverageRating', '4.5'),
    msSpan('RatingAndReview__RatingCount', '500 Ratings')
  ])
]);

var savedDocument2 = typeof globalThis !== 'undefined' ? globalThis.document : undefined;
try { globalThis.document = { querySelectorAll: function(sel) { return queryAll(msMultiCard, sel); } }; } catch (e) {}

var msMultiProducts = meesho.extractProducts();

try { if (savedDocument2 !== undefined) globalThis.document = savedDocument2; else if (typeof globalThis !== 'undefined') delete globalThis.document; } catch (e) {}

assertEqual(msMultiProducts.length, 2, 'Meesho extractProducts returns 2 products');
assertEqual(msMultiProducts[0].title, 'Multi Product 1', 'Meesho first product title');
assertEqual(msMultiProducts[1].title, 'Multi Product 2', 'Meesho second product title');

// ---- Summary ----

console.log('\nAssertions: ' + (passed + failed));
if (failed === 0) {
  console.log('ALL TESTS PASSED');
} else {
  console.log('FAILURES: ' + failed);
  process.exit(1);
}
