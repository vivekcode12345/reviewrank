# ReviewRank — Browser Extension

**Rank Amazon search results by customer review volume.**

ReviewRank analyzes the products already displayed on an Amazon search-results page and re-ranks them by the number of customer ratings/reviews — from highest to lowest.

## How It Works

1. Open Amazon in Chrome
2. Search for any product (e.g., "AirPods")
3. Amazon shows its normal search results
4. Click the ReviewRank extension icon
5. Click **"Analyze This Page"**
6. Products are re-ranked by review count and shown inline

## The Methodology

ReviewRank uses **customer review/rating count** as a popularity indicator. A product with more reviews has reached more customers.

> ⚠️ Review count is a popularity indicator — it does NOT represent verified sales figures.

**Primary sort**: Number of ratings/reviews (descending)
**Secondary info**: Star rating, price, product title

A product with 5.0 stars and 1 rating will NOT rank above a product with 4.5 stars and 20,000 ratings.

## Installation (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `BuyRank` folder
5. The ReviewRank icon appears in your toolbar

## File Structure

```
BuyRank/
├── manifest.json          # Extension config (Manifest V3)
├── popup/
│   ├── popup.html         # Popup UI — analyze button + ranked results
│   ├── popup.css          # Popup styles
│   └── popup.js           # Queries active tab, triggers scrape, displays results
├── background/
│   └── background.js      # Minimal service worker (future extensibility)
├── content/
│   └── content.js         # Amazon DOM scraper — reads live search results
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── generate_icons.py      # Icon generation script
```

## Architecture

```
User's current Amazon tab
        ↓
ReviewRank popup (popup.html)
        ↓
Queries active tab → checks URL is Amazon search results
        ↓
Sends message to content script (content.js)
        ↓
Content script reads live DOM of the page
        ↓
Extracts: title, price, rating, review count, image, URL
        ↓
Products returned to popup
        ↓
Sorted by review count DESC
        ↓
Ranked results displayed inline in popup
```

## Error States

| Scenario | Message |
|----------|---------|
| Not on Amazon | "Open an Amazon search-results page first." |
| On Amazon but not search results | "Navigate to an Amazon search results page first..." |
| No products found | "No products detected on this page. Try refreshing..." |
| Product has no review count | Shows "Review count unavailable" |

## MVP Scope

- ✅ Amazon India search results analysis
- ✅ Review count ranking (descending)
- ✅ Inline popup results
- ❌ Flipkart (future)
- ❌ Backend/API (not needed for MVP)
- ❌ AI/ML scoring (not needed for MVP)
