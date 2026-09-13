# ReviewRank

**Rank Amazon search results by customer review volume.**

ReviewRank is a Chrome extension that analyzes products on Amazon search-results pages and re-ranks them by customer rating/review volume — from highest to lowest. It helps buyers see which products have been reviewed by the most customers, directly in a Chrome Side Panel.

> Rating volume is a popularity indicator. It does **not** represent verified sales figures.

---

## What ReviewRank Does

1. Open an Amazon search-results page in Chrome.
2. Click the ReviewRank extension icon.
3. The Side Panel opens for that tab.
4. Optionally set a budget range (Min / Max in ₹).
5. Click **Analyze This Page**.
6. Products are extracted from the live page DOM, deduplicated, validated, filtered, and re-ranked by review count.
7. Results are displayed in pages of 4 with Previous / Next navigation, Price Insights, and pagination controls.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Amazon product extraction** | Reads the live DOM of Amazon search-results pages (`data-component-type="s-search-result"`). Extracts title, price, rating, review count, image, URL, and ASIN. |
| **Duplicate detection** | Collapses duplicate products by ASIN and canonical URL before ranking. |
| **Sponsored product exclusion** | Removes sponsored/ads listings using multiple DOM signals so only organic results are ranked. |
| **Customer rating-volume ranking** | Primary sort is review/rating count descending. Products with more ratings rank higher. |
| **Missing/invalid data handling** | Invalid titles, missing ASINs, and unparseable fields are rejected. Null review counts never outrank valid counts. |
| **Category relevance filtering** | Conservative pre-filter that penalizes accessory/irrelevant tokens unless the user's own query includes them. Relevance is applied before review-count sorting. |
| **Budget filtering** | Optional Min/Max price filter in Indian Rupees (₹). Products outside the range are excluded from ranking. |
| **Price Insights** | Shows Lowest / Average / Highest price across the final ranked set. Price is insight-only; it never affects ranking. |
| **Pagination** | Results are shown 4 products per page with Previous / Next / page-number controls. |
| **Tab-specific Side Panel** | ReviewRank opens in a Chrome Side Panel tied to the tab where it was opened. Switching tabs hides the panel; returning restores it with previous state preserved. |

---

## How the Ranking Pipeline Works

All ranking happens in a single shared pipeline so every product participates in one global ranking with one shared relevance function:

```
Raw extraction
    ↓
Deduplication (ASIN + canonical URL)
    ↓
Validation (title + identity required; bad records rejected)
    ↓
Category relevance filter (pre-sort conservative filter)
    ↓
Budget filter (optional Min/Max range)
    ↓
Sponsored exclusion
    ↓
Sort by review count DESC (null counts sink to the bottom)
    ↓
Display in pages of 4
```

- **Load More / Pagination** re-run the same pipeline on the merged product set, so the global ranking is always consistent.
- **Price Insights** operate on the final ranked set only; they do not sort or filter products.

---

## Tech Stack

- **Runtime**: Vanilla JavaScript (no frameworks)
- **Extension**: Chrome Manifest V3
- **APIs**: `chrome.action`, `chrome.tabs`, `chrome.scripting`, `chrome.sidePanel`, `chrome.runtime`
- **Host permissions**: `https://www.amazon.in/*`, `https://www.amazon.com/*`
- **Content scripts**: injected at `document_idle` on Amazon pages

---

## Project Structure

```
BuyRank/
├── manifest.json              # Extension config (Manifest V3)
├── popup/
│   ├── popup.html             # Popup UI (legacy)
│   ├── popup.css              # Popup styles (legacy)
│   └── popup.js               # Popup logic (legacy)
├── sidepanel/
│   ├── sidepanel.html         # Side Panel UI — primary user interface
│   ├── sidepanel.css          # Side Panel styles
│   └── sidepanel.js           # Side Panel logic (analyze, results, pagination)
├── background/
│   └── background.js          # Service worker (tab-specific Side Panel, pagination orchestration)
├── content/
│   └── content.js             # Amazon DOM scraper + Load More trigger
├── lib/
│   ├── display.js             # UI formatting helpers (pure functions)
│   ├── product-validation.js  # Product validation & normalization (pure functions)
│   ├── category-relevance.js  # Category relevance filter (pure functions)
│   ├── price-insights.js      # Price statistics (pure functions)
│   └── pagination.js          # Display pagination (pure functions)
├── icons/
│   └── icons.png              # Extension icon (16/48/128)
└── tests/
    ├── extraction.test.js
    ├── product-validation.test.js
    ├── category-relevance.test.js
    ├── sponsored-products.test.js
    ├── load-more.test.js
    ├── pagination.test.js
    ├── pagination-ui.test.js
    ├── price-insights.test.js
    ├── ui-formatting.test.js
    └── change-budget.test.js
```

---

## Installation / Setup

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `BuyRank` project folder.
6. The ReviewRank icon appears in the Chrome toolbar.

---

## How to Use

1. Navigate to an Amazon search-results page (e.g., `https://www.amazon.in/s?k=airpods`).
2. Click the **ReviewRank** icon in the toolbar. The Side Panel opens for that tab.
3. (Optional) Enter a **Min** and/or **Max** price in the budget fields.
4. Click **Analyze This Page**.
5. Review the ranked results. Use **Previous** / **Next** or page numbers to navigate.
6. Click **Change Budget** to adjust filters and re-analyze without closing the panel.
7. Click **Analyze Next Page** to fetch the next Amazon search-results page.
8. Click **✕** to close the Side Panel.

### Tab Behavior

- ReviewRank is **tab-specific**. Opening it on one tab does not make it appear on other tabs.
- Switching away from the tab hides the panel. Returning to the tab restores it with previous results intact.
- Closing the tab cleans up the associated Side Panel state.

---

## Permissions and Why They Are Required

| Permission | Reason |
|------------|--------|
| `activeTab` | Access the currently active Amazon tab to read its DOM and extract products. |
| `scripting` | Inject or re-inject the content script when needed (e.g., pagination temp tab scraping). |
| `tabs` | Manage tabs for pagination (open temporary tabs, read tab state, track tab-specific Side Panel visibility). |
| `sidePanel` | Open and manage the Chrome Side Panel experience. |

**Host permissions** (`https://www.amazon.in/*`, `https://www.amazon.com/*`) are required because the content script and pagination logic must read and interact with Amazon pages.

---

## Testing

The project includes 10 focused test suites covering extraction, validation, relevance, sponsored detection, Load More, pagination, Price Insights, UI formatting, budget changes, and Side Panel state.

| Suite | Assertions |
|-------|-----------|
| `extraction.test.js` | 73 |
| `product-validation.test.js` | 99 |
| `category-relevance.test.js` | 64 |
| `sponsored-products.test.js` | 25 |
| `load-more.test.js` | 42 |
| `pagination.test.js` | 70 |
| `pagination-ui.test.js` | 40 |
| `price-insights.test.js` | 58 |
| `ui-formatting.test.js` | 58 |
| `change-budget.test.js` | 34 |
| **Total** | **563** |

Run all tests:

```bash
node tests/extraction.test.js
node tests/product-validation.test.js
node tests/category-relevance.test.js
node tests/sponsored-products.test.js
node tests/load-more.test.js
node tests/pagination.test.js
node tests/pagination-ui.test.js
node tests/price-insights.test.js
node tests/ui-formatting.test.js
node tests/change-budget.test.js
```

---

## Limitations

- Review count is a **popularity indicator**, not a sales metric. High review volume does not guarantee higher sales.
- Works only on **Amazon search-results pages** (`amazon.in` and `amazon.com`).
- Extraction reads the **current page DOM only**; it does not scrape arbitrary URLs or use backend APIs.
- Category relevance is a **conservative filter** — it may include borderline products rather than over-excluding them.
- Missing prices, ratings, or review counts are displayed as unavailable; they are not invented.
- Side Panel tab-specific behavior depends on Chrome's `sidePanel` API availability.

---

## Future Improvements

- Support additional Amazon marketplaces.
- Additional ranking signals (price positioning, rating quality, delivery estimates).
- Saved budgets and preferences per tab or per search.
- Offline caching of previous results for faster re-analysis.
