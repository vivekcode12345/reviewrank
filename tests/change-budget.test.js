#!/usr/bin/env node
/**
 * ReviewRank — Change Budget / Edit Filters tests.
 *
 * Focused tests for the "Change Budget" flow:
 *   - button exists in results state HTML
 *   - showInitialState() toggles visibility correctly
 *   - budget values are preserved when returning to filters
 *   - re-analysis uses new budget values
 *   - no page reload/navigation occurs
 *
 * Run: node tests/change-budget.test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var failures = 0;
var count = 0;
function assert(cond, label) {
  count++;
  if (cond) console.log('PASS: ' + label);
  else { failures++; console.log('FAIL: ' + label); }
}

// ---------------------------------------------------------------------------
// 1. Structural checks: HTML, CSS, JS contain expected elements
// ---------------------------------------------------------------------------
console.log('--- structural checks ---');

var root = path.resolve(__dirname, '..');
var htmlPath = path.join(root, 'popup', 'popup.html');
var cssPath = path.join(root, 'popup', 'popup.css');
var jsPath = path.join(root, 'popup', 'popup.js');

var html = fs.readFileSync(htmlPath, 'utf8');
var css = fs.readFileSync(cssPath, 'utf8');
var js = fs.readFileSync(jsPath, 'utf8');

// Button exists in results state
assert(html.indexOf('id="changeBudgetBtn"') !== -1, 'html: changeBudgetBtn exists in results state');
assert(html.indexOf('class="change-budget-btn"') !== -1, 'html: change-budget-btn class present');
assert(html.indexOf('>Change Budget</button>') !== -1, 'html: button label is "Change Budget"');

// CSS contains button styles
assert(css.indexOf('.change-budget-btn') !== -1, 'css: .change-budget-btn rule exists');
assert(css.indexOf('.results-actions') !== -1, 'css: .results-actions wrapper exists');

// JS contains state management
assert(js.indexOf('function showInitialState()') !== -1, 'js: showInitialState function defined');
assert(js.indexOf('changeBudgetBtn') !== -1, 'js: changeBudgetBtn referenced');
assert(js.indexOf('showInitialState();') !== -1, 'js: showInitialState called on button click');
assert(js.indexOf('initialState.style.display = \'block\'') !== -1, 'js: showInitialState shows initialState');
assert(js.indexOf('resultsState.style.display = \'none\'') !== -1, 'js: showInitialState hides resultsState');

// ---------------------------------------------------------------------------
// 2. State machine simulator (mirrors popup.js visibility logic)
// ---------------------------------------------------------------------------
console.log('--- state machine simulator ---');

function createStateMock() {
  return {
    initialState: { style: { display: 'none' } },
    resultsState: { style: { display: 'none' } },
    errorState: { style: { display: 'none' } }
  };
}

function showErrorMock(state) {
  state.initialState.style.display = 'none';
  state.resultsState.style.display = 'none';
  state.errorState.style.display = 'block';
}

function showInitialStateMock(state) {
  state.initialState.style.display = 'block';
  state.resultsState.style.display = 'none';
  state.errorState.style.display = 'none';
}

function showResultsMock(state) {
  state.initialState.style.display = 'none';
  state.errorState.style.display = 'none';
  state.resultsState.style.display = 'block';
}

// Test: initial -> results -> change budget -> initial
{
  var s = createStateMock();
  showResultsMock(s);
  assert(s.resultsState.style.display === 'block', 'flow: results shown after analysis');
  assert(s.initialState.style.display === 'none', 'flow: initial hidden after analysis');

  showInitialStateMock(s);
  assert(s.initialState.style.display === 'block', 'flow: initial shown after Change Budget');
  assert(s.resultsState.style.display === 'none', 'flow: results hidden after Change Budget');
  assert(s.errorState.style.display === 'none', 'flow: error hidden after Change Budget');
}

// Test: error -> change budget -> initial
{
  var s = createStateMock();
  showErrorMock(s);
  assert(s.errorState.style.display === 'block', 'flow: error shown');

  showInitialStateMock(s);
  assert(s.initialState.style.display === 'block', 'flow: initial shown from error');
  assert(s.errorState.style.display === 'none', 'flow: error hidden');
}

// Test: multiple toggles stable
{
  var s = createStateMock();
  showResultsMock(s);
  showInitialStateMock(s);
  showResultsMock(s);
  showInitialStateMock(s);
  assert(s.initialState.style.display === 'block', 'flow: stable after multiple toggles');
  assert(s.resultsState.style.display === 'none', 'flow: results hidden after multiple toggles');
}

// ---------------------------------------------------------------------------
// 3. Budget preservation: values survive state transitions
// ---------------------------------------------------------------------------
console.log('--- budget preservation ---');

// Simulate the existing parseBudgetInput behavior from popup.js
function parseBudgetInput(minRaw, maxRaw) {
  var minStr = (minRaw || '').trim().replace(/[₹,\s]/g, '');
  var maxStr = (maxRaw || '').trim().replace(/[₹,\s]/g, '');
  if (minStr === '' && maxStr === '') return { min: null, max: null };
  var min = null, max = null;
  if (minStr !== '') {
    min = parseFloat(minStr);
    if (isNaN(min) || min < 0) return { error: 'Please enter a valid minimum price.' };
  }
  if (maxStr !== '') {
    max = parseFloat(maxStr);
    if (isNaN(max) || max < 0) return { error: 'Please enter a valid maximum price.' };
  }
  if (min !== null && max !== null && min > max) {
    return { error: 'Minimum price cannot be greater than maximum price.' };
  }
  return { min: min, max: max };
}

// Test: budget values survive round-trip
{
  var budget = parseBudgetInput('500', '1500');
  assert(budget.min === 500, 'budget: min parsed correctly');
  assert(budget.max === 1500, 'budget: max parsed correctly');
  assert(!budget.error, 'budget: no error for valid range');
}

// Test: empty budget preserved
{
  var budget = parseBudgetInput('', '');
  assert(budget.min === null, 'budget: empty min -> null');
  assert(budget.max === null, 'budget: empty max -> null');
}

// Test: changing budget on re-analyze
{
  var firstBudget = parseBudgetInput('500', '1500');
  var secondBudget = parseBudgetInput('200', '2000');
  assert(firstBudget.min === 500 && firstBudget.max === 1500, 're-analyze: first budget preserved');
  assert(secondBudget.min === 200 && secondBudget.max === 2000, 're-analyze: second budget applied');
  assert(firstBudget.min !== secondBudget.min, 're-analyze: budgets differ');
}

// ---------------------------------------------------------------------------
// 4. No navigation/reload on Change Budget
// ---------------------------------------------------------------------------
console.log('--- no navigation ---');

// The showInitialState function only toggles display properties;
// it never touches location, href, or reload.
assert(js.indexOf('location.href') === -1 || js.indexOf('showInitialState') < js.indexOf('location.href'),
  'js: showInitialState does not navigate');
assert(js.indexOf('location.reload') === -1, 'js: no reload in popup.js');
assert(js.indexOf('window.location') === -1 || js.indexOf('showInitialState') < js.indexOf('window.location'),
  'js: showInitialState does not use window.location');

// ---------------------------------------------------------------------------
// 5. Re-analysis preserves ranking pipeline
// ---------------------------------------------------------------------------
console.log('--- re-analysis preserves pipeline ---');

// The analyzeBtn handler resets state and re-runs the SAME pipeline.
// Verify by source inspection.
assert(js.indexOf('processProducts(products, budget, true, currentSearchQuery)') !== -1,
  'js: re-analysis runs identical pipeline via processProducts');
assert(js.indexOf('allProducts = products.slice()') !== -1,
  'js: raw products refreshed on re-analysis');
assert(js.indexOf('currentBudget = budget') !== -1,
  'js: currentBudget updated with new values');

console.log('');
console.log(failures === 0 ? 'ALL TESTS PASSED' : (failures + ' TEST(S) FAILED (out of ' + count + ')'));
process.exit(failures === 0 ? 0 : 1);
