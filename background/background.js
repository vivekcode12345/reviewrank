// ReviewRank Background Service Worker
// Minimal relay — the popup communicates directly with the content script.
// This worker exists for future extensibility and to satisfy Manifest V3.

chrome.runtime.onInstalled.addListener(() => {
  console.log('ReviewRank extension installed.');
});

// Optional: Handle messages that need background-level processing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Currently unused — popup talks directly to content scripts.
  // Keep for future features (price history, sentiment analysis, etc.)
});
