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
  var LOADING_TEXT = 'Analyzing Amazon products...';

  // --- Load More Products state ---
  // allProducts holds the RAW (unranked) union of products gathered so far
  // across the initial scrape and every load-more operation. The full pipeline
  // (dedup -> validate -> budget -> sponsored -> sort) is re-run on this entire
  // set every time, guaranteeing ONE global ranking.
  var allProducts = [];
  var currentBudget = { min: null, max: null };
  var loadMoreCount = 0;
  var isLoadingMore = false;
  var lastRanked = [];
  var MAX_LOADS = 5; // hard cap to prevent infinite loading

  var loadMoreBtn = document.getElementById('loadMoreBtn');
  var loadMoreSection = document.getElementById('loadMoreSection');
  var loadMoreMessage = document.getElementById('loadMoreMessage');

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

    // Reset load-more state for a fresh analysis
    loadMoreCount = 0;
    allProducts = [];

    analyze(function(err, products, moreAvailable) {
      setLoading(false);

      if (err) {
        showError(UI.friendlyErrorMessage(err));
        return;
      }

      if (!products || products.length === 0) {
        showError(UI.MESSAGES.noProducts, UI.MESSAGES.noProductsHint);
        return;
      }

      // Run the SAME pipeline (dedup -> validate -> budget -> sponsored -> sort).
      // processProducts shows the appropriate empty-state error on its own.
      var ranked = processProducts(products, budget, true);
      if (!ranked) return;

      // Persist the RAW union of products + budget so load-more can re-run the
      // identical pipeline on the merged set (guaranteeing ONE global ranking).
      allProducts = products.slice();
      currentBudget = budget;
      lastRanked = ranked;

      showResults(ranked, budget.min, budget.max);
      updateLoadMoreSection(!!moreAvailable);
    });
  });

  loadMoreBtn.addEventListener('click', function() {
    // Double-click guard: ignore while a load is in flight or limit reached.
    if (isLoadingMore) return;
    if (loadMoreCount >= MAX_LOADS) return;

    setLoadMoreLoading(true);
    loadMoreProducts(function(response) {
      setLoadMoreLoading(false);

      if (!response || !response.success) {
        showLoadMoreMessage("Couldn't load more products. Try again.");
        if (loadMoreBtn) loadMoreBtn.style.display = 'inline-flex'; // allow retry
        return;
      }

      // Merge newly-loaded products into the raw set, then re-run the SAME
      // pipeline (dedup -> validate -> budget -> sponsored -> sort) on the
      // combined set so every product participates in ONE global ranking.
      var newProducts = (response.products || []).slice();
      if (newProducts.length > 0) {
        allProducts = allProducts.concat(newProducts);
        loadMoreCount++;
      }

      var ranked = processProducts(allProducts, currentBudget, false);
      if (ranked && ranked.length > 0) {
        lastRanked = ranked;
        showResults(ranked, currentBudget.min, currentBudget.max);
      } else if (lastRanked && lastRanked.length > 0) {
        // Defensive: never wipe already-displayed results if a re-run is empty.
        showResults(lastRanked, currentBudget.min, currentBudget.max);
      }

            finishLoadMore(response);
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

      if (urlCheck) {
        if (url.indexOf('amazon.') === -1) {
          callback({ success: false, error: 'Open an Amazon search-results page first.' });
          return;
        }
        var isSearchPage = url.indexOf('/s?') !== -1 || url.indexOf('/s/') !== -1 || url.indexOf('k=') !== -1;
        if (!isSearchPage) {
          callback({ success: false, error: 'Navigate to an Amazon search results page first.' });
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

  // Initial scrape: callback(err, products, moreAvailable)
  function analyze(callback) {
    sendTabMessage('scrapeAmazon', true, function(response) {
      if (!response || !response.success) {
        callback(response ? response.error : 'Could not analyze this page. Please refresh the Amazon page and try again.');
        return;
      }
      callback(null, response.products || [], !!response.moreAvailable);
    });
  }

  // Load-more: callback receives the raw content-script response object.
  function loadMoreProducts(callback) {
    sendTabMessage('loadMoreAmazon', false, callback);
  }

  // The SINGLE source of truth for the ranking pipeline — used for BOTH the
  // initial analysis and every load-more re-run, so there is never a second
  // ranking algorithm:
  //   dedup -> validate -> budget filter -> sponsored exclusion -> sort DESC
  // When showErrors is true, empty stages surface their user-facing error;
  // when false (load-more re-runs) they stay silent and return null.
  function processProducts(products, budget, showErrors) {
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

    var filtered = filterByPriceRange(valid, budget.min, budget.max);

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

  function showResults(products, minPrice, maxPrice) {
    initialState.style.display = 'none';
    errorState.style.display = 'none';
    resultsState.style.display = 'block';

    // Header: "8 PRODUCTS FOUND" or "8 PRODUCTS IN ₹600 – ₹1,500"
    resultsCount.textContent = UI.resultsHeaderText(products.length, minPrice, maxPrice);

    // "RANKED BY CUSTOMER RATING COUNT"
    resultsSub.textContent = UI.RESULTS_SUBTEXT;

    // Explanation + subtle disclaimer near the results
    resultsNote.textContent = UI.RANKED_BY_NOTE + ' — ' + UI.POPULARITY_DISCLAIMER;

    productsList.innerHTML = '';

    // Ranks are contiguous #1..#n in the order already sorted by review count
    for (var i = 0; i < products.length; i++) {
      var rank = i + 1;
      var card = document.createElement('div');
      card.innerHTML = UI.buildProductCardHTML(products[i], rank);
      var cardEl = card.firstElementChild;
      if (cardEl) {
        productsList.appendChild(cardEl);
      }
    }
  }

  // ------------------------------------------------------------------
  // Load More Products — UI state + wiring
  // ------------------------------------------------------------------

  function setLoadMoreLoading(loading) {
    isLoadingMore = loading; // synchronous so a 2nd click is rejected immediately
    if (loadMoreBtn) {
      loadMoreBtn.disabled = loading;
      loadMoreBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
      loadMoreBtn.textContent = loading ? 'Loading more products...' : 'Load More Products';
    }
    if (loading) {
      showLoadMoreMessage('Loading more products...');
    }
  }

  function showLoadMoreMessage(msg) {
    if (!loadMoreMessage) return;
    loadMoreMessage.textContent = msg || '';
    loadMoreMessage.style.display = msg ? 'block' : 'none';
  }

  function hideLoadMoreButton() {
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  }

  function showLoadMoreButton(label) {
    if (!loadMoreSection) return;
    loadMoreSection.style.display = 'block';
    if (loadMoreBtn) {
      loadMoreBtn.style.display = 'inline-flex';
      loadMoreBtn.textContent = label || 'Load More Products';
    }
    showLoadMoreMessage('');
  }

  // After the initial analyze: show the Load More button or the "analyzed" note.
  function updateLoadMoreSection(moreAvailable) {
    if (!loadMoreSection) return;
    loadMoreSection.style.display = 'block';
    if (moreAvailable && loadMoreCount < MAX_LOADS) {
      showLoadMoreButton('Load More Products');
    } else {
      hideLoadMoreButton();
      showLoadMoreMessage('All available products analyzed');
    }
  }

  // After a load-more operation completes.
  function finishLoadMore(response) {
    var newCount = (response && response.newCount) || 0;
    var moreAvailable = !!(response && response.moreAvailable);

    if (newCount === 0) {
      hideLoadMoreButton();
      showLoadMoreMessage('No additional products found');
      return;
    }

    if (moreAvailable && loadMoreCount < MAX_LOADS) {
      showLoadMoreButton('Load More Products');
    } else {
      // Reached the load cap (MAX_LOADS) OR Amazon no longer exposes a trigger.
      hideLoadMoreButton();
      showLoadMoreMessage('All available products analyzed');
    }
  }
});

