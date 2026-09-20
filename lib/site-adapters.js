var ReviewRankAdapters = (function() {
  'use strict';

  var registry = {};
  var ordered = [];

  function register(adapter) {
    if (!adapter || !adapter.name || !adapter.domains || !adapter.domains.length) return;
    registry[adapter.name] = adapter;
    ordered.push(adapter);
  }

  function getAdapterForCurrentSite() {
    if (typeof document === 'undefined') return null;
    var host = (location.hostname || '').toLowerCase();
    return getAdapterForDomain(host);
  }

  function getAdapterForDomain(host) {
    if (!host) return null;
    for (var i = 0; i < ordered.length; i++) {
      var a = ordered[i];
      var domains = a.domains || [];
      for (var j = 0; j < domains.length; j++) {
        var d = domains[j].toLowerCase();
        if (host === d || host === 'www.' + d || host === d.replace(/^www\./, '')) {
          return a;
        }
      }
    }
    return null;
  }

  function getRegisteredAdapters() {
    return ordered.slice();
  }

  var amazonAdapter = createAmazonAdapter();
  register(amazonAdapter);

  register(createFlipkartAdapter());
  register(createMeeshoAdapter());
  register(createMyntraAdapter());

  return {
    register: register,
    getAdapterForCurrentSite: getAdapterForCurrentSite,
    getAdapterForDomain: getAdapterForDomain,
    getRegisteredAdapters: getRegisteredAdapters
  };
})();

try {
  if (typeof window !== 'undefined') window.ReviewRankAdapters = ReviewRankAdapters;
  if (typeof globalThis !== 'undefined') globalThis.ReviewRankAdapters = ReviewRankAdapters;
} catch (e) {}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewRankAdapters;
}

// ============================================================
// Amazon Adapter
// ============================================================

function createAmazonAdapter() {
  var api = {
    name: 'Amazon',
    domains: ['amazon.in', 'amazon.com'],
    implemented: true,
    extractProducts: extractAmazonProducts,
    findLoadMoreTrigger: findLoadMoreTrigger,
    findNextPageLink: findNextPageLink,
    extractSearchQuery: extractSearchQueryAdapter,
    getResultCardSelector: function() { return '[data-component-type="s-search-result"]'; },
    detectSponsored: detectSponsored,
    parseAmazonProduct: parseAmazonProduct,
    extractTitle: extractTitle,
    extractAsin: extractAsin,
    extractProductUrl: extractProductUrl,
    extractImageUrl: extractImageUrl,
    srcsetToUrl: srcsetToUrl,
    extractPrice: extractPrice,
    extractRating: extractRating,
    extractReviewCount: extractReviewCount,
    parseIndianNumber: parseIndianNumber,
    parseReviewCountText: parseReviewCountText,
    isPlausibleReviewCount: isPlausibleReviewCount,
    normalizeAmazonUrl: normalizeAmazonUrl,
    extractAsinFromUrl: extractAsinFromUrl,
    triggerAmazonLoadMore: triggerAmazonLoadMore,
    isNextPageHref: isNextPageHref,
    canonicalPageUrl: canonicalPageUrl,
    getSearchInputValue: getSearchInputValue,
    getQueryParamK: getQueryParamK,
    extractSearchQueryContent: extractSearchQueryContent,
    isSearchPage: function(url) {
      if (typeof url !== 'string') return false;
      var u = url.toLowerCase();
      if (u.indexOf('/s?') !== -1 || u.indexOf('/s/') !== -1) return true;
      if (/[?&#]k=/.test(u)) return true;
      return false;
    }
  };
  return api;
}

function extractAmazonProducts() {
  var products = [];
  var items = document.querySelectorAll('[data-component-type="s-search-result"]');
  for (var i = 0; i < items.length; i++) {
    try {
      var product = parseAmazonProduct(items[i]);
      if (product) {
        products.push(product);
      }
    } catch (e) {
      // Skip items that fail to parse
    }
  }
  return products;
}

function detectSponsored(item) {
  if (item.getAttribute && item.getAttribute('data-component-type') === 'sp-sponsored-result') {
    return true;
  }
  if (item.querySelectorAll('[data-component-type="sp-sponsored-result"]').length > 0) {
    return true;
  }

  var labelClasses = [
    '.puis-sponsored-label-text',
    '.s-sponsored-label-text',
    '.puis-sponsored-label-txt',
    '.s-sponsored-label-info-icon',
    '.s-sponsored-label-info-icon',
    '.a-size-base.s-sponsored-label-text',
    '.a-size-mini.s-sponsored-label-text'
  ];
  if (item.querySelectorAll(labelClasses.join(',')).length > 0) {
    return true;
  }

  var candidates = item.querySelectorAll('span, div, a, i, b');
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    if (el.children && el.children.length > 0) continue;
    var text = (el.textContent || '').trim();
    if (/^sponsored$/i.test(text)) {
      return true;
    }
  }

  var attrEls = item.querySelectorAll('[aria-label], [title]');
  for (var i = 0; i < attrEls.length; i++) {
    var el = attrEls[i];
    var ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (/^sponsored/i.test(ariaLabel)) return true;
    var title = (el.getAttribute('title') || '').trim();
    if (/^sponsored/i.test(title)) return true;
  }

  return false;
}

function parseAmazonProduct(item) {
  var title = extractTitle(item);
  if (!title) return null;

  var isSponsored = detectSponsored(item);

  var productUrl = extractProductUrl(item);
  var canonicalUrl = normalizeAmazonUrl(productUrl);

  var asin = extractAsin(item, canonicalUrl);

  var rawPrice = extractPrice(item);
  var rawRating = extractRating(item);
  var rawReviewCount = extractReviewCount(item);
  var rawImageUrl = extractImageUrl(item);

  return {
    title: title,
    price: rawPrice,
    rating: rawRating,
    reviewCount: rawReviewCount,
    image: rawImageUrl,
    imageUrl: rawImageUrl,
    url: productUrl || canonicalUrl,
    canonicalUrl: canonicalUrl,
    productId: asin,
    asin: asin,
    sponsored: isSponsored,
    isSponsored: isSponsored,
    source: 'Amazon',
    marketplace: 'Amazon'
  };
}

function extractTitle(item) {
  var selectors = [
    'h2 a span',
    'h2 span',
    'h2',
    'span.a-size-base-plus.a-color-base.a-text-normal',
    '.s-title-instructions-style span',
    'span[role="heading"]',
    'a.a-link-normal.a-text-normal',
    'a.a-link-normal span',
    'div.a-section.a-spacing-small span',
    'span.a-size-base.a-size-base-plus'
  ];
  var best = null;
  var bestEl = null;
  for (var s = 0; s < selectors.length; s++) {
    var els = item.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim().replace(/\s+/g, ' ');
      text = text.replace(/^sponsored\s+/i, '').trim();
      if (text.length >= 3 && !/^sponsored$/i.test(text)) {
        if (best === null || text.length > best.length) {
          best = text;
          bestEl = els[e];
        }
      }
    }
  }
  if (bestEl && best && best.length < 15) {
    var node = bestEl.parentNode;
    while (node && node !== item) {
      try {
        var parentText = (node.textContent || '').trim().replace(/\s+/g, ' ');
        var cleaned = parentText.replace(/^sponsored\s+/i, '').trim();
        if (cleaned.length > best.length * 2 && cleaned.indexOf(best) !== -1) {
          best = cleaned;
          break;
        }
      } catch (e) { /* continue up */ }
      node = node.parentNode;
    }
  }
  return best;
}

function extractAsin(item, canonicalUrl) {
  var asin = null;
  if (item.getAttribute) {
    var raw = item.getAttribute('data-asin');
    if (raw) asin = raw.trim();
  }
  if (!asin && canonicalUrl) {
    asin = extractAsinFromUrl(canonicalUrl);
  }
  if (asin) {
    var normalized = asin.toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

function extractProductUrl(item) {
  var selectorGroups = [
    'h2 a',
    'a.a-link-normal.s-no-outline',
    'a[href*="/dp/"]',
    'a[href*="/gp/product"]'
  ];
  for (var s = 0; s < selectorGroups.length; s++) {
    var links = item.querySelectorAll(selectorGroups[s]);
    for (var l = 0; l < links.length; l++) {
      var href = (links[l].getAttribute('href') || '').trim();
      if (!href || href === '#' || href.charAt(0) === '#') continue;
      if (/customerReviews|product-reviews|wishlist|boughtTogether|javascript:/i.test(href)) continue;
      if (/\/dp\/|\/(?:gp\/)?product\//i.test(href)) {
        return href.indexOf('http') === 0 ? href : 'https://www.amazon.in' + href;
      }
    }
  }
  return null;
}

function normalizeAmazonUrl(url) {
  if (!url) return null;
  var fullUrl = url;
  if (!fullUrl.startsWith('http')) {
    fullUrl = 'https://www.amazon.in' + fullUrl;
  }
  try {
    var parsed = new URL(fullUrl);
    var path = parsed.pathname;
    var pathWithoutRef = path.split('/ref=')[0];
    var dpMatch = pathWithoutRef.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
    if (dpMatch) {
      return 'https://www.amazon.in/dp/' + dpMatch[1].toUpperCase();
    }
    return pathWithoutRef.replace(/\/+$/, '');
  } catch (e) {
    return fullUrl.split('?')[0].replace(/\/+$/, '');
  }
}

function extractAsinFromUrl(url) {
  if (!url) return null;
  var match = url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

function extractImageUrl(item) {
  var selectors = [
    'img.s-image',
    'img.a-dynamic-image',
    'img[data-image-latency*="product"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var imgs = item.querySelectorAll(selectors[s]);
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src');
      if (!src) src = imgs[i].getAttribute('data-src');
      if (!src) src = srcsetToUrl(imgs[i].getAttribute('srcset'));
      if (!src) continue;
      if (/^data:/i.test(src)) continue;
      if (/sprites|g-ecx|gno/i.test(src)) continue;
      var w = parseInt(imgs[i].getAttribute('width'), 10);
      var h = parseInt(imgs[i].getAttribute('height'), 10);
      if ((!isNaN(w) && w > 0 && w < 20) || (!isNaN(h) && h > 0 && h < 20)) continue;
      return src;
    }
  }
  return null;
}

function srcsetToUrl(srcset) {
  if (!srcset) return null;
  var best = null;
  var bestSize = -1;
  var parts = srcset.split(',');
  for (var i = 0; i < parts.length; i++) {
    var tokens = parts[i].trim().split(/\s+/);
    if (!tokens[0]) continue;
    var url = tokens[0];
    var size = 0;
    if (tokens.length >= 2) {
      size = parseInt(tokens[1], 10) || 0;
    }
    if (size > bestSize) {
      bestSize = size;
      best = url;
    } else if (best === null) {
      best = url;
    }
  }
  return best;
}

function extractPrice(item) {
  var anchors = item.querySelectorAll('.a-price');
  for (var a = 0; a < anchors.length; a++) {
    var strike = anchors[a].getAttribute('data-a-strike');
    var cls = anchors[a].getAttribute('class') || '';
    if (strike === 'true' || cls.indexOf('a-text-price') !== -1) {
      continue;
    }
    var offScreens = anchors[a].querySelectorAll('.a-offscreen');
    for (var o = 0; o < offScreens.length; o++) {
      var price = parseIndianNumber(offScreens[o].textContent);
      if (price !== null && price > 0) return price;
    }
    var wholes = anchors[a].querySelectorAll('.a-price-whole');
    for (var w = 0; w < wholes.length; w++) {
      var price = parseIndianNumber(wholes[w].textContent);
      if (price !== null && price > 0) return price;
    }
  }

  var bareWholes = item.querySelectorAll('.a-price-whole');
  for (var b = 0; b < bareWholes.length; b++) {
    var price = parseIndianNumber(bareWholes[b].textContent);
    if (price !== null && price > 0) return price;
  }

  return null;
}

function extractRating(item) {
  var selectors = [
    '.a-icon-star-small .a-icon-alt',
    '.a-icon-star .a-icon-alt',
    '.a-icon-star-medium .a-icon-alt',
    '[aria-label*="out of 5"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = item.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = els[e].textContent || els[e].getAttribute('aria-label') || '';
      var match = text.match(/(\d+(?:\.\d+)?)\s*out of 5/i);
      var num = match ? parseFloat(match[1]) : parseFloat(text);
      if (!isNaN(num) && num >= 0 && num <= 5) {
        return num;
      }
    }
  }
  return null;
}

function extractReviewCount(item) {
  var ariaEls = item.querySelectorAll('[aria-label*="ratings"], [aria-label*="reviews"]');
  for (var a = 0; a < ariaEls.length; a++) {
    var label = ariaEls[a].getAttribute('aria-label') || '';
    var count = parseReviewCountText(label);
    if (count !== null && count > 0) {
      return count;
    }
  }

  var reviewSelectors = [
    'a[href*="customerReviews"] span',
    'a[href*="product-reviews"] span',
    'span.a-size-base.s-underline-text',
    'span.a-size-base.a-color-base',
    'a span.a-size-base'
  ];
  for (var s = 0; s < reviewSelectors.length; s++) {
    var els = item.querySelectorAll(reviewSelectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var count = parseReviewCountText(text);
      if (count !== null && isPlausibleReviewCount(text, count)) {
        return count;
      }
    }
  }

  var fallbackEls = item.querySelectorAll('span, a, div');
  for (var f = 0; f < fallbackEls.length; f++) {
    var text = (fallbackEls[f].textContent || '').trim();
    if (!text || text.length > 40) continue;
    if (isInsideHeading(fallbackEls[f])) continue;
    var count = parseReviewCountText(text);
    if (count !== null && isPlausibleReviewCount(text, count)) {
      return count;
    }
  }

  return null;
}

function parseIndianNumber(text) {
  if (!text) return null;
  var cleaned = text
    .replace(/rs\.?/i, '')
    .replace(/inr/i, '')
    .replace(/[₹,\s]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  var num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseReviewCountText(text) {
  if (!text) return null;
  var lower = text.toLowerCase();

  var lakh = lower.match(/([\d,.]+)\s*lakh/);
  if (lakh) return Math.round(parseFloat(lakh[1].replace(/,/g, '')) * 100000);
  var crore = lower.match(/([\d,.]+)\s*crore/);
  if (crore) return Math.round(parseFloat(crore[1].replace(/,/g, '')) * 10000000);

  var kMatch = lower.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  var mMatch = lower.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);

  var plain = lower.match(
    /([\d,]+)\s*\+?\s*(?:(?:global|customer|verified)\s+)?(?:ratings?|reviews?)?\s*$/
  );
  if (plain) {
    var num = parseInt(plain[1].replace(/,/g, ''), 10);
    if (!isNaN(num)) return num;
  }

  return null;
}

function isPlausibleReviewCount(text, count) {
  if (count === null || count === undefined || count <= 0) return false;
  if (count >= 100000000) return false;
  var lower = text.toLowerCase();
  if (/[₹$€]/.test(text)) return false;
  if (/%/.test(text)) return false;
  if (/\b(bought|emi|month|quantity|discount|sold|offer|deal)\b/.test(lower)) return false;
  if (/(ratings?|reviews?)/i.test(lower)) return true;
  var trimmed = text.trim();
  var unwrapped = trimmed.replace(/^[\s([{]+/, '').replace(/[\s)\]}]+$/, '');
  if (/^[\d,]+$/.test(unwrapped)) return count >= 100;
  if (/^[\d.]+\s*[kKmM]\s*\+?$/.test(unwrapped)) return count >= 100;
  return false;
}

function isInsideHeading(el) {
  if (!el || !el.parentNode) return false;
  var node = el.parentNode;
  while (node) {
    var tag1 = (node.tagName || node.nodeName || '').toUpperCase();
    var tag2 = (node.tag || '').toUpperCase();
    if (tag1 === 'H2' || tag2 === 'H2') return true;
    node = node.parentNode;
  }
  return false;
}

function getSearchInputValue() {
  try {
    if (typeof document === 'undefined' || !document.querySelector) return '';
    var selectors = [
      '#twotabsearchtextbox',
      'input[name="field-keywords"]',
      '#nav-search input[type="text"]',
      'input[aria-label*="Search"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var input = null;
      try { input = document.querySelector(selectors[i]); } catch (e) { input = null; }
      if (input && typeof input.value === 'string' && input.value.trim().length >= 2) {
        return input.value.trim().replace(/\s+/g, ' ');
      }
    }
  } catch (e) { /* best effort */ }
  return '';
}

function getQueryParamK(pageUrl) {
  var href = pageUrl || '';
  try {
    if (typeof location !== 'undefined' && location.href && !href) href = location.href;
  } catch (e) { /* noop */ }
  if (!href) return '';
  try {
    var m = href.match(/[?&#]k=([^&#]*)/);
    if (!m) return '';
    var raw = m[1].replace(/\+/g, ' ');
    try { raw = decodeURIComponent(raw); } catch (e2) { /* keep raw */ }
    return raw.trim();
  } catch (e) { return ''; }
}

function extractSearchQueryContent() {
  var fromInput = getSearchInputValue();
  if (fromInput && fromInput.length >= 2) return fromInput;
  var fromUrl = getQueryParamK('');
  return fromUrl || '';
}

function extractSearchQueryAdapter(document, pageHref) {
  var fromInput = getSearchInputValue();
  if (fromInput && fromInput.length >= 2) return fromInput;
  return getQueryParamK(pageHref || '');
}

function findLoadMoreTrigger(root) {
  var container = root || (typeof document !== 'undefined' ? document.body : null);
  if (!container || !container.querySelectorAll) return null;

  var attrSel = [
    '[data-action="load-more"]',
    '[data-action="loadmore"]',
    '[data-load-more="true"]',
    '[data-loadmore="true"]',
    '[data-testid*="load-more"]',
    '[data-testid*="loadmore"]'
  ];
  for (var a = 0; a < attrSel.length; a++) {
    var attrMatches = container.querySelectorAll(attrSel[a]);
    for (var ai = 0; ai < attrMatches.length; ai++) {
      if (!isHidden(attrMatches[ai]) && isLoadMoreElement(attrMatches[ai])) {
        return attrMatches[ai];
      }
    }
  }

  var idClassSel = [
    '#pabk-button-container button',
    '#pabk-button',
    '.pabk-button',
    '.load-more-button',
    '.loadmore',
    '.see-more',
    '.see-more-results'
  ];
  for (var ic = 0; ic < idClassSel.length; ic++) {
    var icMatches = container.querySelectorAll(idClassSel[ic]);
    if (icMatches.length > 0 && !isHidden(icMatches[0])) return icMatches[0];
  }

  var clickables = container.querySelectorAll('button, [role="button"], a');
  var best = null;
  for (var c = 0; c < clickables.length; c++) {
    var el = clickables[c];
    if (isHidden(el)) continue;
    var t = elementText(el);
    if (!t) continue;
    if (LOAD_MORE_TEXT.test(t)) {
      if (isLoadMoreElement(el)) return el;
      if (!best) best = el;
    }
  }
  return best;

  function isLoadMoreElement(el) {
    var id = el.getAttribute ? (el.getAttribute('id') || '') : '';
    var cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
    var data = el.getAttribute
      ? (el.getAttribute('data-action') || el.getAttribute('data-testid') || '')
      : '';
    if (data && LOAD_MORE_ATTRS.some(function (a) { return data.toLowerCase().indexOf(a) !== -1; })) {
      return true;
    }
    if (id && LOAD_MORE_ROLES.some(function (r) { return id.toLowerCase().indexOf(r) !== -1; })) {
      return true;
    }
    if (cls && LOAD_MORE_ROLES.some(function (r) { return cls.toLowerCase().indexOf(r) !== -1; })) {
      return true;
    }
    return false;
  }
}

var LOAD_MORE_TEXT = /load\s*more|see\s*more\s*(results|products)?|more\s*products/i;
var LOAD_MORE_ATTRS = ['load-more', 'loadmore', 'load_more'];
var LOAD_MORE_ROLES = ['loadmore', 'see-more', 'see-more-results'];

var FORD_CLASSES = ['ApHcvd', 'NmiuEb', 'm0dNvb', 'XKjMKe', 'NqJPjb', 'yhUmnc', 'i18n', 'fcit'];
var FORD_TEXT_FRAGMENTS = ['enter your email', 'enter a password', 'enter your phone', 'verification code', 'confirm your email', 'confirm your password', 'create password'];

function triggerAmazonLoadMore(trigger) {
  if (typeof trigger.onclick === 'function') {
    try { trigger.onclick.call(trigger); } catch (e) { /* handler error */ }
    return;
  }

  var tag = (typeof trigger.tagName === 'string') ? trigger.tagName.toLowerCase() : '';
  if (tag === 'button' || tag === 'input') {
    try { trigger.click(); } catch (e) { /* best effort */ }
    return;
  }

  var href = (typeof trigger.getAttribute === 'function') ? trigger.getAttribute('href') : '';
  var isJsHref = (typeof href === 'string' && href.toLowerCase().indexOf('javascript:') === 0);

  if (isJsHref) {
    var guard = function (e) { try { e.preventDefault(); } catch (_) {} };
    try { trigger.addEventListener('click', guard, true); } catch (_) {}
    try { trigger.click(); } catch (_) {}
    try { trigger.removeEventListener('click', guard, true); } catch (_) {}
  } else {
    try { trigger.click(); } catch (_) {}
  }
}

function elementText(el) {
  if (!el) return '';
  try {
    var t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    var al = el.getAttribute ? el.getAttribute('aria-label') || '' : '';
    var tt = el.getAttribute ? el.getAttribute('title') || '' : '';
    if (!t && al) t = al.trim().replace(/\s+/g, ' ');
    if (!t && tt) t = tt.trim().replace(/\s+/g, ' ');
    return t;
  } catch (e) {
    return '';
  }
}

function isHidden(el) {
  if (!el) return true;
  if (el.disabled === true) return true;
  if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) {
    return true;
  }
  return false;
}

function findNextPageLink(root) {
  var container = root || (typeof document !== 'undefined' ? document.body : null);
  if (!container) return null;
  var qa = function (sel) {
    try { return container.querySelectorAll ? container.querySelectorAll(sel) : []; }
    catch (e) { return []; }
  };

  function linkOk(el) {
    if (!el || isHidden(el)) return null;
    if (el.disabled === true) return null;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return null;
    var href = elementHref(el);
    if (!isNextPageHref(href)) return null;
    return resolveNextHref(href);
  }

  var ariaSels = [
    'a[aria-label="Go to next page"]',
    'a[aria-label="Next"]',
    'a[aria-label="next"]',
    'a[aria-label="Next page"]',
    'a[aria-label="next page"]'
  ];
  for (var a = 0; a < ariaSels.length; a++) {
    var ariaMatches = qa(ariaSels[a]);
    for (var ai = 0; ai < ariaMatches.length; ai++) {
      var hitA = linkOk(ariaMatches[ai]);
      if (hitA) return hitA;
    }
  }

  var regions = qa('.s-pagination-container, [role="navigation"], .a-pagination, nav');
  var collect = [];
  var b, bi;
  for (b = 0; b < regions.length; b++) {
    var region = regions[b];
    if (!region || !region.querySelectorAll) continue;
    var inRegion;
    try { inRegion = region.querySelectorAll('a, button'); }
    catch (e) { inRegion = []; }
    for (bi = 0; bi < inRegion.length; bi++) collect.push(inRegion[bi]);
  }
  var tokenSels = ['a.s-pagination-next', '.s-pagination-item.s-pagination-next'];
  for (b = 0; b < tokenSels.length; b++) {
    var tokMatches = qa(tokenSels[b]);
    for (bi = 0; bi < tokMatches.length; bi++) collect.push(tokMatches[bi]);
  }
  for (b = 0; b < collect.length; b++) {
    var elB = collect[b];
    if (!elB || isHidden(elB)) continue;
    if (elB.disabled === true) continue;
    if (elB.getAttribute && elB.getAttribute('aria-disabled') === 'true') continue;
    var tagB = ((elB.tagName || elB.tag || '') + '').toUpperCase();
    var clsB = (elB.getAttribute ? (elB.getAttribute('class') || '') : '') + '';
    var hrefB = elementHref(elB);
    if (/s-pagination-next/.test(clsB) && tagB === 'A') {
      if (isNextPageHref(hrefB)) return resolveNextHref(hrefB);
      continue;
    }
    var textB = elementText(elB);
    if (!/^\s*next\s*$|→/i.test(textB) &&
        textB.toLowerCase().indexOf('go to next page') === -1) continue;
    if (tagB === 'A' && isNextPageHref(hrefB)) return resolveNextHref(hrefB);
  }

  return null;
}

function elementHref(el) {
  if (!el) return '';
  try {
    if (el.getAttribute) {
      var raw = el.getAttribute('href');
      if (raw) return raw;
    }
    if (typeof el.href === 'string' && el.href) return el.href;
  } catch (e) { /* best effort */ }
  return '';
}

function resolveNextHref(href) {
  try {
    if (typeof URL !== 'undefined' &&
        typeof document !== 'undefined' && document.baseURI) {
      return new URL(href, document.baseURI).toString();
    }
    if (typeof location !== 'undefined' && location.href &&
        typeof URL !== 'undefined') {
      return new URL(href, location.href).toString();
    }
  } catch (e) { /* fall through */ }
  return href;
}

function isNextPageHref(href) {
  if (typeof href !== 'string') return false;
  var trimmed = href.trim();
  if (!trimmed || trimmed === '#') return false;
  var lower = trimmed.toLowerCase();
  if (lower.indexOf('javascript:') === 0) return false;
  if (lower.indexOf('mailto:') === 0 || lower.indexOf('tel:') === 0) return false;
  if (/\/dp\/|\/gp\/product\/|\/gp\/aw\/|\/exec\/obidos\//i.test(trimmed)) return false;
  if (/product-reviews|customer-reviews|\/review\//i.test(trimmed)) return false;
  if (/\/gp\/cart|\/gp\/huc|\/hz\/cart|\/gp\/css|\/wishlist|\/list\/|\/gp\/buy|\/ap\/signin|\/gp\/your-account|\/gp\/css\/order-history|\/gp\/registry/i.test(trimmed)) return false;
  var isSearchPath = /\/s[\/?]/.test(trimmed);
  var hasSearchParam = /[?&#](k|rh|page|pg|bbn|i|rn|ref|__mk|dchild)=/i.test(trimmed);
  var hasPageParam = /[?&#](page|pg)=\d+/i.test(trimmed);
  if (!isSearchPath && !hasSearchParam) return false;
  if (hasPageParam || isSearchPath || hasSearchParam) return true;
  return false;
}

function canonicalPageUrl(url) {
  if (typeof url !== 'string') return '';
  var trimmed = url.trim();
  if (!trimmed) return '';
  try {
    if (typeof URL === 'undefined') return trimmed.split('#')[0];
    var base = (typeof document !== 'undefined' && document.baseURI)
      ? document.baseURI
      : ((typeof location !== 'undefined' && location.href) ? location.href : 'https://www.amazon.in/');
    var u = new URL(trimmed, base);
    return canonicalFromParts(u);
  } catch (e) {
    return trimmed.split('#')[0];
  }
}

function isVolatilePageParam(name) {
  var n = String(name || '').toLowerCase();
  if (!n) return false;
  if (n === 'ref' || n === 'psc' || n === 'qid' || n === 'sr' ||
      n === 'th' || n === 'keywords' || n === '__mk' || n === 'smid' ||
      n === 'dchild' || n === 'srs' || n === 'spia' || n === 'sp_ia' ||
      n === 'slot' || n === 'slotid') return true;
  if (n.indexOf('pd_') === 0) return true;
  if (n.indexOf('ref_') === 0) return true;
  if (n.indexOf('pf_rd_') === 0) return true;
  if (n.indexOf('pldn') === 0) return true;
  if (n === 'pf') return true;
  return false;
}

function canonicalFromParts(u) {
  var keep = [];
  var seen = {};
  var params = u.search ? u.search.slice(1).split('&') : [];
  for (var i = 0; i < params.length; i++) {
    var pair = params[i];
    if (!pair) continue;
    var eqIdx = pair.indexOf('=');
    var rawName = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    var name = '';
    try { name = decodeURIComponent(rawName); } catch (e) { name = rawName; }
    if (isVolatilePageParam(name)) continue;
    if (seen[pair]) continue;
    seen[pair] = true;
    keep.push(pair);
  }
  var sorted = keep.slice().sort().join('&');
  var host = (u.hostname || '').toLowerCase();
  var port = u.port || '';
  if ((u.protocol === 'https:' && port === '443') ||
      (u.protocol === 'http:' && port === '80')) port = '';
  var path = u.pathname || '/';
  if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
  return u.protocol + '//' + host + (port ? ':' + port : '') + path +
    (sorted ? '?' + sorted : '');
}

// ============================================================
// Flipkart Adapter
// ============================================================

function createFlipkartAdapter() {
  var api = {
    name: 'Flipkart',
    domains: ['flipkart.com'],
    implemented: true,
    extractProducts: extractFlipkartProducts,
    findLoadMoreTrigger: function() { return null; },
    findNextPageLink: findFlipkartNextPage,
    extractSearchQuery: extractFlipkartSearchQuery,
    getResultCardSelector: function() { return 'div[data-id]'; },
    detectSponsored: detectFlipkartSponsored,
    parseProduct: parseFlipkartProduct,
    isSearchPage: function(url) {
      if (typeof url !== 'string') return false;
      var u = url.toLowerCase();
      if (u.indexOf('/search?') !== -1) return true;
      if (u.indexOf('/pr?') !== -1) return true;
      if (/[?&#]q=/.test(u)) return true;
      if (/page=\d+/.test(u)) return true;
      return false;
    }
  };
  return api;
}

function extractFlipkartProducts() {
  var products = [];
  var cards = document.querySelectorAll('div[data-id]');
  for (var i = 0; i < cards.length; i++) {
    try {
      var product = parseFlipkartProduct(cards[i]);
      if (product && product.title) {
        products.push(product);
      }
    } catch (e) {
      // Skip items that fail to parse
    }
  }
  return products;
}

function parseFlipkartProduct(card) {
  if (!card || !card.querySelectorAll) return null;

  var title = extractFlipkartTitle(card);
  if (!title) return null;

  var isSponsored = detectFlipkartSponsored(card);

  var linkEl = card.querySelector('a[href*="/p/itm"]');
  var href = linkEl ? (linkEl.getAttribute('href') || '').trim() : '';
  var productUrl = href;
  var canonicalUrl = normalizeFlipkartUrl(href);
  var productId = extractFlipkartProductId(href);

  var price = extractFlipkartPrice(card);
  var rating = extractFlipkartRating(card);
  var reviewCount = extractFlipkartReviewCount(card);
  var image = extractFlipkartImage(card);

  return {
    title: title,
    price: price,
    rating: rating,
    reviewCount: reviewCount,
    image: image,
    url: productUrl || canonicalUrl,
    canonicalUrl: canonicalUrl,
    productId: productId,
    sponsored: isSponsored,
    source: 'Flipkart',
    marketplace: 'Flipkart'
  };
}

function extractFlipkartTitle(card) {
  var selectors = [
    '._4rR01T',
    'a._4rR01T',
    'div._4rR01T',
    '._2cLu-l',
    'a._2cLu-l',
    'div[class*="product-title"]',
    'div[class*="ProductTitle"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length >= 3) {
        return text;
      }
    }
  }
  // Fallback: first meaningful text from any link
  var links = card.querySelectorAll('a');
  for (var l = 0; l < links.length; l++) {
    var t = (links[l].textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length >= 5 && t.length < 300 && !/^\d+$/.test(t)) {
      return t;
    }
  }
  return null;
}

function extractFlipkartPrice(card) {
  var selectors = [
    '._30jeq3',
    'div._30jeq3',
    'span._30jeq3',
    '._1vC4OE',
    'div._1vC4OE',
    'span[class*="price"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var price = parseFlipkartPriceText(text);
      if (price !== null && price > 0) return price;
    }
  }
  // Fallback: scan for ₹ symbol
  var allText = card.textContent || '';
  var match = allText.match(/₹\s*([\d,]+)/);
  if (match) {
    var num = parseInt(match[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return null;
}

function parseFlipkartPriceText(text) {
  if (!text) return null;
  var cleaned = text
    .replace(/[₹,\s]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  var num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractFlipkartRating(card) {
  var selectors = [
    '._3LWZlK',
    'div._3LWZlK',
    'span._3LWZlK',
    '._2beYZw',
    '._1x2VEC',
    '._1nLEql',
    '[class*="rating"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var match = text.match(/(\d+(?:\.\d+)?)/);
      if (match) {
        var num = parseFloat(match[1]);
        if (!isNaN(num) && num >= 0 && num <= 5) {
          return num;
        }
      }
    }
  }
  return null;
}

function extractFlipkartReviewCount(card) {
  // Strategy 1: specific class for ratings/reviews count
  var reviewSelectors = [
    'span._2U9tEA',
    '._2U9tEA',
    'span[class*="rating-count"]',
    'span[class*="review-count"]'
  ];
  for (var s = 0; s < reviewSelectors.length; s++) {
    var els = card.querySelectorAll(reviewSelectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var count = parseFlipkartReviewText(text);
      if (count !== null && count > 0) return count;
    }
  }

  // Strategy 2: scan all spans for patterns like "(2,345)" or "2,345 Ratings"
  var spans = card.querySelectorAll('span');
  for (var i = 0; i < spans.length; i++) {
    var text = (spans[i].textContent || '').trim();
    if (!text || text.length > 60) continue;
    var count = parseFlipkartReviewText(text);
    if (count !== null && count > 0 && count < 100000000) {
      // Reject if it looks like a price or other number
      if (/[₹$€]/.test(text)) continue;
      if (/%/.test(text)) continue;
      return count;
    }
  }

  return null;
}

function parseFlipkartReviewText(text) {
  if (!text) return null;
  var lower = text.toLowerCase();

  // Pattern: "64,627 Ratings & 4,820 Reviews" → take the larger count (ratings)
  var ratingsMatch = lower.match(/([\d,]+)\s*ratings?/);
  if (ratingsMatch) {
    var num = parseInt(ratingsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // Pattern: "4,820 Reviews"
  var reviewsMatch = lower.match(/([\d,]+)\s*reviews?/);
  if (reviewsMatch) {
    var num = parseInt(reviewsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // Pattern: "(2,345)" or "2,345"
  var parenMatch = text.match(/\(([\d,]+)\)/);
  if (parenMatch) {
    var num = parseInt(parenMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // Pattern: "2,345" standalone
  var plainMatch = text.match(/^([\d,]+)$/);
  if (plainMatch) {
    var num = parseInt(plainMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

function extractFlipkartImage(card) {
  var imgs = card.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var src = imgs[i].getAttribute('src') || imgs[i].getAttribute('data-src') || '';
    if (!src) continue;
    if (/^data:/i.test(src)) continue;
    if (/sprites|icons|logo|placeholder/i.test(src)) continue;
    if (/rukminim2\.flixcart\.com|flipkart\.com\/images/i.test(src)) {
      return src;
    }
  }
  // Fallback: any non-data image
  for (var j = 0; j < imgs.length; j++) {
    var s = imgs[j].getAttribute('src') || '';
    if (s && !/^data:/i.test(s)) return s;
  }
  return null;
}

function normalizeFlipkartUrl(href) {
  if (!href) return null;
  if (href.indexOf('http') === 0) return href;
  return 'https://www.flipkart.com' + href;
}

function extractFlipkartProductId(href) {
  if (!href) return null;
  var m = href.match(/[?&]pid=([^&]+)/i);
  if (m) return m[1].toUpperCase();
  // Fallback: extract from /p/itm... path
  var itm = href.match(/\/p\/(?:itm[^/?]*)/i);
  if (itm) return itm[0].replace(/\/p\//, '').toUpperCase();
  return null;
}

function detectFlipkartSponsored(card) {
  if (!card || !card.textContent) return false;
  var text = card.textContent.toLowerCase();
  if (text.indexOf('sponsored') !== -1) return true;
  if (text.indexOf('ad') !== -1 && text.indexOf('add to cart') === -1) {
    // Weak signal: "Ad" alone is not enough; check for isolated "Ad" label
    var adMatch = card.textContent.match(/\bAd\b/);
    if (adMatch) return true;
  }
  // Check for specific sponsored label classes
  var sponsoredEls = card.querySelectorAll('[class*="sponsored"], [class*="ad-label"], [class*="adLabel"]');
  for (var i = 0; i < sponsoredEls.length; i++) {
    var t = (sponsoredEls[i].textContent || '').trim().toLowerCase();
    if (t === 'sponsored' || t === 'ad' || t === 'advertisement') return true;
  }
  return false;
}

function findFlipkartNextPage(root) {
  var container = root || (typeof document !== 'undefined' ? document.body : null);
  if (!container || !container.querySelectorAll) return null;

  // Strategy A: rel="next"
  var relNext = container.querySelector('a[rel="next"]');
  if (relNext && !isHidden(relNext)) {
    var href = relNext.getAttribute('href');
    if (href && isFlipkartNextPageHref(href)) {
      return normalizeFlipkartUrl(href);
    }
  }

  // Strategy B: class-based next button (common Flipkart pagination)
  var nextSelectors = [
    'a._1LKTO3',
    'a._3fVaIS',
    'a[class*="next"]',
    'a[class*="Next"]'
  ];
  for (var s = 0; s < nextSelectors.length; s++) {
    var els = container.querySelectorAll(nextSelectors[s]);
    for (var e = 0; e < els.length; e++) {
      if (isHidden(els[e])) continue;
      var text = (els[e].textContent || '').trim().toLowerCase();
      if (text.indexOf('next') !== -1 || text.indexOf('→') !== -1) {
        var h = els[e].getAttribute('href');
        if (h && isFlipkartNextPageHref(h)) {
          return normalizeFlipkartUrl(h);
        }
      }
    }
  }

  // Strategy C: any link whose text is exactly "Next"
  var clickables = container.querySelectorAll('a, button');
  for (var c = 0; c < clickables.length; c++) {
    if (isHidden(clickables[c])) continue;
    var t = (clickables[c].textContent || '').trim().toLowerCase();
    if (t === 'next' || t === 'next page') {
      var h2 = clickables[c].getAttribute('href');
      if (h2 && isFlipkartNextPageHref(h2)) {
        return normalizeFlipkartUrl(h2);
      }
    }
  }

  return null;
}

function isFlipkartNextPageHref(href) {
  if (typeof href !== 'string') return false;
  var trimmed = href.trim();
  if (!trimmed || trimmed === '#') return false;
  if (trimmed.indexOf('javascript:') === 0) return false;
  if (trimmed.indexOf('mailto:') === 0 || trimmed.indexOf('tel:') === 0) return false;
  // Must be a Flipkart search/category page link
  if (/\/search\?/.test(trimmed) || /\/.*\/pr\?/.test(trimmed) || /page=\d+/.test(trimmed)) return true;
  if (trimmed.indexOf('/p/') !== -1) return false; // product detail link
  return false;
}

function extractFlipkartSearchQuery(document, pageHref) {
  // Prefer live search input
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      var inputs = document.querySelectorAll('input[name="q"], input[placeholder*="Search"], input[aria-label*="Search"]');
      for (var i = 0; i < inputs.length; i++) {
        var val = (inputs[i].value || '').trim();
        if (val.length >= 2) return val.replace(/\s+/g, ' ');
      }
    }
  } catch (e) { /* best effort */ }

  // Fallback: URL parameter
  var href = pageHref || (typeof location !== 'undefined' ? location.href : '');
  if (!href) return '';
  try {
    var m = href.match(/[?&]q=([^&]+)/);
    if (m) {
      var raw = m[1].replace(/\+/g, ' ');
      try { raw = decodeURIComponent(raw); } catch (e2) { /* keep raw */ }
      return raw.trim();
    }
  } catch (e) {}
  return '';
}

function isHidden(el) {
  if (!el) return true;
  if (el.disabled === true) return true;
  if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) return true;
  return false;
}

function createMeeshoAdapter() {
  var api = {
    name: 'Meesho',
    domains: ['meesho.com'],
    implemented: true,
    extractProducts: extractMeeshoProducts,
    findLoadMoreTrigger: function() { return null; },
    findNextPageLink: findMeeshoNextPage,
    extractSearchQuery: extractMeeshoSearchQuery,
    getResultCardSelector: function() { return 'a[href*="/p/"]'; },
    detectSponsored: detectMeeshoSponsored,
    parseProduct: parseMeeshoProduct,
    isSearchPage: function(url) {
      if (typeof url !== 'string') return false;
      var u = url.toLowerCase();
      if (u.indexOf('/search?') !== -1) return true;
      if (/[?&#]q=/.test(u)) return true;
      if (u.indexOf('/pl/') !== -1) return true;
      return false;
    }
  };
  return api;
}

function extractMeeshoProducts() {
  var products = [];
  var links = document.querySelectorAll('a[href*="/p/"]');
  for (var i = 0; i < links.length; i++) {
    try {
      var href = (links[i].getAttribute('href') || '').trim();
      var lastP = href.lastIndexOf('/p/');
      if (lastP === -1) continue;
      var pid = href.slice(lastP + 3);
      pid = pid.split(/[?\/#]/)[0];
      if (!pid || pid.length < 3 || !/^[A-Za-z0-9]+$/.test(pid)) continue;
      var card = findProductCard(links[i]);
      if (!card) continue;
      var product = parseMeeshoProduct(card);
      if (product && product.title) {
        products.push(product);
      }
    } catch (e) { /* skip */ }
  }
  return products;
}

function findProductCard(link) {
  var node = link.parentNode;
  var depth = 0;
  while (node && depth < 10) {
    var tag = (node.tagName || '').toLowerCase();
    if (tag === 'div' && node.getAttribute && node.getAttribute('data-id')) return node;
    if (tag === 'div' && node.querySelectorAll && node.querySelectorAll('a[href*="/p/"]').length >= 1) {
      if (tag === 'div' && node.children && node.children.length > 0 && node.children.length <= 20) return node;
    }
    node = node.parentNode;
    depth++;
  }
  return link;
}

function parseMeeshoProduct(card) {
  if (!card || !card.querySelectorAll) return null;

  var title = extractMeeshoTitle(card);
  if (!title) return null;

  var isSponsored = detectMeeshoSponsored(card);

  var linkEl = card.querySelector('a[href*="/p/"]');
  var href = linkEl ? (linkEl.getAttribute('href') || '').trim() : '';
  var productUrl = href;
  var canonicalUrl = normalizeMeeshoUrl(href);
  var productId = extractMeeshoProductId(href);

  var price = extractMeeshoPrice(card);
  var rating = extractMeeshoRating(card);
  var reviewCount = extractMeeshoReviewCount(card);
  var image = extractMeeshoImage(card);

  return {
    title: title,
    price: price,
    rating: rating,
    reviewCount: reviewCount,
    image: image,
    url: productUrl || canonicalUrl,
    canonicalUrl: canonicalUrl,
    productId: productId,
    sponsored: isSponsored,
    source: 'Meesho',
    marketplace: 'Meesho'
  };
}

function extractMeeshoTitle(card) {
  var selectors = [
    '[data-testid="productTitle"]',
    'h3',
    'h2',
    'h4',
    'p',
    'a',
    'span[class*="Title"]',
    'span[class*="title"]',
    'div[class*="Title"]',
    'div[class*="title"]',
    'span[class*="Name"]',
    'span[class*="name"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length >= 3 && text.length < 300 && !/^\d+$/.test(text)) {
        if (/^[₹$€]/.test(text)) continue;
        return text;
      }
    }
  }
  var links = card.querySelectorAll('a');
  for (var l = 0; l < links.length; l++) {
    var t = (links[l].textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length >= 5 && t.length < 300 && !/^\d+$/.test(t)) {
      if (/^[₹$€]/.test(t)) continue;
      return t;
    }
  }
  return null;
}

function extractMeeshoPrice(card) {
  var selectors = [
    'span[class*="Price"]',
    'span[class*="price"]',
    'div[class*="Price"]',
    'div[class*="price"]',
    'span[class*="Selling"]',
    'span[class*="selling"]',
    'span[class*="MRP"]',
    'span[class*="Mrp"]',
    'span[class*="mrp"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var price = parseMeeshoPriceText(text);
      if (price !== null && price > 0) return price;
    }
  }
  var allText = card.textContent || '';
  var matches = allText.match(/₹\s*([\d,]+)/g);
  if (matches && matches.length > 0) {
    for (var i = matches.length - 1; i >= 0; i--) {
      var num = parseMeeshoPriceText(matches[i]);
      if (num !== null && num > 0) return num;
    }
  }
  var anyPriceEls = card.querySelectorAll('*');
  for (var j = 0; j < anyPriceEls.length; j++) {
    var t = (anyPriceEls[j].textContent || '').trim();
    if (!t || t.length > 30) continue;
    if (!/₹/.test(t)) continue;
    var p = parseMeeshoPriceText(t);
    if (p !== null && p > 0) return p;
  }
  return null;
}

function parseMeeshoPriceText(text) {
  if (!text) return null;
  var cleaned = text
    .replace(/[₹,\s]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  var num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractMeeshoRating(card) {
  var selectors = [
    '[class*="AverageRating"]',
    '[class*="Rating"]',
    '[class*="rating"]',
    'span[class*="rating"]',
    'div[class*="rating"]',
    'span[class*="Star"]',
    'span[class*="star"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var match = text.match(/(\d+(?:\.\d+)?)/);
      if (match) {
        var num = parseFloat(match[1]);
        if (!isNaN(num) && num >= 0 && num <= 5) {
          return num;
        }
      }
    }
  }
  return null;
}

function extractMeeshoReviewCount(card) {
  var selectors = [
    '[class*="Ratings"]',
    '[class*="Reviews"]',
    '[class*="ratings"]',
    '[class*="reviews"]',
    'span[class*="Rating"]',
    'span[class*="Review"]'
  ];
  for (var s = 0; s < selectors.length; s++) {
    var els = card.querySelectorAll(selectors[s]);
    for (var e = 0; e < els.length; e++) {
      var text = (els[e].textContent || '').trim();
      var count = parseMeeshoReviewText(text);
      if (count !== null && count > 0) return count;
    }
  }
  var spans = card.querySelectorAll('span');
  for (var i = 0; i < spans.length; i++) {
    var text = (spans[i].textContent || '').trim();
    if (!text || text.length > 60) continue;
    var count = parseMeeshoReviewText(text);
    if (count !== null && count > 0 && count < 100000000) {
      if (/[₹$€]/.test(text)) continue;
      if (/%/.test(text)) continue;
      return count;
    }
  }
  return null;
}

function parseMeeshoReviewText(text) {
  if (!text) return null;
  var lower = text.toLowerCase();

  var ratingsMatch = lower.match(/([\d,]+)\s*ratings?/);
  if (ratingsMatch) {
    var num = parseInt(ratingsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  var reviewsMatch = lower.match(/([\d,]+)\s*reviews?/);
  if (reviewsMatch) {
    var num = parseInt(reviewsMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  var parenMatch = text.match(/\(([\d,]+)\)/);
  if (parenMatch) {
    var num = parseInt(parenMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  var plainMatch = text.match(/^([\d,]+)$/);
  if (plainMatch) {
    var num = parseInt(plainMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

function extractMeeshoImage(card) {
  var imgs = card.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var src = imgs[i].getAttribute('src') || imgs[i].getAttribute('data-src') || '';
    if (!src) continue;
    if (/^data:/i.test(src)) continue;
    if (/sprites|icons|logo|placeholder|default/i.test(src)) continue;
    if (/meesho\.com|images\.meesho\.com/i.test(src)) {
      return src;
    }
  }
  for (var j = 0; j < imgs.length; j++) {
    var s = imgs[j].getAttribute('src') || '';
    if (s && !/^data:/i.test(s) && !/sprites|icons|logo|placeholder/i.test(s)) return s;
  }
  return null;
}

function normalizeMeeshoUrl(href) {
  if (!href) return null;
  if (href.indexOf('http') === 0) return href;
  return 'https://www.meesho.com' + href;
}

function extractMeeshoProductId(href) {
  if (!href) return null;
  var m2 = href.match(/[?&]pid=([A-Za-z0-9]+)/i);
  if (m2) return m2[1].toUpperCase();
  var lastP = href.lastIndexOf('/p/');
  if (lastP !== -1) {
    var id = href.slice(lastP + 3);
    id = id.split(/[?\/#]/)[0];
    if (id && /^[A-Za-z0-9]+$/.test(id) && id.length >= 3) return id.toUpperCase();
  }
  var m3 = href.match(/\/s\/p\/([A-Za-z0-9]+)/i);
  if (m3) return m3[1].toUpperCase();
  return null;
}

function detectMeeshoSponsored(card) {
  if (!card || !card.textContent) return false;
  var text = card.textContent.toLowerCase();
  if (text.indexOf('sponsored') !== -1) return true;
  if (text.indexOf('promoted') !== -1) return true;
  if (text.indexOf('ad') !== -1 && text.indexOf('add to cart') === -1) {
    var adMatch = card.textContent.match(/\bAd\b/);
    if (adMatch) return true;
  }
  var sponsoredEls = card.querySelectorAll('[class*="sponsored"], [class*="promoted"], [class*="ad-label"]');
  for (var i = 0; i < sponsoredEls.length; i++) {
    var t = (sponsoredEls[i].textContent || '').trim().toLowerCase();
    if (t === 'sponsored' || t === 'ad' || t === 'promoted' || t === 'advertisement') return true;
  }
  var goldEls = card.querySelectorAll('[class*="Gold"], [class*="gold"], [class*="badge"]');
  for (var j = 0; j < goldEls.length; j++) {
    var gt = (goldEls[j].textContent || '').trim();
    if (/meesho gold/i.test(gt)) return true;
  }
  return false;
}

function findMeeshoNextPage(root) {
  var container = root || (typeof document !== 'undefined' ? document.body : null);
  if (!container || !container.querySelectorAll) return null;

  var nextSelectors = [
    'a[rel="next"]',
    'a[class*="next"]',
    'a[class*="Next"]',
    'button[class*="next"]',
    'button[class*="Next"]'
  ];
  for (var s = 0; s < nextSelectors.length; s++) {
    var els = container.querySelectorAll(nextSelectors[s]);
    for (var e = 0; e < els.length; e++) {
      if (isHidden(els[e])) continue;
      if (els[e].disabled === true) continue;
      var text = (els[e].textContent || '').trim().toLowerCase();
      if (text.indexOf('next') !== -1 || text.indexOf('→') !== -1) {
        var href = els[e].getAttribute ? els[e].getAttribute('href') : '';
        if (href) {
          var fullUrl = normalizeMeeshoUrl(href);
          if (fullUrl && fullUrl.indexOf('meesho.com') !== -1) return fullUrl;
        }
      }
    }
  }

  var clickables = container.querySelectorAll('a, button');
  for (var c = 0; c < clickables.length; c++) {
    if (isHidden(clickables[c])) continue;
    var t = (clickables[c].textContent || '').trim().toLowerCase();
    if (t === 'next' || t === 'next page') {
      var h = clickables[c].getAttribute ? clickables[c].getAttribute('href') : '';
      if (h) {
        var fullUrl = normalizeMeeshoUrl(h);
        if (fullUrl && fullUrl.indexOf('meesho.com') !== -1) return fullUrl;
      }
    }
  }

  return null;
}

function extractMeeshoSearchQuery(document, pageHref) {
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      var inputs = document.querySelectorAll('input[name="q"], input[placeholder*="Search"], input[aria-label*="Search"]');
      for (var i = 0; i < inputs.length; i++) {
        var val = (inputs[i].value || '').trim();
        if (val.length >= 2) return val.replace(/\s+/g, ' ');
      }
    }
  } catch (e) { /* best effort */ }

  var href = pageHref || (typeof location !== 'undefined' ? location.href : '');
  if (!href) return '';
  try {
    var m = href.match(/[?&]q=([^&]+)/);
    if (m) {
      var raw = m[1].replace(/\+/g, ' ');
      try { raw = decodeURIComponent(raw); } catch (e2) { /* keep raw */ }
      return raw.trim();
    }
  } catch (e) {}
  return '';
}

function createMyntraAdapter() {
  return {
    name: 'Myntra',
    domains: ['myntra.com'],
    implemented: false,
    extractProducts: function() { return []; },
    findLoadMoreTrigger: function() { return null; },
    findNextPageLink: function() { return null; },
    extractSearchQuery: function() { return ''; },
    getResultCardSelector: function() { return ''; },
    isSearchPage: function() { return false; }
  };
}
