#!/usr/bin/env node
/**
 * ReviewRank — Display Pagination tests.
 *
 * Tests the pure functions in lib/pagination.js:
 *   - getTotalPages
 *   - getPageProducts
 *   - getPageRange
 *
 * Also tests the integration of display pagination with the
 * ranked product pipeline.
 *
 * Run: node tests/pagination.test.js
 */
'use strict';

const P = require('../lib/pagination.js');

var failures = 0;
function assert(cond, label) {
  if (cond) console.log('PASS: ' + label);
  else { failures++; console.log('FAIL: ' + label); }
}
function eq(actual, expected, label) {
  assert(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

// ---------------------------------------------------------------------------
// getTotalPages
// ---------------------------------------------------------------------------
console.log('--- getTotalPages ---');
eq(P.getTotalPages([]), 0, 'total: empty set → 0');
eq(P.getTotalPages([1, 2, 3, 4]), 1, 'total: exactly 4 → 1');
eq(P.getTotalPages([1, 2, 3, 4, 5]), 2, 'total: 5 → 2');
eq(P.getTotalPages([1, 2, 3, 4, 5, 6, 7, 8]), 2, 'total: 8 → 2');
eq(P.getTotalPages([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, 'total: 9 → 3');
eq(P.getTotalPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 3, 'total: 12 → 3');
eq(P.getTotalPages([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 4, 'total: 13 → 4');
eq(P.getTotalPages(null), 0, 'total: null → 0');
eq(P.getTotalPages([1, 2, 3], 2), 2, 'total: custom pageSize 2 → 2');
eq(P.getTotalPages([1, 2, 3, 4], 0), 1, 'total: pageSize 0 → defaults to PAGE_SIZE');

// ---------------------------------------------------------------------------
// getPageProducts
// ---------------------------------------------------------------------------
console.log('--- getPageProducts ---');
var products = [];
for (var i = 1; i <= 12; i++) products.push({ id: i, reviewCount: (13 - i) * 1000 });

eq(P.getPageProducts([], 1).length, 0, 'page: empty → []');
eq(P.getPageProducts(products, 0).length, 0, 'page: page 0 → []');
eq(P.getPageProducts(products, -1).length, 0, 'page: negative → []');
eq(P.getPageProducts(products, 5).length, 0, 'page: beyond max → []');

var page1 = P.getPageProducts(products, 1);
eq(page1.length, 4, 'page: page 1 has 4');
eq(page1[0].id, 1, 'page1[0] = id 1');
eq(page1[3].id, 4, 'page1[3] = id 4');

var page2 = P.getPageProducts(products, 2);
eq(page2.length, 4, 'page: page 2 has 4');
eq(page2[0].id, 5, 'page2[0] = id 5');
eq(page2[3].id, 8, 'page2[3] = id 8');

var page3 = P.getPageProducts(products, 3);
eq(page3.length, 4, 'page: page 3 has 4');
eq(page3[0].id, 9, 'page3[0] = id 9');
eq(page3[3].id, 12, 'page3[3] = id 12');

// Custom page size
var pageCustom = P.getPageProducts(products, 1, 6);
eq(pageCustom.length, 6, 'page: custom pageSize 6 → 6');
eq(pageCustom[5].id, 6, 'pageCustom[5] = id 6');

// ---------------------------------------------------------------------------
// getPageRange
// ---------------------------------------------------------------------------
console.log('--- getPageRange ---');
var range0 = P.getPageRange(1, []);
eq(range0.start, 0, 'range: empty → start 0');
eq(range0.end, 0, 'range: empty → end 0');
eq(range0.total, 0, 'range: empty → total 0');

var range1 = P.getPageRange(1, products);
eq(range1.start, 1, 'range: page 1 start → 1');
eq(range1.end, 4, 'range: page 1 end → 4');
eq(range1.total, 12, 'range: page 1 total → 12');

var range2 = P.getPageRange(2, products);
eq(range2.start, 5, 'range: page 2 start → 5');
eq(range2.end, 8, 'range: page 2 end → 8');

var range3 = P.getPageRange(3, products);
eq(range3.start, 9, 'range: page 3 start → 9');
eq(range3.end, 12, 'range: page 3 end → 12');

var rangeBeyond = P.getPageRange(4, products);
eq(rangeBeyond.start, 0, 'range: beyond → start 0');
eq(rangeBeyond.end, 0, 'range: beyond → end 0');

// ---------------------------------------------------------------------------
// Integration: ranking before slicing
// ---------------------------------------------------------------------------
console.log('--- Integration: ranking before slicing ---');

// Simulate ranked products (sorted by reviewCount DESC)
var ranked = [
  { id: 'A', reviewCount: 50000 },
  { id: 'B', reviewCount: 30000 },
  { id: 'C', reviewCount: 20000 },
  { id: 'D', reviewCount: 10000 },
  { id: 'E', reviewCount: 8000 },
  { id: 'F', reviewCount: 5000 },
  { id: 'G', reviewCount: 3000 },
  { id: 'H', reviewCount: 1000 },
  { id: 'I', reviewCount: 500 },
  { id: 'J', reviewCount: 100 }
];

// Page 1: top 4 (A, B, C, D) — highest review counts
var p1 = P.getPageProducts(ranked, 1);
eq(p1.length, 4, 'integration: page 1 has 4');
eq(p1[0].reviewCount, 50000, 'integration: page1 #1 = 50k');
eq(p1[1].reviewCount, 30000, 'integration: page1 #2 = 30k');
eq(p1[2].reviewCount, 20000, 'integration: page1 #3 = 20k');
eq(p1[3].reviewCount, 10000, 'integration: page1 #4 = 10k');

// Page 2: next 4 (E, F, G, H)
var p2 = P.getPageProducts(ranked, 2);
eq(p2.length, 4, 'integration: page 2 has 4');
eq(p2[0].reviewCount, 8000, 'integration: page2 #5 = 8k');
eq(p2[1].reviewCount, 5000, 'integration: page2 #6 = 5k');
eq(p2[2].reviewCount, 3000, 'integration: page2 #7 = 3k');
eq(p2[3].reviewCount, 1000, 'integration: page2 #8 = 1k');

// Page 3: remaining 2 (I, J)
var p3 = P.getPageProducts(ranked, 3);
eq(p3.length, 2, 'integration: page 3 has 2');
eq(p3[0].reviewCount, 500, 'integration: page3 #9 = 500');
eq(p3[1].reviewCount, 100, 'integration: page3 #10 = 100');

// No duplicates across pages
var allShown = p1.concat(p2).concat(p3);
var ids = {};
var hasDuplicates = false;
for (var i = 0; i < allShown.length; i++) {
  if (ids[allShown[i].id]) { hasDuplicates = true; break; }
  ids[allShown[i].id] = true;
}
assert(!hasDuplicates, 'integration: no duplicates across pages');
assert(allShown.length === ranked.length, 'integration: all products shown across pages');

// ---------------------------------------------------------------------------
// Edge cases: 0-4 products → no pagination
// ---------------------------------------------------------------------------
console.log('--- Edge: 0-4 products → no pagination ---');
eq(P.getTotalPages([]), 0, 'edge: 0 products → 0 pages');
eq(P.getTotalPages([1, 2, 3], 4), 1, 'edge: 3 products → 1 page');
eq(P.getTotalPages([1, 2, 3, 4], 4), 1, 'edge: 4 products → 1 page');
assert(P.getPageProducts([1, 2, 3], 1).length === 3, 'edge: 3 products shown on page 1');

// ---------------------------------------------------------------------------
// Edge cases: 5-8 products → 2 pages
// ---------------------------------------------------------------------------
console.log('--- Edge: 5-8 products → 2 pages ---');
var five = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
eq(P.getTotalPages(five), 2, 'edge: 5 → 2 pages');
eq(P.getPageProducts(five, 1).length, 4, 'edge: 5 page 1 → 4');
eq(P.getPageProducts(five, 2).length, 1, 'edge: 5 page 2 → 1');

var eight = [];
for (var j = 1; j <= 8; j++) eight.push({ id: j });
eq(P.getTotalPages(eight), 2, 'edge: 8 → 2 pages');
eq(P.getPageProducts(eight, 1).length, 4, 'edge: 8 page 1 → 4');
eq(P.getPageProducts(eight, 2).length, 4, 'edge: 8 page 2 → 4');

// ---------------------------------------------------------------------------
// Edge cases: 9-12 products → 3 pages
// ---------------------------------------------------------------------------
console.log('--- Edge: 9-12 products → 3 pages ---');
var nine = [];
for (var k = 1; k <= 9; k++) nine.push({ id: k });
eq(P.getTotalPages(nine), 3, 'edge: 9 → 3 pages');
eq(P.getPageProducts(nine, 1).length, 4, 'edge: 9 page 1 → 4');
eq(P.getPageProducts(nine, 2).length, 4, 'edge: 9 page 2 → 4');
eq(P.getPageProducts(nine, 3).length, 1, 'edge: 9 page 3 → 1');

var twelve = [];
for (var m = 1; m <= 12; m++) twelve.push({ id: m });
eq(P.getTotalPages(twelve), 3, 'edge: 12 → 3 pages');
eq(P.getPageProducts(twelve, 1).length, 4, 'edge: 12 page 1 → 4');
eq(P.getPageProducts(twelve, 3).length, 4, 'edge: 12 page 3 → 4');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : (failures + ' TEST(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
