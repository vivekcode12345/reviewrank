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

    analyze(function(err, products) {
      setLoading(false);

      if (err) {
        showError(UI.friendlyErrorMessage(err));
        return;
      }

      if (!products || products.length === 0) {
        showError(UI.MESSAGES.noProducts, UI.MESSAGES.noProductsHint);
        return;
      }

      // Step 1: Remove duplicate products (by ASIN → canonical URL)
      var unique = deduplicateProducts(products);

      if (unique.length === 0) {
        showError(UI.MESSAGES.noProducts, UI.MESSAGES.noProductsHint);
        return;
      }

      // Step 2: Filter by price range
      var filtered = filterByPriceRange(unique, budget.min, budget.max);

      if (filtered.length === 0) {
        showError(UI.MESSAGES.budgetNoMatch, UI.MESSAGES.budgetNoMatchHint);
        return;
      }

      // Step 3: Exclude sponsored products from the ranking
      var organic = excludeSponsoredProducts(filtered);

      if (organic.length === 0) {
        showError(UI.MESSAGES.allSponsored, UI.MESSAGES.allSponsoredHint);
        return;
      }

      // Step 4: Sort by review count descending (unchanged)
      var ranked = sortByReviewCount(organic);

      // Step 5: Render
      showResults(ranked, budget.min, budget.max);
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
      return (b.reviewCount || 0) - (a.reviewCount || 0);
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

  function analyze(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        callback('Cannot access the current tab. Please try again.');
        return;
      }

      var tab = tabs[0];
      var url = tab.url || '';

      if (url.indexOf('amazon.') === -1) {
        callback('Open an Amazon search-results page first.');
        return;
      }

      var isSearchPage = url.indexOf('/s?') !== -1 || url.indexOf('/s/') !== -1 || url.indexOf('k=') !== -1;
      if (!isSearchPage) {
        callback('Navigate to an Amazon search results page first.');
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'scrapeAmazon' }, function(response) {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js']
          }, function() {
            if (chrome.runtime.lastError) {
              callback('Could not analyze this page. Please refresh the Amazon page and try again.');
              return;
            }
            setTimeout(function() {
              chrome.tabs.sendMessage(tab.id, { action: 'scrapeAmazon' }, function(response2) {
                if (chrome.runtime.lastError) {
                  callback('Could not analyze this page. Please refresh and try again.');
                  return;
                }
                handleResponse(response2, callback);
              });
            }, 500);
          });
          return;
        }
        handleResponse(response, callback);
      });
    });
  }

  function handleResponse(response, callback) {
    if (!response || !response.success) {
      callback(response ? response.error : 'Could not analyze this page. Please refresh the Amazon page and try again.');
      return;
    }
    callback(null, response.products || []);
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
});

