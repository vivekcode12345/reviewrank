// ReviewRank Content Script — Site-Aware Product Extraction
// Runs on Amazon / Flipkart / Meesho / Myntra pages. Reads the live DOM
// of the current search results page via registered site adapters.

(function() {
  'use strict';

  var _adapters = null;
  var _amazonAdapter = null;
  try {
    if (typeof window !== 'undefined' && window.ReviewRankAdapters) {
      _adapters = window.ReviewRankAdapters;
    } else if (typeof globalThis !== 'undefined' && globalThis.ReviewRankAdapters) {
      _adapters = globalThis.ReviewRankAdapters;
    } else if (typeof module !== 'undefined') {
      _adapters = require('../lib/site-adapters.js');
    }
  } catch (e) { _adapters = null; }
  if (_adapters) {
    try { _amazonAdapter = _adapters.getAdapterForDomain('amazon.in'); } catch (e) { _amazonAdapter = null; }
    if (!_amazonAdapter) {
      try { _amazonAdapter = _adapters.getAdapterForDomain('amazon.com'); } catch (e) { _amazonAdapter = null; }
    }
  }

  function getCurrentAdapterSafe() {
    if (!_adapters) return null;
    try { return _adapters.getAdapterForCurrentSite(); } catch (e) { return null; }
  }

  function extractProductsSiteAware() {
    var adapter = getCurrentAdapterSafe();
    if (adapter && adapter.implemented && typeof adapter.extractProducts === 'function') {
      try { return adapter.extractProducts(typeof document !== 'undefined' ? document : null); } catch (e) {}
    }
    if (_amazonAdapter && typeof _amazonAdapter.extractProducts === 'function') {
      try { return _amazonAdapter.extractProducts(typeof document !== 'undefined' ? document : null); } catch (e) {}
    }
    return [];
  }

  function findLoadMoreTriggerSiteAware() {
    var adapter = getCurrentAdapterSafe();
    if (adapter && typeof adapter.findLoadMoreTrigger === 'function') {
      try { return adapter.findLoadMoreTrigger(typeof document !== 'undefined' ? document.body : null); } catch (e) {}
    }
    if (_amazonAdapter && typeof _amazonAdapter.findLoadMoreTrigger === 'function') {
      try { return _amazonAdapter.findLoadMoreTrigger(typeof document !== 'undefined' ? document.body : null); } catch (e) {}
    }
    return null;
  }

  function findNextPageLinkSiteAware() {
    var adapter = getCurrentAdapterSafe();
    if (adapter && typeof adapter.findNextPageLink === 'function') {
      try { return adapter.findNextPageLink(typeof document !== 'undefined' ? document.body : null); } catch (e) {}
    }
    if (_amazonAdapter && typeof _amazonAdapter.findNextPageLink === 'function') {
      try { return _amazonAdapter.findNextPageLink(typeof document !== 'undefined' ? document.body : null); } catch (e) {}
    }
    return null;
  }

  function extractSearchQuerySiteAware(pageHref) {
    var adapter = getCurrentAdapterSafe();
    if (adapter && typeof adapter.extractSearchQuery === 'function') {
      try { return adapter.extractSearchQuery(typeof document !== 'undefined' ? document : null, pageHref); } catch (e) {}
    }
    if (_amazonAdapter && typeof _amazonAdapter.extractSearchQuery === 'function') {
      try { return _amazonAdapter.extractSearchQuery(typeof document !== 'undefined' ? document : null, pageHref); } catch (e) {}
    }
    return '';
  }

  // Stable identity for a product — used to isolate newly-loaded products from
  // ones already extracted (productId/ASIN is the source of truth, fallback to URL).
  // Supports both normalized (productId/source) and legacy (asin/marketplace) fields.
  function productKey(product) {
    if (!product || typeof product !== 'object') return '';
    var pid = product.productId || product.asin;
    if (pid) {
      var src = product.source || product.marketplace || '';
      return 'id:' + pid + (src ? ':' + src : '');
    }
    if (product.canonicalUrl) return 'url:' + product.canonicalUrl;
    if (product.url) return 'url:' + product.url;
    return 'untitled:' + (typeof product.title === 'string' ? product.title : '');
  }

  // Listen for messages from the popup (guarded for non-browser test environments)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'scrapeAmazon') {
        try {
          const products = extractProductsSiteAware();
          var pageHref = '';
          try {
            pageHref = (typeof location !== 'undefined' && location.href) ? location.href : '';
          } catch (e) { pageHref = ''; }
          sendResponse({
            success: true,
            products: products,
            moreAvailable: !!findLoadMoreTriggerSiteAware(),
            nextPageUrl: findNextPageLinkSiteAware(),
            pageUrl: pageHref,
            searchQuery: extractSearchQuerySiteAware(pageHref)
          });
        } catch (err) {
          console.error('ReviewRank scrape error:', err);
          sendResponse({ success: false, error: err.message });
        }
        return true;
      }
      if (message.action === 'loadMoreAmazon') {
        try {
          loadMoreAndExtractAsync(function (response) {
            sendResponse(response);
          });
        } catch (err) {
          console.error('ReviewRank load-more error:', err);
          sendResponse({ success: false, error: err.message });
        }
        return true;
      }
    });
  }

  // Loads additional results and returns only the newly-added products.
  // Delegates extraction and trigger logic to the current site adapter.
  function loadMoreAndExtractAsync(callback) {
    var trigger = findLoadMoreTriggerSiteAware();
    if (!trigger) {
      callback({ success: true, products: [], moreAvailable: false, newCount: 0 });
      return;
    }

    var before = extractProductsSiteAware();
    var beforeCount = before.length;
    var seenKeys = {};
    for (var i = 0; i < before.length; i++) {
      seenKeys[productKey(before[i])] = true;
    }

    var triggerFn = _amazonAdapter ? _amazonAdapter.triggerAmazonLoadMore : null;
    if (triggerFn && typeof triggerFn === 'function') {
      try { triggerFn(trigger); } catch (e) { /* best effort */ }
    } else {
      try { trigger.click(); } catch (e) { /* best effort */ }
    }

    var SETTLE_MS = 500;
    var TIMEOUT_MS = 2500;
    var done = false;
    var timeoutId = null;
    var settleTimer = null;
    var observer = null;

    function cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      if (settleTimer) clearTimeout(settleTimer);
      if (observer) try { observer.disconnect(); } catch (e) {}
    }

    function finish() {
      if (done) return;
      done = true;
      cleanup();

      var after = extractProductsSiteAware();
      var newProducts = [];
      var keys = {};
      var k;
      for (k in seenKeys) { keys[k] = seenKeys[k]; }
      for (var j = 0; j < after.length; j++) {
        var key = productKey(after[j]);
        if (!keys[key]) {
          keys[key] = true;
          newProducts.push(after[j]);
        }
      }

      var moreAvailable = !!findLoadMoreTriggerSiteAware();

      callback({
        success: true,
        products: newProducts,
        moreAvailable: moreAvailable,
        newCount: newProducts.length,
        totalProducts: after.length
      });
    }

    timeoutId = setTimeout(finish, TIMEOUT_MS);

    var cardSelector = '[data-component-type="s-search-result"]';
    try {
      if (_amazonAdapter && typeof _amazonAdapter.getResultCardSelector === 'function') {
        cardSelector = _amazonAdapter.getResultCardSelector();
      }
    } catch (e) { /* keep default */ }

    try {
      observer = new MutationObserver(function () {
        if (done) return;
        var curCount = document.querySelectorAll(cardSelector).length;
        if (curCount > beforeCount) {
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, SETTLE_MS);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      // MutationObserver unavailable — rely on the hard timeout only.
    }
  }

  // Expose internals for unit testing (no-op inside the browser extension)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      detectSponsored: _amazonAdapter ? _amazonAdapter.detectSponsored : null,
      parseAmazonProduct: _amazonAdapter ? _amazonAdapter.parseAmazonProduct : null,
      extractTitle: _amazonAdapter ? _amazonAdapter.extractTitle : null,
      extractAsin: _amazonAdapter ? _amazonAdapter.extractAsin : null,
      extractProductUrl: _amazonAdapter ? _amazonAdapter.extractProductUrl : null,
      extractImageUrl: _amazonAdapter ? _amazonAdapter.extractImageUrl : null,
      srcsetToUrl: _amazonAdapter ? _amazonAdapter.srcsetToUrl : null,
      extractPrice: _amazonAdapter ? _amazonAdapter.extractPrice : null,
      extractRating: _amazonAdapter ? _amazonAdapter.extractRating : null,
      extractReviewCount: _amazonAdapter ? _amazonAdapter.extractReviewCount : null,
      parseIndianNumber: _amazonAdapter ? _amazonAdapter.parseIndianNumber : null,
      parseReviewCountText: _amazonAdapter ? _amazonAdapter.parseReviewCountText : null,
      isPlausibleReviewCount: _amazonAdapter ? _amazonAdapter.isPlausibleReviewCount : null,
      normalizeAmazonUrl: _amazonAdapter ? _amazonAdapter.normalizeAmazonUrl : null,
      extractAsinFromUrl: _amazonAdapter ? _amazonAdapter.extractAsinFromUrl : null,
      findLoadMoreTrigger: _amazonAdapter ? _amazonAdapter.findLoadMoreTrigger : null,
      triggerAmazonLoadMore: _amazonAdapter ? _amazonAdapter.triggerAmazonLoadMore : null,
      findNextPageLink: _amazonAdapter ? _amazonAdapter.findNextPageLink : null,
      isNextPageHref: _amazonAdapter ? _amazonAdapter.isNextPageHref : null,
      canonicalPageUrl: _amazonAdapter ? _amazonAdapter.canonicalPageUrl : null,
      loadMoreAndExtractAsync: loadMoreAndExtractAsync,
      productKey: productKey,
      getSearchInputValue: _amazonAdapter ? _amazonAdapter.getSearchInputValue : null,
      getQueryParamK: _amazonAdapter ? _amazonAdapter.getQueryParamK : null,
      extractSearchQueryContent: _amazonAdapter ? _amazonAdapter.extractSearchQueryContent : null
    };
  }
})();
