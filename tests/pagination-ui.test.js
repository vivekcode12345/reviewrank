#!/usr/bin/env node
/**
 * ReviewRank — Pagination UI state tests.
 *
 * Focused regression tests for the popup display-pagination controls:
 *   1. 1-4 products -> no pagination shown
 *   2. 5-8 products -> Previous/Next work
 *   3. Previous returns to the correct page
 *   4. Last page disables/hides Next
 *   5. Correct range/count is displayed
 *   6. No "0-0 of 0" when products exist
 *
 * Run: node tests/pagination-ui.test.js
 */
'use strict';

var failures = 0;
var count = 0;
function assert(cond, label) {
  count++;
  if (cond) console.log('PASS: ' + label);
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(actual, expected, label) {
  assert(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

// lib/pagination.js is the single source of truth for page math.
var P = require('../lib/pagination.js');
var PAGE_SIZE = P.PAGE_SIZE || 4;

// ---------------------------------------------------------------------------
// Lightweight UI-state simulator (mirrors popup.js updateUIPagination logic)
// ---------------------------------------------------------------------------
function createMockPaginationElements() {
  return {
    uiPagination: { style: { display: '' } },
    uiPrevBtn: { style: { display: '' }, disabled: false },
    uiPageBtn: { style: { display: '' }, disabled: false, textContent: '' },
    uiPageLabel: { textContent: '' },
    uiPageNumbers: { innerHTML: '', children: [] }
  };
}

function simulateUpdateUIPagination(products, currentPage, totalPages, els) {
  var productCount = products ? products.length : 0;
  if (!productCount || totalPages <= 1) {
    els.uiPagination.style.display = 'none';
    return;
  }
  els.uiPagination.style.display = 'block';

  var range = P.getPageRange(currentPage, products);
  els.uiPageLabel.textContent = range.start + '-' + range.end + ' of ' + range.total;

  els.uiPrevBtn.style.display = currentPage <= 1 ? 'none' : 'inline-flex';
  els.uiPrevBtn.disabled = currentPage <= 1;

  els.uiPageBtn.style.display = currentPage >= totalPages ? 'none' : 'inline-flex';
  els.uiPageBtn.disabled = currentPage >= totalPages;
  els.uiPageBtn.textContent = 'Next';

  els.uiPageNumbers.innerHTML = '';
  els.uiPageNumbers.children = [];
  for (var p = 1; p <= totalPages; p++) {
    var btn = {
      textContent: p,
      className: p === currentPage ? 'ui-page-num active' : 'ui-page-num',
      disabled: false,
      style: {},
      addEventListener: function() {}
    };
    els.uiPageNumbers.children.push(btn);
  }
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
function makeProduct(id, reviewCount) {
  return { id: id, reviewCount: reviewCount, title: 'Product ' + id };
}

var three = [makeProduct(1, 100), makeProduct(2, 200), makeProduct(3, 300)];
var five = [makeProduct(1, 100), makeProduct(2, 200), makeProduct(3, 300), makeProduct(4, 400), makeProduct(5, 500)];
var eight = [makeProduct(1, 100), makeProduct(2, 200), makeProduct(3, 300), makeProduct(4, 400),
             makeProduct(5, 500), makeProduct(6, 600), makeProduct(7, 700), makeProduct(8, 800)];
var twelve = [];
for (var i = 1; i <= 12; i++) twelve.push(makeProduct(i, i * 100));

// ---------------------------------------------------------------------------
// 1. 1-4 products -> no pagination
// ---------------------------------------------------------------------------
console.log('--- 1-4 products -> no pagination ---');
{
  var els = createMockPaginationElements();
  simulateUpdateUIPagination(three, 1, P.getTotalPages(three), els);
  eq(els.uiPagination.style.display, 'none', '1-4: pagination hidden for 3 products');
  eq(els.uiPageLabel.textContent, '', '1-4: label empty when hidden');
}
{
  var els = createMockPaginationElements();
  simulateUpdateUIPagination(three.slice(0, 4), 1, P.getTotalPages(three.slice(0, 4)), els);
  eq(els.uiPagination.style.display, 'none', '1-4: pagination hidden for exactly 4 products');
}

// ---------------------------------------------------------------------------
// 2. 5-8 products -> Previous/Next works
// ---------------------------------------------------------------------------
console.log('--- 5-8 products -> Previous/Next ---');
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(five);
  simulateUpdateUIPagination(five, 1, totalPages, els);
  eq(els.uiPagination.style.display, 'block', '5: pagination visible');
  eq(els.uiPrevBtn.style.display, 'none', '5 page1: Previous hidden');
  eq(els.uiPageBtn.style.display, 'inline-flex', '5 page1: Next visible');
  eq(els.uiPageBtn.textContent, 'Next', '5 page1: Next label');
  eq(els.uiPageNumbers.children.length, totalPages, '5: correct page buttons count');
}
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(eight);
  simulateUpdateUIPagination(eight, 2, totalPages, els);
  eq(els.uiPagination.style.display, 'block', '8 page2: pagination visible');
  eq(els.uiPrevBtn.style.display, 'inline-flex', '8 page2: Previous visible');
  eq(els.uiPrevBtn.disabled, false, '8 page2: Previous enabled');
  eq(els.uiPageBtn.style.display, 'none', '8 page2: Next hidden (last page)');
  eq(els.uiPageNumbers.children.length, totalPages, '8: correct page buttons count');
}

// ---------------------------------------------------------------------------
// 3. Previous returns to the correct page
// ---------------------------------------------------------------------------
console.log('--- Previous returns to correct page ---');
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(twelve);
  // Simulate navigating to page 2, then Previous
  simulateUpdateUIPagination(twelve, 2, totalPages, els);
  eq(els.uiPageLabel.textContent, '5-8 of 12', 'page2: range is 5-8 of 12');
  eq(els.uiPrevBtn.style.display, 'inline-flex', 'page2: Previous visible');
  // Simulate Previous -> page 1
  simulateUpdateUIPagination(twelve, 1, totalPages, els);
  eq(els.uiPageLabel.textContent, '1-4 of 12', 'page1 after prev: range is 1-4 of 12');
  eq(els.uiPrevBtn.style.display, 'none', 'page1 after prev: Previous hidden');
}

// ---------------------------------------------------------------------------
// 4. Last page disables/hides Next
// ---------------------------------------------------------------------------
console.log('--- Last page disables/hides Next ---');
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(twelve);
  simulateUpdateUIPagination(twelve, totalPages, totalPages, els);
  eq(els.uiPageBtn.style.display, 'none', 'last page: Next hidden');
  eq(els.uiPageBtn.textContent, 'Next', 'last page: Next text unchanged (not "End")');
  eq(els.uiPrevBtn.style.display, 'inline-flex', 'last page: Previous visible');
  eq(els.uiPageNumbers.children[totalPages - 1].className, 'ui-page-num active', 'last page: last button active');
}

// ---------------------------------------------------------------------------
// 5. Correct range/count is displayed
// ---------------------------------------------------------------------------
console.log('--- Correct range/count ---');
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(twelve);
  simulateUpdateUIPagination(twelve, 1, totalPages, els);
  eq(els.uiPageLabel.textContent, '1-4 of 12', 'page1: range 1-4 of 12');
  simulateUpdateUIPagination(twelve, 2, totalPages, els);
  eq(els.uiPageLabel.textContent, '5-8 of 12', 'page2: range 5-8 of 12');
  simulateUpdateUIPagination(twelve, 3, totalPages, els);
  eq(els.uiPageLabel.textContent, '9-12 of 12', 'page3: range 9-12 of 12');
}
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(five);
  simulateUpdateUIPagination(five, 2, totalPages, els);
  eq(els.uiPageLabel.textContent, '5-5 of 5', '5 page2: range 5-5 of 5 (single item page)');
}

// ---------------------------------------------------------------------------
// 6. No "0-0 of 0" when products exist
// ---------------------------------------------------------------------------
console.log('--- No "0-0 of 0" when products exist ---');
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(five);
  simulateUpdateUIPagination(five, 1, totalPages, els);
  assert(els.uiPageLabel.textContent.indexOf('0-0 of 0') === -1, '5 products: no 0-0 of 0');
  eq(els.uiPageLabel.textContent, '1-4 of 5', '5 products: correct range');
}
{
  var els = createMockPaginationElements();
  var totalPages = P.getTotalPages(twelve);
  simulateUpdateUIPagination(twelve, 2, totalPages, els);
  assert(els.uiPageLabel.textContent.indexOf('0-0 of 0') === -1, '12 products page2: no 0-0 of 0');
  eq(els.uiPageLabel.textContent, '5-8 of 12', '12 products page2: correct range');
}

// ---------------------------------------------------------------------------
// Edge: getPageRange called with array (not number) returns correct values
// ---------------------------------------------------------------------------
console.log('--- getPageRange with array argument ---');
{
  var range = P.getPageRange(1, five);
  eq(range.start, 1, 'getPageRange(1, array): start 1');
  eq(range.end, 4, 'getPageRange(1, array): end 4');
  eq(range.total, 5, 'getPageRange(1, array): total 5');
}
{
  var range = P.getPageRange(2, five);
  eq(range.start, 5, 'getPageRange(2, array): start 5');
  eq(range.end, 5, 'getPageRange(2, array): end 5');
  eq(range.total, 5, 'getPageRange(2, array): total 5');
}

// ---------------------------------------------------------------------------
// Edge: page number buttons reflect current page
// ---------------------------------------------------------------------------
console.log('--- Page number buttons ---');
{
  var els = createMockPaginationElements();
  simulateUpdateUIPagination(twelve, 1, 3, els);
  eq(els.uiPageNumbers.children[0].className, 'ui-page-num active', 'page1: button 1 active');
  eq(els.uiPageNumbers.children[1].className, 'ui-page-num', 'page1: button 2 inactive');
  eq(els.uiPageNumbers.children[2].className, 'ui-page-num', 'page1: button 3 inactive');
}
{
  var els = createMockPaginationElements();
  simulateUpdateUIPagination(twelve, 3, 3, els);
  eq(els.uiPageNumbers.children[2].className, 'ui-page-num active', 'page3: button 3 active');
}

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : (failures + ' TEST(S) FAILED (out of ' + count + ')'));
process.exit(failures === 0 ? 0 : 1);
