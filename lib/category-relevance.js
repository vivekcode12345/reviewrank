/**
 * ReviewRank — Category relevance layer (Feature #8).
 *
 * Pure functions, no DOM / no network / no AI. Shared by:
 *   - popup.js (filtering + ranking)
 *   - content.js (search-query extraction from the live Amazon page)
 *   - tests/category-relevance.test.js (Node via module.exports)
 *
 * Philosophy: review count REMAINS the primary ranking metric.
 * Relevance is a conservative FILTER applied BEFORE review-count sorting,
 * so a LOW-relevance product with 100k ratings can never outrank a
 * HIGH-relevance product with 5k ratings. When in doubt, INCLUDE.
 */
var ReviewRankRelevance = (function () {
  'use strict';

  // ------------------------------------------------------------------
  // Configurable accessory / irrelevant signals.
  // Kept intentionally small and maintainable. These are ONLY negative
  // signals when they do NOT appear in the user's own query (query intent
  // always overrides — see canonical groups below).
  // ------------------------------------------------------------------
  var ACCESSORY_TERMS = [
    'case',
    'cover',
    'cable',
    'charger',
    'charging',
    'adapter',
    'holder',
    'stand',
    'skin',
    'protector',
    'guard',
    'replacement',
    'tips',
    'tip',
    'pouch',
    'sleeve',
    'strap',
    'cord',
    'dock',
    'mount',
    'clip',
    'band'
  ];

  // Intent groups: tokens in the same group express the SAME user intent.
  // A title token never penalizes when its group is present in the query.
  // Example: query "usb c cable" + title "USB C Charging Cable" → "charging"
  // maps to the cable group already in the query → no penalty.
  var INTENT_GROUPS = [
    ['airpods', 'airdopes', 'earbuds', 'earbud', 'earphones', 'earphone',
     'headphones', 'headphone', 'buds', 'bud', 'pods', 'pod', 'airbuds'],
    ['case', 'cover', 'protector', 'guard', 'pouch', 'sleeve', 'skin'],
    ['cable', 'charger', 'charging', 'adapter', 'cord'],
    ['holder', 'stand', 'dock', 'mount', 'strap', 'clip', 'band'],
    ['tips', 'tip']
  ];

  var STOPWORDS = {
    'the': true, 'a': true, 'an': true, 'and': true, 'or': true,
    'for': true, 'with': true, 'of': true, 'in': true, 'on': true,
    'to': true, 'is': true, 'are': true, 'by': true, 'at': true,
    'from': true, 'under': true, 'below': true, 'above': true,
    'over': true, 'rs': true, 'inr': true
  };

  // ------------------------------------------------------------------
  // Text utilities
  // ------------------------------------------------------------------

  // lowercase → strip punctuation (keep letters/digits/spaces) → collapse.
  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Remove budget noise so "wireless earbuds under 1500" behaves like
  // "wireless earbuds". Only removes numbers tied to a budget keyword or
  // explicit currency amounts — bare model numbers ("iphone 15") survive.
  function stripBudgetNoise(query) {
    if (typeof query !== 'string') return '';
    var s = query;
    // "under 1500", "below rs 2000", "up to ₹5000", "less than 1000", ...
    s = s.replace(
      /\b(under|below|above|over|up\s*to|upto|within|between|less\s+than|greater\s+than|around|approx(?:imately)?)\b[^a-z\d]*?(?:rs\.?|inr|[\u20B9$\u20AC])?[^a-z\d]*?\d[\d,]*/gi,
      ' '
    );
    // Explicit currency amounts: "₹1500", "rs 1500", "inr 2000"
    s = s.replace(/[\u20B9$]\s*\d[\d,]*/g, ' ');
    s = s.replace(/\brs\.?\s*\d[\d,]*/gi, ' ');
    s = s.replace(/\binr\s*\d[\d,]*/gi, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  // Full query normalization: budget-strip → lowercase/punctuation → collapse.
  function normalizeQuery(query) {
    if (typeof query !== 'string') return '';
    return normalizeText(stripBudgetNoise(query));
  }

  function tokenize(text) {
    var norm = normalizeText(text);
    if (!norm) return [];
    return norm.split(' ').filter(function (t) { return t.length > 0; });
  }

  // "cases" → "case", "covers" → "cover", "cables" → "cable".
  // Avoids mangling "glass"/"ss" endings and very short tokens ("c", "s").
  function singularize(tok) {
    if (typeof tok !== 'string') return '';
    var t = tok.toLowerCase();
    if (t.length > 4 && t.slice(-3) === 'ies') return t.slice(0, -3) + 'y';
    if (t.length > 3 && t.slice(-1) === 's' && t.slice(-2) !== 'ss') {
      return t.slice(0, -1);
    }
    return t;
  }

  // Map a token to its intent-group canonical form so aliases match:
  // airdopes/earbuds/buds → "airpods", charging/adapter → "cable", etc.
  function canonicalToken(tok) {
    if (typeof tok !== 'string') return '';
    var base = singularize(tok.toLowerCase());
    for (var g = 0; g < INTENT_GROUPS.length; g++) {
      var group = INTENT_GROUPS[g];
      for (var i = 0; i < group.length; i++) {
        if (base === singularize(group[i])) return singularize(group[0]);
      }
    }
    return base;
  }

  function queryTokens(query) {
    var norm = normalizeQuery(query);
    if (!norm) return [];
    return norm.split(' ').filter(function (t) {
      return t.length > 0 && !STOPWORDS[t];
    });
  }

  function isAccessoryToken(tok) {
    var base = singularize(String(tok || '').toLowerCase());
    for (var i = 0; i < ACCESSORY_TERMS.length; i++) {
      if (base === singularize(ACCESSORY_TERMS[i])) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Search-query extraction (pure, testable — DOM access lives in
  // content.js which calls these helpers).
  // ------------------------------------------------------------------

  // Extract the `k` search parameter from an Amazon URL.
  // Returns '' when absent. Never throws.
  function extractSearchQueryFromUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
      // Prefer the URL API when available (browser + Node >= 10).
      if (typeof URL !== 'undefined') {
        var base = url;
        // Allow relative URLs in tests.
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
          base = 'https://www.amazon.in/' + url.replace(/^\/+/, '');
        }
        var u = new URL(base);
        var k = u.searchParams ? u.searchParams.get('k') : null;
        if (k && k.trim()) return k.replace(/\+/g, ' ').trim();
      }
    } catch (e) { /* fall through to regex */ }
    try {
      var m = url.match(/[?&#]k=([^&#]*)/);
      if (!m) return '';
      var raw = m[1].replace(/\+/g, ' ');
      try { raw = decodeURIComponent(raw); } catch (e) { /* keep raw */ }
      return raw.trim();
    } catch (e) {
      return '';
    }
  }

  // Prefer the live search-input value; fall back to the URL `k` param.
  // Never uses budget inputs. Returns '' when nothing usable is found.
  function extractSearchQuery(inputValue, url) {
    if (typeof inputValue === 'string' && inputValue.trim().length >= 2) {
      return inputValue.trim().replace(/\s+/g, ' ');
    }
    var fromUrl = extractSearchQueryFromUrl(url || '');
    if (fromUrl && fromUrl.length >= 1) return fromUrl;
    return '';
  }

  // ------------------------------------------------------------------
  // Relevance scoring — TITLE is the primary signal. Simple, explainable:
  //   exact query-phrase match  → +10 (strong)
  //   each query-token match    → +3
  //   each long-token (len>=5) match → +1 importance bonus
  //   each accessory token in title whose intent group is ABSENT from
  //   the query → −3 (query-aware penalty; intent always overrides)
  // ------------------------------------------------------------------
  function calculateRelevance(productTitle, searchQuery) {
    if (typeof productTitle !== 'string' || !productTitle.trim()) {
      return { score: 0, category: 'UNKNOWN', overlap: 0, overlapRatio: 0, exact: false, penalty: 0, queryUsed: '' };
    }
    if (typeof searchQuery !== 'string' || !searchQuery.trim()) {
      return { score: 0, category: 'UNKNOWN', overlap: 0, overlapRatio: 0, exact: false, penalty: 0, queryUsed: '' };
    }

    var normQuery = normalizeQuery(searchQuery);
    var qToks = queryTokens(searchQuery);
    if (!normQuery || qToks.length === 0) {
      return { score: 0, category: 'UNKNOWN', overlap: 0, overlapRatio: 0, exact: false, penalty: 0, queryUsed: '' };
    }

    var normTitle = normalizeText(productTitle);
    if (!normTitle) {
      return { score: 0, category: 'UNKNOWN', overlap: 0, overlapRatio: 0, exact: false, penalty: 0, queryUsed: normQuery };
    }

    var exact = normTitle.indexOf(normQuery) !== -1;

    // Canonical sets for alias-aware matching.
    var queryCanonSet = {};
    var queryCanonList = [];
    for (var qi = 0; qi < qToks.length; qi++) {
      var qc = canonicalToken(qToks[qi]);
      if (!queryCanonSet[qc]) { queryCanonSet[qc] = true; queryCanonList.push(qc); }
    }

    var titleToks = normTitle.split(' ').filter(function (t) { return t.length > 0; });
    var titleCanonSet = {};
    for (var ti = 0; ti < titleToks.length; ti++) {
      titleCanonSet[canonicalToken(titleToks[ti])] = true;
    }

    var overlap = 0;
    var importantBonus = 0;
    for (var k = 0; k < qToks.length; k++) {
      var qTok = qToks[k];
      if (titleCanonSet[canonicalToken(qTok)]) {
        overlap++;
        if (qTok.length >= 5) importantBonus++;
      }
    }
    var overlapRatio = qToks.length > 0 ? overlap / qToks.length : 0;

    // Query-aware accessory penalty: only when the title's accessory intent
    // group is absent from the query (intent override).
    var penalty = 0;
    for (var x = 0; x < titleToks.length; x++) {
      var tt = titleToks[x];
      if (!isAccessoryToken(tt)) continue;
      var group = canonicalToken(tt);
      if (!queryCanonSet[group]) penalty++;
    }

    var score = overlap * 3 + importantBonus + (exact ? 10 : 0) - penalty * 3;

    var category;
    if (exact) {
      category = 'HIGH';
    } else if (overlap === 0) {
      category = 'LOW';
    } else if (penalty > 0 && overlapRatio < 0.6) {
      category = 'LOW';
    } else if (overlapRatio >= 0.75 || score >= 6) {
      category = 'HIGH';
    } else if (overlapRatio >= 0.4 || score >= 3) {
      category = 'MEDIUM';
    } else {
      category = 'LOW';
    }

    return {
      score: score,
      category: category,
      overlap: overlap,
      overlapRatio: overlapRatio,
      exact: exact,
      penalty: penalty,
      queryUsed: normQuery
    };
  }

  // Conservative filter: keep HIGH + MEDIUM (+ UNKNOWN when the query is
  // unavailable — never aggressively filter). Drops only clear LOW items.
  function filterRelevantProducts(products, searchQuery) {
    if (!Array.isArray(products)) {
      return { relevant: [], removed: 0, queryUsed: '', available: false };
    }
    var normQuery = normalizeQuery(searchQuery || '');
    var qToks = queryTokens(searchQuery || '');
    if (!normQuery || qToks.length === 0) {
      return { relevant: products.slice(), removed: 0, queryUsed: '', available: false };
    }
    var relevant = [];
    var removed = 0;
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var title = (p && typeof p.title === 'string') ? p.title : '';
      var r = calculateRelevance(title, searchQuery);
      if (r.category === 'LOW') {
        removed++;
      } else {
        relevant.push(p);
      }
    }
    return { relevant: relevant, removed: removed, queryUsed: normQuery, available: true };
  }

  return {
    ACCESSORY_TERMS: ACCESSORY_TERMS,
    INTENT_GROUPS: INTENT_GROUPS,
    normalizeText: normalizeText,
    stripBudgetNoise: stripBudgetNoise,
    normalizeQuery: normalizeQuery,
    tokenize: tokenize,
    singularize: singularize,
    canonicalToken: canonicalToken,
    queryTokens: queryTokens,
    isAccessoryToken: isAccessoryToken,
    extractSearchQueryFromUrl: extractSearchQueryFromUrl,
    extractSearchQuery: extractSearchQuery,
    calculateRelevance: calculateRelevance,
    filterRelevantProducts: filterRelevantProducts
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewRankRelevance;
}
try {
  if (typeof window !== 'undefined') window.ReviewRankRelevance = ReviewRankRelevance;
  if (typeof globalThis !== 'undefined') globalThis.ReviewRankRelevance = ReviewRankRelevance;
} catch (e) { /* non-browser runtimes */ }
