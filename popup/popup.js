document.addEventListener('DOMContentLoaded', function() {
  var UI = window.ReviewRankUI;
  var initialState = document.getElementById('initialState');
  var errorState = document.getElementById('errorState');
  var resultsState = document.getElementById('resultsState');
  var errorText = document.getElementById('errorText');
  var errorHint = document.getElementById('errorHint');
  var productsList = document.getElementById('productsList');
  var resultsCount = document.getElementById('resultsCount');
  var resultsSub = document.getElementById('resultsSub');
  var resultsNote = document.getElementById('resultsNote');
  var analyzeBtn = document.getElementById('analyzeBtn');
  var btnLabel = document.getElementById('btnLabel');
  var btnSpinner = analyzeBtn.querySelector('.btn-spinner');
  var loadingStatus = document.getElementById('loadingStatus');
  var minPriceInput = document.getElementById('minPrice');
  var maxPriceInput = document.getElementById('maxPrice');
  var isAnalyzing = false;
  var BTN_LABEL_DEFAULT = 'Analyze This Page';
  var LOADING_TEXT = 'Analyzing products...';

  // allProducts holds the RAW (unranked) union of products gathered so far
  // across the initial scrape and every load-more operation. The full pipeline
  // (dedup -> validate -> budget -> sponsored -> sort) is re-run on this entire
  // set every time, guaranteeing ONE global ranking.
  var allProducts = [];
  var currentBudget = { min: null, max: null };
  var lastRanked = [];
  // --- Category relevance (#8) state ---
  // currentSearchQuery is the raw Amazon search query for this analysis
  // (from the content script's search input, falling back to the tab URL).
  // relevanceActive = filtering ran on the current result set;
  // relevanceAvailable = a usable query was found (else ranking is unchanged).
  var currentSearchQuery = '';
  var relevanceActive = false;
  var relevanceAvailable = false;
  // --- Pagination (#7) state ---
  // pagesAnalyzed counts analyzed search-result pages (starts at 1).
  // visitedPages holds CANONICAL page URLs to prevent loops.
  // nextPageUrl is the raw next-page URL from the content script.
  var MAX_PAGES = 5;
  var pagesAnalyzed = 1;
  var visitedPages = new Set();
  var nextPageUrl = null;
  var originPageUrl = null;
  var isPaginating = false;

  var PAGE_SIZE = 4;
  var currentDisplayPage = 1;

  var paginationUI = document.getElementById('uiPagination');
  var uiPrevBtn = document.getElementById('uiPrevBtn');
  var uiPageBtn = document.getElementById('uiPageBtn');
  var uiPageLabel = document.getElementById('uiPageLabel');
  var uiPageNumbers = document.getElementById('uiPageNumbers');
  var changeBudgetBtn = document.getElementById('changeBudgetBtn');

  function setLoading(loading) {
    isAnalyzing = loading;
    analyzeBtn.disabled = loading;
    analyzeBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (loading) {
      btnLabel.textContent = LOADING_TEXT;
      btnSpinner.style.display = 'inline-block';
      loadingStatus.textContent = LOADING_TEXT;
      loadingStatus.style.display = 'block';
    } else {
      btnLabel.textContent = BTN_LABEL_DEFAULT;
      btnSpinner.style.display = 'none';
      loadingStatus.textContent = '';
      loadingStatus.style.display = 'none';
    }
  }

  analyzeBtn.addEventListener('click', function() {
    if (isAnalyzing) return; // prevent accidental repeated clicks
    setLoading(true);

    // Parse and validate budget inputs
    var budget = parseBudgetInput(minPriceInput.value, maxPriceInput.value);
    if (budget.error) {
      setLoading(false);
      showError(budget.error);
      return;
    }

    // Reset pagination AND display state for a fresh analysis
    allProducts = [];
    pagesAnalyzed = 1;
    visitedPages = new Set();
    nextPageUrl = null;
    originPageUrl = null;
    isPaginating = false;
    currentDisplayPage = 1;
    currentSearchQuery = '';
    relevanceActive = false;
    relevanceAvailable = false;
    if (typeof updatePaginationSection === 'function') {
      try { updatePaginationSection(false, true); } catch (e) {}
    }

    analyze(function(err, products, moreAvailable, fullResponse) {
      setLoading(false);

      if (err) {
        showError(UI.friendlyErrorMessage(err));
        return;
      }

      if (!products || products.length === 0) {
        showError(UI.MESSAGES.noProducts, UI.MESSAGES.noProductsHint);
        return;
      }

      // Resolve the Amazon search query (content input wins, tab URL fallback).
      // Relevance filtering runs inside processProducts BEFORE review-count sort.
      currentSearchQuery = resolveSearchQuery(
        fullResponse && fullResponse.searchQuery,
        fullResponse && fullResponse.pageUrl
      );

      // Run the SAME pipeline
      // (dedup -> validate -> relevance -> budget -> sponsored -> sort).
      // processProducts shows the appropriate empty-state error on its own.
      var ranked = processProducts(products, budget, true, currentSearchQuery);
      if (!ranked) return;

      // Persist the RAW union of products + budget + query so load-more AND
      // pagination can re-run the identical pipeline on the merged set
      // (ONE global ranking, ONE shared relevance function).
      allProducts = products.slice();
      currentBudget = budget;
      lastRanked = ranked;

      // Pagination state: record the analyzed page + next-page link.
      pagesAnalyzed = 1;
      nextPageUrl = (fullResponse && fullResponse.nextPageUrl) || null;
      originPageUrl = (fullResponse && fullResponse.pageUrl) || null;
      try {
        if (originPageUrl) visitedPages.add(canonicalPageUrlLocal(originPageUrl));
      } catch (e) {}

      showResults(ranked, budget.min, budget.max);
      updatePaginationSection(!!nextPageUrl);
    });
  });

  function parseBudgetInput(minRaw, maxRaw) {
    var minStr = (minRaw || '').trim().replace(/[₹,\s]/g, '');
    var maxStr = (maxRaw || '').trim().replace(/[₹,\s]/g, '');

    // Both empty = no budget filter
    if (minStr === '' && maxStr === '') {
      return { min: null, max: null };
    }

    var min = null;
    var max = null;

    if (minStr !== '') {
      min = parseFloat(minStr);
      if (isNaN(min) || min < 0) {
        return { error: 'Please enter a valid minimum price.' };
      }
    }

    if (maxStr !== '') {
      max = parseFloat(maxStr);
      if (isNaN(max) || max < 0) {
        return { error: 'Please enter a valid maximum price.' };
      }
    }

    if (min !== null && max !== null && min > max) {
      return { error: 'Minimum price cannot be greater than maximum price.' };
    }

    return { min: min, max: max };
  }

  function filterByPriceRange(products, minPrice, maxPrice) {
    // No filter applied
    if (minPrice === null && maxPrice === null) {
      return products;
    }

    var result = [];
    for (var i = 0; i < products.length; i++) {
      var product = products[i];

      // If product has no parseable price, exclude it when a budget filter is active
      if (product.price == null || product.price === 0) {
        continue;
      }

      if (minPrice !== null && product.price < minPrice) {
        continue;
      }

      if (maxPrice !== null && product.price > maxPrice) {
        continue;
      }

      result.push(product);
    }
    return result;
  }

  function sortByReviewCount(products) {
    var copy = products.slice();
    copy.sort(function(a, b) {
      // Review-count DESC. A null reviewCount is treated as "-1" so a
      // product with a null count can NEVER outrank any valid count
      // (including 0) and always lands at the bottom of the ranking.
      var aCount = (typeof a.reviewCount === 'number' && isFinite(a.reviewCount)) ? a.reviewCount : -1;
      var bCount = (typeof b.reviewCount === 'number' && isFinite(b.reviewCount)) ? b.reviewCount : -1;
      return bCount - aCount;
    });
    return copy;
  }

  function excludeSponsoredProducts(products) {
    var result = [];
    for (var i = 0; i < products.length; i++) {
      if (!products[i].isSponsored) {
        result.push(products[i]);
      }
    }
    return result;
  }

  function deduplicateProducts(products) {
    var seen = {};       // key -> best product record
    var order = [];      // preserves insertion order of keys

    for (var i = 0; i < products.length; i++) {
      var product = products[i];
      var key = getProductKey(product, i);

      if (seen.hasOwnProperty(key)) {
        // Duplicate found — keep the most complete record
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
    // PRIMARY: ASIN (most reliable unique identifier)
    if (product.asin) {
      return 'asin:' + product.asin;
    }
    // FALLBACK: normalized canonical URL
    if (product.canonicalUrl) {
      return 'url:' + product.canonicalUrl;
    }
    // SAFETY: no ASIN and no URL — treat as unique so unrelated
    // products (even with similar titles) are never merged.
    return 'fallback:' + index;
  }

  function mergeProductRecords(existing, incoming) {
    // A sponsored occurrence must never override the organic occurrence of
    // the same product — organic listings win regardless of data completeness.
    if (!existing.isSponsored && incoming.isSponsored) {
      return existing;
    }
    if (existing.isSponsored && !incoming.isSponsored) {
      return incoming;
    }
    // Same sponsorship status — keep the more complete record
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

  function getAdapterForUrl(url) {
    try {
      if (typeof window !== 'undefined' && window.ReviewRankAdapters && url) {
        return window.ReviewRankAdapters.getAdapterForDomain(
          (new URL(url)).hostname.toLowerCase()
        );
      }
    } catch (e) {}
    return null;
  }

  function getSiteName(adapter) {
    return (adapter && adapter.name) ? adapter.name : 'this site';
  }

    // Send a message to the content script of the active tab. When urlCheck is
  // true the active tab must be an Amazon search-results page (initial analyze).
  // When false we skip that check — load-more already validated the context.
  function sendTabMessage(action, urlCheck, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        callback({ success: false, error: 'Cannot access the current tab. Please try again.' });
        return;
      }

      var tab = tabs[0];
      var url = tab.url || '';
      var adapter = getAdapterForUrl(url);

      if (urlCheck) {
        if (!adapter) {
          callback({ success: false, error: 'Open a supported shopping site search-results page first.' });
          return;
        }
        var isSearch = adapter.isSearchPage ? adapter.isSearchPage(url) : false;
        if (!isSearch) {
          callback({ success: false, error: 'Navigate to a ' + getSiteName(adapter) + ' search results page first.' });
          return;
        }
      }

      chrome.tabs.sendMessage(tab.id, { action: action }, function(response) {
        if (chrome.runtime.lastError) {
          // Content script may not be injected yet — inject once and retry.
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js']
          }, function() {
            if (chrome.runtime.lastError) {
              callback({ success: false, error: 'Could not analyze this page. Please refresh the Amazon page and try again.' });
              return;
            }
            setTimeout(function() {
              chrome.tabs.sendMessage(tab.id, { action: action }, function(r2) {
                if (chrome.runtime.lastError) {
                  callback({ success: false, error: 'Could not analyze this page. Please refresh and try again.' });
                } else {
                  callback(r2 || { success: false, error: 'Could not analyze this page. Please refresh the Amazon page and try again.' });
                }
              });
            }, 500);
          });
          return;
        }
        callback(response || { success: false, error: 'Could not analyze this page. Please refresh the Amazon page and try again.' });
      });
    });
  }

  // Initial scrape: callback(err, products, moreAvailable, fullResponse)
  // fullResponse also carries nextPageUrl + pageUrl + searchQuery.
  function analyze(callback) {
    getActiveTabUrl(function(tabUrl) {
      sendTabMessage('scrapeAmazon', true, function(response) {
        if (!response || !response.success) {
          callback(response ? response.error : 'Could not analyze this page. Please refresh the Amazon page and try again.');
          return;
        }
        if (response && !response.pageUrl && tabUrl) response.pageUrl = tabUrl;
        // Fallback: if the content script could not read the search input
        // (e.g. lib not yet loaded), resolve the query from the tab URL here.
        try {
          if (response && !response.searchQuery && tabUrl) {
            var fb = resolveSearchQuery('', tabUrl);
            if (fb) response.searchQuery = fb;
          }
        } catch (e) {}
        callback(null, response.products || [], !!response.moreAvailable, response);
      });
    });
  }

  // Current active-tab URL (used as the pagination origin / visited marker).
  function getActiveTabUrl(callback) {
    try {
      if (!chrome.tabs || !chrome.tabs.query) { callback(null); return; }
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        try {
          callback(tabs && tabs[0] ? (tabs[0].url || null) : null);
        } catch (e) { callback(null); }
      });
    } catch (e) { callback(null); }
  }

  // Load-more: callback receives the raw content-script response object.
  function loadMoreProducts(callback) {
    sendTabMessage('loadMoreAmazon', false, callback);
  }

  // Category relevance (#8) helpers — ONE shared implementation from
  // lib/category-relevance.js. Query resolution prefers the content script's
  // live search-input value and falls back to the tab URL `k` parameter.
  // When no query is available we do NOT filter (ranking is unchanged).
  function getRelevanceLib() {
    try {
      if (typeof window !== 'undefined' && window.ReviewRankRelevance) return window.ReviewRankRelevance;
    } catch (e) {}
    try {
      if (typeof globalThis !== 'undefined' && globalThis.ReviewRankRelevance) return globalThis.ReviewRankRelevance;
    } catch (e) {}
    return null;
  }

  function resolveSearchQuery(contentQuery, tabUrl) {
    var cq = (typeof contentQuery === 'string') ? contentQuery.trim().replace(/\s+/g, ' ') : '';
    if (cq.length >= 1) return cq;
    var url = (typeof tabUrl === 'string') ? tabUrl : '';
    if (!url) return '';
    try {
      var R = getRelevanceLib();
      if (R && R.extractSearchQueryFromUrl) {
        var adapter = getAdapterForUrl(url);
        var k = R.extractSearchQueryFromUrl(url, adapter);
        if (k) return k;
      }
    } catch (e) {}
    try {
      var m = url.match(/[?&#](k|q|search)=([^&#]*)/);
      if (!m) return '';
      var raw = m[2].replace(/\+/g, ' ');
      try { raw = decodeURIComponent(raw); } catch (e2) { /* keep raw */ }
      return raw.trim();
    } catch (e) { return ''; }
  }

  // Applies the shared relevance filter. Returns
  // { products, active, available }: active = filtering ran on a usable
  // query; available = false means "no query → keep everything".
  function applyRelevanceFilter(validProducts, searchQuery) {
    try {
      var R = getRelevanceLib();
      if (!R || !R.filterRelevantProducts) {
        return { products: validProducts, active: false, available: false };
      }
      var res = R.filterRelevantProducts(validProducts, searchQuery || '');
      if (!res || !res.available) {
        return { products: validProducts, active: false, available: false };
      }
      return {
        products: res.relevant,
        active: true,
        available: true,
        removed: res.removed || 0,
        queryUsed: res.queryUsed || ''
      };
    } catch (e) {
      return { products: validProducts, active: false, available: false };
    }
  }

  // The SINGLE source of truth for the ranking pipeline — used for the
  // initial analysis, every load-more re-run AND every pagination merge, so
  // there is never a second ranking algorithm:
  //   dedup -> validate -> relevance -> budget filter -> sponsored -> sort DESC
  // Relevance runs BEFORE review-count sorting: a LOW-relevance 100k-rating
  // product can never outrank a HIGH-relevance 5k-rating product.
  // (Budget/sponsored order after relevance is equivalent for correctness and
  // keeps the pipeline efficient; relevance always precedes the sort.)
  // When showErrors is true, empty stages surface their user-facing error;
  // when false (load-more/pagination re-runs) they stay silent and return null.
  function processProducts(products, budget, showErrors, searchQuery) {
    var V = window.ReviewRankValidation;
    var unique = deduplicateProducts(products);

    if (!unique || unique.length === 0) {
      if (showErrors) showError(UI.MESSAGES.noProducts, UI.MESSAGES.noProductsHint);
      return null;
    }

    var valid = V.validateProducts(unique);

    if (!valid || valid.length === 0) {
      if (showErrors) showError(UI.MESSAGES.noProducts, UI.MESSAGES.noProductsHint);
      return null;
    }

    // --- Category relevance (#8): conservative LOW-only exclusion ---
    var rel = applyRelevanceFilter(valid, searchQuery);
    relevanceActive = !!(rel && rel.active);
    relevanceAvailable = !!(rel && rel.available);
    var relevant = (rel && rel.products) || valid;

    if (!relevant || relevant.length === 0) {
      // Products WERE detected but none match the search intent.
      if (showErrors) showError(UI.MESSAGES.noRelevant, UI.MESSAGES.noRelevantHint);
      return null;
    }

    var filtered = filterByPriceRange(relevant, budget.min, budget.max);

    if (!filtered || filtered.length === 0) {
      if (showErrors) showError(UI.MESSAGES.budgetNoMatch, UI.MESSAGES.budgetNoMatchHint);
      return null;
    }

    var organic = excludeSponsoredProducts(filtered);

    if (!organic || organic.length === 0) {
      if (showErrors) showError(UI.MESSAGES.allSponsored, UI.MESSAGES.allSponsoredHint);
      return null;
    }

    // Sort by review count descending (null-count always sorts below any valid
    // count, including 0). Ranks are assigned contiguously on render.
    return sortByReviewCount(organic);
  }


  function showError(message, hint) {
    initialState.style.display = 'none';
    resultsState.style.display = 'none';
    errorState.style.display = 'block';
    errorText.textContent = UI.friendlyErrorMessage(message);
    if (hint) {
      errorHint.textContent = hint;
      errorHint.style.display = 'block';
    } else {
      errorHint.style.display = 'none';
    }
  }

  function showInitialState() {
    initialState.style.display = 'block';
    resultsState.style.display = 'none';
    errorState.style.display = 'none';
    currentDisplayPage = 1;
  }

  function showResults(products, minPrice, maxPrice) {
    initialState.style.display = 'none';
    errorState.style.display = 'none';
    resultsState.style.display = 'block';

    // Header: "8 PRODUCTS FOUND" or "8 RELEVANT PRODUCTS FOUND" when
    // relevance filtering is active (never exposes raw scores).
    var relOn = !!(relevanceActive && relevanceAvailable);
    resultsCount.textContent = UI.resultsHeaderText(products.length, minPrice, maxPrice, relOn);

    // "RANKED BY CUSTOMER RATING COUNT" + analyzed-pages progress.
    // Stays compact: "RANKED BY CUSTOMER RATING COUNT · 2 PAGES ANALYZED".
    var sub = UI.RESULTS_SUBTEXT;
    try {
      if (pagesAnalyzed > 1) sub += ' · ' + pagesMessage(pagesAnalyzed);
    } catch (e) {}
    resultsSub.textContent = sub;

    // Explanation + subtle disclaimer near the results.
    // Relevance note stays small; unavailable queries stay honest.
    var note = UI.RANKED_BY_NOTE + ' — ' + UI.POPULARITY_DISCLAIMER;
    try {
      if (relOn && UI.RELEVANCE_NOTE) {
        note += ' ' + UI.RELEVANCE_NOTE + '.';
      } else if (!relevanceAvailable && UI.RELEVANCE_UNAVAILABLE_NOTE) {
        note += ' ' + UI.RELEVANCE_UNAVAILABLE_NOTE + '.';
      }
    } catch (e) {}
    resultsNote.textContent = note;

    // --- Price insights (#9): computed from the FINAL ranked set only ---
    // (deduped + validated + relevance-filtered + in-budget + organic).
    // Insight-only: rank order (review count) is never touched.
    // Recalculated on every showResults call, so Load More and Pagination
    // update automatically across the whole merged set.
    var priceStats = null;
    try {
      var PI = getPriceLib();
      if (PI && PI.calculatePriceStats) {
        priceStats = PI.calculatePriceStats(products);
      } else {
        priceStats = fallbackPriceStats(products);
      }
    } catch (e) {
      try { priceStats = fallbackPriceStats(products); } catch (e2) { priceStats = null; }
    }
    renderPriceInsights(priceStats, minPrice, maxPrice, products.length);

    productsList.innerHTML = '';

    var totalPages = (typeof ReviewRankPagination !== 'undefined')
      ? ReviewRankPagination.getTotalPages(products)
      : (Math.ceil(products.length / PAGE_SIZE) || (products.length > 0 ? 1 : 0));

    var startIdx = (currentDisplayPage - 1) * PAGE_SIZE;
    var endIdx = Math.min(startIdx + PAGE_SIZE, products.length);

    for (var i = startIdx; i < endIdx; i++) {
      var rank = i + 1;
      var insight = null;
      try {
        if (UI.productPriceInsightText && priceStats && priceStats.hasPrices) {
          insight = UI.productPriceInsightText(products[i], priceStats);
        }
      } catch (e) { insight = null; }
      var card = document.createElement('div');
      card.innerHTML = UI.buildProductCardHTML(products[i], rank, insight);
      var cardEl = card.firstElementChild;
      if (cardEl) {
        productsList.appendChild(cardEl);
      }
    }

    updateUIPagination(products, totalPages);
  }

  function updateUIPagination(products, totalPages) {
    if (!paginationUI) return;
    var productCount = products ? products.length : 0;
    if (!productCount || totalPages <= 1) {
      paginationUI.style.display = 'none';
      return;
    }
    paginationUI.style.display = 'block';

    var range = (typeof ReviewRankPagination !== 'undefined')
      ? ReviewRankPagination.getPageRange(currentDisplayPage, products)
      : { start: (currentDisplayPage - 1) * PAGE_SIZE + 1, end: Math.min(currentDisplayPage * PAGE_SIZE, productCount), total: productCount };
    if (uiPageLabel) {
      uiPageLabel.textContent = range.start + '-' + range.end + ' of ' + range.total;
    }

    if (uiPrevBtn) {
      if (currentDisplayPage <= 1) {
        uiPrevBtn.style.display = 'none';
      } else {
        uiPrevBtn.style.display = 'inline-flex';
        uiPrevBtn.disabled = false;
      }
    }

    if (uiPageBtn) {
      if (currentDisplayPage >= totalPages) {
        uiPageBtn.style.display = 'none';
      } else {
        uiPageBtn.style.display = 'inline-flex';
        uiPageBtn.disabled = false;
        uiPageBtn.textContent = 'Next';
      }
    }

    renderPageNumbers(totalPages);
  }

  function renderPageNumbers(totalPages) {
    if (!uiPageNumbers) return;
    uiPageNumbers.innerHTML = '';

    for (var p = 1; p <= totalPages; p++) {
      var btn = document.createElement('button');
      btn.className = 'ui-page-num' + (p === currentDisplayPage ? ' active' : '');
      btn.textContent = p;
      btn.setAttribute('aria-busy', 'false');
      (function(page) {
        btn.addEventListener('click', function() {
          if (currentDisplayPage === page) return;
          currentDisplayPage = page;
          showResults(lastRanked, currentBudget.min, currentBudget.max);
        });
      })(p);
      uiPageNumbers.appendChild(btn);
    }
  }

  function showNextPage() {
    if (!lastRanked || lastRanked.length === 0) return;
    var totalPages = ReviewRankPagination.getTotalPages(lastRanked);
    if (currentDisplayPage >= totalPages) return;
    currentDisplayPage++;
    showResults(lastRanked, currentBudget.min, currentBudget.max);
  }

  function showPrevPage() {
    if (!lastRanked || lastRanked.length === 0) return;
    if (currentDisplayPage <= 1) return;
    currentDisplayPage--;
    showResults(lastRanked, currentBudget.min, currentBudget.max);
  }

  var uiPageBtnEl = document.getElementById('uiPageBtn');
  if (uiPageBtnEl) {
    uiPageBtnEl.removeEventListener('click', showNextPage);
    uiPageBtnEl.addEventListener('click', showNextPage);
  }

  var uiPrevBtnEl = document.getElementById('uiPrevBtn');
  if (uiPrevBtnEl) {
    uiPrevBtnEl.addEventListener('click', showPrevPage);
  }

  // Price-insights accessors (popup-local; lib is loaded via popup.html).
  function getPriceLib() {
    try {
      if (typeof window !== 'undefined' && window.ReviewRankPriceInsights) return window.ReviewRankPriceInsights;
    } catch (e) {}
    try {
      if (typeof globalThis !== 'undefined' && globalThis.ReviewRankPriceInsights) return globalThis.ReviewRankPriceInsights;
    } catch (e) {}
    return null;
  }

  // Dependency-free fallback mirroring lib/price-insights.js semantics.
  function fallbackPriceStats(products) {
    var prices = [];
    for (var i = 0; i < (products || []).length; i++) {
      var pr = products[i] ? products[i].price : undefined;
      if (typeof pr === 'number' && isFinite(pr) && !isNaN(pr) && pr >= 0) prices.push(pr);
    }
    if (prices.length === 0) {
      return { count: (products || []).length, validCount: 0, lowest: null, highest: null, average: null, hasPrices: false };
    }
    var lo = prices[0], hi = prices[0], sum = 0, j;
    for (j = 0; j < prices.length; j++) {
      if (prices[j] < lo) lo = prices[j];
      if (prices[j] > hi) hi = prices[j];
      sum += prices[j];
    }
    return { count: (products || []).length, validCount: prices.length, lowest: lo, highest: hi, average: Math.round(sum / prices.length), hasPrices: true };
  }

  // Compact secondary block under the header: title + Lowest/Average/Highest
  // (+ "N products within budget" when a budget is active). Hidden-safe:
  // never renders ₹0/₹null/NaN — unavailable shows a muted single line.
  function renderPriceInsights(stats, minPrice, maxPrice, rankedCount) {
    var box = document.getElementById('priceInsights');
    if (!box) return;
    try {
      var hasBudget = (minPrice !== null && minPrice !== undefined) ||
        (maxPrice !== null && maxPrice !== undefined);
      var title = (UI.PRICE_INSIGHTS_TITLE || 'PRICE INSIGHTS');
      var html = '<div class="price-insights-title">' + title + '</div>';
      html += UI.priceInsightsHTML(stats);
      if (hasBudget && stats && stats.hasPrices) {
        html += '<div class="price-budget-line">' + UI.budgetCountText(rankedCount) + '</div>';
      }
      box.innerHTML = html;
      box.style.display = 'block';
    } catch (e) {
      try { box.style.display = 'none'; } catch (e2) {}
    }
  }

  // ------------------------------------------------------------------
  // Pagination — UI state + wiring
  // ------------------------------------------------------------------

  function updatePaginationSection(nextPageAvailable, reset) {
    var paginationSection = document.getElementById('paginationSection');
    var paginationBtn = document.getElementById('paginationBtn');
    var paginationMsg = document.getElementById('paginationMsg');

    if (!paginationSection) return;

    if (reset) {
      paginationSection.style.display = 'none';
      if (paginationBtn) {
        paginationBtn.style.display = 'none';
        paginationBtn.disabled = false;
        paginationBtn.textContent = 'Analyze Next Page';
      }
      if (paginationMsg) paginationMsg.textContent = '';
      return;
    }

    paginationSection.style.display = 'block';
    if (nextPageAvailable && pagesAnalyzed < MAX_PAGES) {
      if (paginationBtn) {
        paginationBtn.style.display = 'inline-flex';
        paginationBtn.disabled = false;
        paginationBtn.textContent = 'Analyze Next Page';
      }
      if (paginationMsg) paginationMsg.textContent = pagesMessage(pagesAnalyzed);
    } else {
      if (paginationBtn) paginationBtn.style.display = 'none';
      if (paginationMsg) {
        paginationMsg.textContent = (pagesAnalyzed >= MAX_PAGES
          ? 'Maximum pages analyzed'
          : 'All available pages analyzed');
      }
    }
  }

  function pagesMessage(n) {
    return (n <= 1 ? '1 PAGE ANALYZED' : n + ' PAGES ANALYZED');
  }

  function setPaginationLoading(loading) {
    isPaginating = loading; // synchronous so a 2nd click is rejected
    var paginationBtn = document.getElementById('paginationBtn');
    var paginationMsg = document.getElementById('paginationMsg');
    if (paginationBtn) {
      paginationBtn.disabled = loading;
      paginationBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
      paginationBtn.textContent = loading ? 'Analyzing Next Page...' : 'Analyze Next Page';
    }
    if (loading && paginationMsg) paginationMsg.textContent = 'Analyzing Next Page...';
  }

  function showPaginationMessage(msg) {
    var paginationSection = document.getElementById('paginationSection');
    var paginationBtn = document.getElementById('paginationBtn');
    var paginationMsg = document.getElementById('paginationMsg');
    if (!paginationSection || !paginationMsg) return;
    paginationSection.style.display = 'block';
    if (paginationBtn) paginationBtn.style.display = 'none';
    paginationMsg.textContent = msg || '';
  }

  // Volatile Amazon tracking params (popup-local mirror of the content-script
  // rule): ref-family, pd_*/pf_* noise, pldn_*, psc, srs, spIA, qid, sr,
  // session/slot ids never identify a page and are stripped for loops.
  function isVolatilePageParamLocal(name) {
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

  // Canonical page URL (popup-local loop-protection mirror): strips volatile
  // tracking params + fragment, sorts the rest for order-insensitivity.
  function canonicalPageUrlLocal(url) {
    if (typeof url !== 'string') return '';
    var trimmed = url.trim();
    if (!trimmed || trimmed === '#') return '';
    try {
      var base = originPageUrl || 'https://www.amazon.in/';
      try {
        var adapter = getAdapterForUrl(trimmed);
        if (adapter && adapter.domains && adapter.domains[0]) {
          base = 'https://www.' + adapter.domains[0] + '/';
        }
      } catch (e) {}
      var u = new URL(trimmed, base);
      var keep = [];
      var seen = {};
      var params = u.search ? u.search.slice(1).split('&') : [];
      for (var i = 0; i < params.length; i++) {
        var pair = params[i];
        if (!pair) continue;
        var eqIdx = pair.indexOf('=');
        var rawName = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
        var name = rawName;
        try { name = decodeURIComponent(rawName); } catch (e) { name = rawName; }
        if (isVolatilePageParamLocal(name)) continue;
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
    } catch (e) {
      return trimmed.split('#')[0];
    }
  }

  // "Analyze Next Page": orchestrated by the background worker, which opens
  // the next Amazon search-results page in a temporary INACTIVE tab, loads
  // the REAL page, extracts via the content script, then closes the temp
  // tab. The user's active tab never navigates. No fetch()/DOMParser.
  //
  // Merge: new products are concatenated into the RAW union and the SAME
  // pipeline (dedup -> validate -> budget -> sponsored -> sort) is re-run,
  // so a page-2 product can become #1. Failures NEVER erase existing
  // results. Load More (#6) is untouched and keeps working independently.
  function analyzeNextPage() {
    if (isPaginating) return; // double-click protection
    if (pagesAnalyzed >= MAX_PAGES) return; // hard cap
    if (!nextPageUrl) return;

    var canon;
    try { canon = canonicalPageUrlLocal(nextPageUrl); }
    catch (e) { canon = nextPageUrl; }
    if (!canon || visitedPages.has(canon)) {
      nextPageUrl = null; // loop target — stop without losing results
      updatePaginationSection(false);
      return;
    }

    setPaginationLoading(true);

    var visitedList = [];
    try {
      visitedPages.forEach(function (v) { visitedList.push(v); });
    } catch (e) { visitedList = []; }

    var payload = {
      action: 'analyzeNextPageBg',
      nextPageUrl: nextPageUrl,
      originPageUrl: originPageUrl,
      visitedCanonical: visitedList
    };

    var done = false;
    function finish(response) {
      if (done) return;
      done = true;
      setPaginationLoading(false);

      if (!response || !response.success) {
        showPaginationMessage("Couldn't analyze the next page. Your existing results are still available.");
        var retryBtn = document.getElementById('paginationBtn');
        if (retryBtn) retryBtn.style.display = 'inline-flex';
        return;
      }

      var canonNext;
      try { canonNext = canonicalPageUrlLocal(response.pageUrl || nextPageUrl); }
      catch (e) { canonNext = response.pageUrl || nextPageUrl; }
      if (canonNext) {
        if (visitedPages.has(canonNext)) {
          nextPageUrl = response.nextPageUrl || null;
          updatePaginationSection(!!nextPageUrl);
          return;
        }
        visitedPages.add(canonNext);
      }
      pagesAnalyzed++;

      var fresh = (response.products || []).slice();
      if (fresh.length > 0) allProducts = allProducts.concat(fresh);

      // Pagination reuses the ORIGINAL search query so page-2 products face
      // the identical relevance filter (adopt page query only if we never
      // had one).
      try {
        if (!currentSearchQuery && response && response.searchQuery) {
          currentSearchQuery = String(response.searchQuery).trim();
        }
      } catch (e) {}

      var ranked = processProducts(allProducts, currentBudget, false, currentSearchQuery);
      if (ranked && ranked.length > 0) {
        lastRanked = ranked;
        showResults(ranked, currentBudget.min, currentBudget.max);
      } else if (lastRanked && lastRanked.length > 0) {
        showResults(lastRanked, currentBudget.min, currentBudget.max);
      }

      nextPageUrl = response.nextPageUrl || null;
      updatePaginationSection(!!nextPageUrl);
    }

    try {
      chrome.runtime.sendMessage(payload, function (response) {
        if (chrome.runtime.lastError) {
          finish({ success: false });
          return;
        }
        finish(response);
      });
    } catch (e) {
      finish({ success: false });
    }
  }

  var paginationBtnEl = document.getElementById('paginationBtn');
  if (paginationBtnEl) {
    paginationBtnEl.addEventListener('click', analyzeNextPage);
  }

  if (changeBudgetBtn) {
    changeBudgetBtn.addEventListener('click', function() {
      showInitialState();
    });
  }
});

