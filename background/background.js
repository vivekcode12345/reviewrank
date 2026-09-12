// ReviewRank Background Service Worker
// Minimal relay — the popup communicates directly with the content script
// for the current tab. Pagination (#7) is orchestrated HERE: the popup asks
// the background to open the next Amazon search-results page in a temporary
// INACTIVE tab, extract its products from the REAL page DOM via the content
// script, then close the temp tab. The user's active tab never navigates.
// NO fetch()/DOMParser scraping of Amazon HTML is used anywhere — products
// always come from a real loaded page document.

try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      console.log('ReviewRank extension installed.');
    });
  }
} catch (e) { /* non-Chrome runtimes (unit tests) */ }

// --- Pagination validation (pure logic, shared with content-script rules) ---
// A candidate "next page" URL is accepted only when it represents another
// Amazon SEARCH-RESULTS page in the SAME search. Product, review,
// wishlist/cart/account, javascript:, empty/# and off-Amazon URLs are
// rejected, as are URLs on a different origin or search path.
function isAllowedNextPageUrl(rawUrl, originInfo) {
  if (typeof rawUrl !== 'string') return { ok: false, reason: 'bad-type' };
  var trimmed = rawUrl.trim();
  if (!trimmed || trimmed === '#') return { ok: false, reason: 'empty' };
  var lower = trimmed.toLowerCase();
  if (lower.indexOf('javascript:') === 0) return { ok: false, reason: 'javascript' };
  if (lower.indexOf('mailto:') === 0 || lower.indexOf('tel:') === 0) return { ok: false, reason: 'scheme' };
  var u;
  try {
    u = new URL(trimmed, (originInfo && originInfo.pageUrl) || 'https://www.amazon.in/');
  } catch (e) {
    return { ok: false, reason: 'unparseable' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'protocol' };
  var host = (u.hostname || '').toLowerCase();
  if (!/amazon\./i.test(host)) return { ok: false, reason: 'off-amazon' };
  var href = u.toString();
  // Reject product / review / cart / account / wishlist links.
  if (/\/dp\/|\/gp\/product\/|\/gp\/aw\/|\/exec\/obidos\//i.test(href)) return { ok: false, reason: 'product-link' };
  if (/product-reviews|customer-reviews|\/review\//i.test(href)) return { ok: false, reason: 'review-link' };
  if (/\/gp\/cart|\/gp\/huc|\/hz\/cart|\/gp\/css|\/wishlist|\/list\/|\/gp\/buy|\/ap\/signin|\/gp\/your-account|\/gp\/css\/order-history|\/gp\/registry/i.test(href)) return { ok: false, reason: 'account-link' };
  // Must look like another Amazon search-results page.
  var isSearchPath = /\/s[\/?]/.test(href);
  var hasSearchParam = /[?&#](k|rh|page|pg|bbn|i|rn|ref|__mk|dchild)=/i.test(href);
  if (!isSearchPath && !hasSearchParam) return { ok: false, reason: 'not-search-page' };
  if (originInfo && originInfo.pageUrl) {
    try {
      var origin = new URL(originInfo.pageUrl);
      var oHost = (origin.hostname || '').toLowerCase();
      // Same Amazon marketplace host (allow www. prefix variance only).
      var normH = function (h) { return h.replace(/^www\./, ''); };
      if (normH(oHost) !== normH(host)) return { ok: false, reason: 'host-changed' };
      // Preserve the SAME search: the k= query term must match when both
      // sides carry one. (Pagination keeps Amazon's other params evolving,
      // so only the explicit search term is compared.)
      var oK = origin.searchParams.get('k');
      var nK = u.searchParams.get('k');
      if (oK && nK && oK !== nK) return { ok: false, reason: 'query-changed' };
    } catch (e) { /* origin parse failed — accept on shape alone */ }
  }
  return { ok: true, url: href };
}

// Volatile Amazon tracking params (background mirror of the content-script
// rule): ref-family, pd_*/pf_* noise, pldn_*, psc, srs, spIA, qid, sr,
// session/slot ids never identify a page and are stripped for loops.
function isVolatilePageParamBg(name) {
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

// Canonical page URL for loop protection: strips volatile tracking params
// and the fragment, keeps identity params, sorts the rest.
function canonicalPageUrlBg(rawUrl) {
  try {
    var u = new URL(rawUrl);
    var keep = [];
    var seen = {};
    u.searchParams.forEach(function (value, name) {
      if (isVolatilePageParamBg(name)) return;
      var pair = name + '=' + value;
      if (seen[pair]) return;
      seen[pair] = true;
      keep.push(pair);
    });
    keep.sort();
    var port = u.port;
    if ((u.protocol === 'https:' && port === '443') || (u.protocol === 'http:' && port === '80')) port = '';
    var path = u.pathname || '/';
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return u.protocol + '//' + u.hostname.toLowerCase() + (port ? ':' + port : '') + path + (keep.length ? '?' + keep.join('&') : '');
  } catch (e) {
    return String(rawUrl || '').split('#')[0];
  }
}

// Pagination orchestration: temporary background tab (real page load).
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.action === 'analyzeNextPageBg') {
        openNextPageInTempTab(message, sendResponse);
        return true;
      }
    });
  }
} catch (e) { /* non-Chrome runtimes (unit tests) */ }

// Flow: validate URL -> tabs.create({active:false}) -> wait for complete
// -> scrape via content script -> close temp tab -> reply to popup.
// Any failure closes the temp tab and replies success:false so the popup
// keeps existing results untouched. NO fetch()/DOMParser anywhere.
function openNextPageInTempTab(message, sendResponse) {
  var replied = false;
  var settled = false;
  var tempTabId = null;
  var timerId = null;
  function reply(payload) {
    if (replied) return;
    replied = true;
    try { sendResponse(payload); } catch (e) {}
  }
  function cleanup() {
    if (timerId) { try { clearTimeout(timerId); } catch (e) {} timerId = null; }
    try {
      if (chrome.tabs && chrome.tabs.onUpdated && onTempUpdated) {
        chrome.tabs.onUpdated.removeListener(onTempUpdated);
      }
    } catch (e) {}
  }
  function closeTemp(done) {
    cleanup();
    if (tempTabId !== null && tempTabId !== undefined) {
      try {
        chrome.tabs.remove(tempTabId, function () { if (done) done(); });
        return;
      } catch (e) {}
    }
    if (done) done();
  }
  function fail() {
    if (settled) return;
    settled = true;
    closeTemp(function () {
      reply({ success: false });
    });
  }
  function finishOk(resp) {
    if (settled) return;
    settled = true;
    var products = (resp && resp.products) || [];
    var nextUrl = (resp && resp.nextPageUrl) || null;
    closeTemp(function () {
      reply({ success: true, products: products, nextPageUrl: nextUrl, pageUrl: targetUrl });
    });
  }
  function scrapeTemp(tabId) {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'scrapeAmazon' }, function (resp) {
        if (chrome.runtime.lastError) {
          try {
            chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content/content.js'] }, function () {
              if (chrome.runtime.lastError) { fail(); return; }
              setTimeout(function () {
                try {
                  chrome.tabs.sendMessage(tabId, { action: 'scrapeAmazon' }, function (r2) {
                    if (chrome.runtime.lastError) { fail(); return; }
                    if (!r2 || !r2.success) { fail(); return; }
                    finishOk(r2);
                  });
                } catch (e) { fail(); }
              }, 800);
            });
          } catch (e) { fail(); }
          return;
        }
        if (!resp || !resp.success) { fail(); return; }
        finishOk(resp);
      });
    } catch (e) { fail(); }
  }
  function onTempUpdated(tabId, changeInfo) {
    if (settled) return;
    if (tabId !== tempTabId) return;
    if (changeInfo && changeInfo.status === 'complete') {
      setTimeout(function () { if (!settled) scrapeTemp(tabId); }, 1200);
    }
  }
  // Validate BEFORE opening any tab (search-context preservation).
  var check;
  try {
    check = isAllowedNextPageUrl(message && message.nextPageUrl, { pageUrl: message && message.originPageUrl });
  } catch (e) { check = { ok: false }; }
  if (!check || !check.ok) { reply({ success: false }); return; }
  var targetUrl = check.url;
  try {
    if (message && message.visitedCanonical) {
      var canonTarget = canonicalPageUrlBg(targetUrl);
      if (message.visitedCanonical.indexOf(canonTarget) !== -1) { reply({ success: false }); return; }
    }
  } catch (e) {}
  if (!chrome.tabs || !chrome.tabs.create) { reply({ success: false }); return; }
  timerId = setTimeout(function () { fail(); }, 20000);
  try { chrome.tabs.onUpdated.addListener(onTempUpdated); } catch (e) {}
  try {
    chrome.tabs.create({ url: targetUrl, active: false }, function (tab) {
      if (chrome.runtime.lastError || !tab || tab.id === undefined) {
        settled = true;
        cleanup();
        reply({ success: false });
        return;
      }
      tempTabId = tab.id;
    });
  } catch (e) { fail(); }
}

// Unit-test export for the pure pagination validators (service worker
// runtimes ignore `module`, so this is a no-op inside Chrome).
try {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isAllowedNextPageUrl: isAllowedNextPageUrl,
      canonicalPageUrlBg: canonicalPageUrlBg,
      isVolatilePageParamBg: isVolatilePageParamBg
    };
  }
} catch (e) { /* non-node runtimes */ }
