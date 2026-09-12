document.addEventListener('DOMContentLoaded', function() {
  var initialState = document.getElementById('initialState');
  var errorState = document.getElementById('errorState');
  var resultsState = document.getElementById('resultsState');
  var errorText = document.getElementById('errorText');
  var errorHint = document.getElementById('errorHint');
  var productsList = document.getElementById('productsList');
  var resultsCount = document.getElementById('resultsCount');
  var resultsSub = document.getElementById('resultsSub');
  var analyzeBtn = document.getElementById('analyzeBtn');
  var btnLabel = analyzeBtn.querySelector('.btn-label');
  var btnSpinner = analyzeBtn.querySelector('.btn-spinner');
  var minPriceInput = document.getElementById('minPrice');
  var maxPriceInput = document.getElementById('maxPrice');
  var isAnalyzing = false;

  analyzeBtn.addEventListener('click', function() {
    if (isAnalyzing) return;
    isAnalyzing = true;
    analyzeBtn.disabled = true;
    btnLabel.style.display = 'none';
    btnSpinner.style.display = 'flex';

    // Parse and validate budget inputs
    var budget = parseBudgetInput(minPriceInput.value, maxPriceInput.value);
    if (budget.error) {
      isAnalyzing = false;
      analyzeBtn.disabled = false;
      btnLabel.style.display = 'inline';
      btnSpinner.style.display = 'none';
      showError(budget.error);
      return;
    }

    analyze(function(err, products) {
      isAnalyzing = false;
      analyzeBtn.disabled = false;
      btnLabel.style.display = 'inline';
      btnSpinner.style.display = 'none';

      if (err) {
        showError(err);
        return;
      }

      if (!products || products.length === 0) {
        showError('No products detected on this page. Try refreshing the Amazon results page.');
        return;
      }

      // Step 1: Remove duplicate products (by ASIN → canonical URL)
      var unique = deduplicateProducts(products);

      if (unique.length === 0) {
        showError('No products detected on this page. Try refreshing the Amazon results page.');
        return;
      }

      // Step 2: Filter by price range
      var filtered = filterByPriceRange(unique, budget.min, budget.max);

      if (filtered.length === 0) {
        var rangeText = formatBudgetRange(budget.min, budget.max);
        showNoResults('No products found in your price range ' + rangeText + '.', 'Try increasing your budget range.');
        return;
      }

      // Step 3: Exclude sponsored products from the ranking
      var organic = excludeSponsoredProducts(filtered);

      if (organic.length === 0) {
        showError('No non-sponsored products found within this budget range. Sponsored listings are excluded from ReviewRank rankings.');
        return;
      }

      // Step 4: Sort by review count descending
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

  function formatBudgetRange(minPrice, maxPrice) {
    if (minPrice !== null && maxPrice !== null) {
      return '₹' + formatNumber(minPrice) + '–₹' + formatNumber(maxPrice);
    }
    if (minPrice !== null) {
      return 'above ₹' + formatNumber(minPrice);
    }
    if (maxPrice !== null) {
      return 'under ₹' + formatNumber(maxPrice);
    }
    return '';
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
      callback(response ? response.error : 'Failed to analyze products.');
      return;
    }
    callback(null, response.products || []);
  }

  function showError(message, hint) {
    initialState.style.display = 'none';
    resultsState.style.display = 'none';
    errorState.style.display = 'block';
    errorText.textContent = message;
    if (hint) {
      errorHint.textContent = hint;
      errorHint.style.display = 'block';
    } else {
      errorHint.style.display = 'none';
    }
  }

  function showNoResults(message, hint) {
    initialState.style.display = 'none';
    resultsState.style.display = 'none';
    errorState.style.display = 'block';
    errorText.textContent = message;
    errorHint.textContent = hint || '';
    errorHint.style.display = 'block';
  }

  function showResults(products, minPrice, maxPrice) {
    initialState.style.display = 'none';
    errorState.style.display = 'none';
    resultsState.style.display = 'block';

    var countText = products.length + ' product' + (products.length !== 1 ? 's' : '');
    var subText = '';

    if (minPrice !== null || maxPrice !== null) {
      var rangeStr = formatBudgetRange(minPrice, maxPrice);
      countText += ' in ' + rangeStr;
      subText = 'Ranked by customer review count';
    } else {
      subText = 'Ranked by customer review count';
    }

    resultsCount.textContent = countText;
    resultsSub.textContent = subText;
    productsList.innerHTML = '';

    for (var i = 0; i < products.length; i++) {
      var rank = i + 1;
      var card = createProductCard(products[i], rank);
      productsList.appendChild(card);
    }
  }

  function createProductCard(product, rank) {
    var card = document.createElement('a');
    card.className = 'product-card';
    card.href = product.url || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    var rankClass = rank <= 3 ? 'rank-' + rank : 'rank-default';
    var rankLabel = rank <= 3 ? ['1.', '2.', '3.'][rank - 1] : '#' + rank;
    var stars = getStarString(product.rating);
    var reviewText = product.reviewCount > 0
      ? formatNumber(product.reviewCount) + ' ratings'
      : 'Review count unavailable';

    var html = '';
    html += '<div class="product-rank">';
    html += '<div class="rank-badge ' + rankClass + '">' + rankLabel + '</div>';
    html += '</div>';
    html += '<div class="product-info">';
    html += '<div class="product-title">' + escapeHtml(product.title) + '</div>';
    html += '<div class="product-meta">';
    if (product.price != null && product.price > 0) {
      html += '<span class="product-price">₹' + formatNumber(product.price) + '</span>';
    } else {
      html += '<span class="product-price unavailable">Price unavailable</span>';
    }
    if (product.rating > 0) {
      html += '<span class="product-rating"><span class="rating-stars">' + stars + '</span>';
      html += '<span class="rating-value">' + product.rating.toFixed(1) + '</span></span>';
    }
    html += '<span class="review-count ' + (product.reviewCount > 0 ? '' : 'unavailable') + '">' + reviewText + '</span>';
    html += '</div></div>';

    card.innerHTML = html;
    return card;
  }

  function getStarString(rating) {
    if (!rating || rating <= 0) return '';
    var full = Math.floor(rating);
    var half = rating % 1 >= 0.5 ? 1 : 0;
    var empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  }

  function formatNumber(num) {
    if (num == null) return '';
    return num.toLocaleString('en-IN');
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});

