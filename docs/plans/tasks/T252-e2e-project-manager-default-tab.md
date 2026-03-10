# T252: E2E — Project Manager Default Tab Mismatch

## Status: TODO

## Problem

`full-workflow.spec.js` test "1. Project Manager loads correctly" fails because it expects `button:has-text("New Project")` to be visible on page load, but the UI defaults to the **Games** tab (which shows "Add Game" instead).

The page loads correctly — the test user is created and isolated — but the assertion assumes the Projects tab is the default.

## Error

```
Error: expect(locator).toBeVisible() failed
Locator: locator('button:has-text("New Project")')
Expected: visible
Timeout: 60000ms
```

## Page Snapshot

The page shows Games tab content: "Games" tab active, "Add Game" button visible, "No games yet" message.

## Fix Options

1. **Fix the test** — click "Projects" tab first before asserting "New Project" button
2. **Fix the test** — assert "Add Game" instead (matches the default Games tab)

## Impact

- 8 downstream tests don't run because this is the first test in a serial suite
- Pre-existing issue, not caused by any recent change

## Complexity: 1
