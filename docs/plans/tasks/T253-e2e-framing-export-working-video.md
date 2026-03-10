# T253: E2E — Framing Export has_working_video Undefined

## Status: TODO

## Problem

`regression-tests.spec.js` test "Framing: export creates working video @full" fails because `has_working_video` is `undefined` on the project after export.

## Error

```
Error: Export must create a working video (has_working_video flag)
expect(received).toBeTruthy()
Received: undefined
```

At `regression-tests.spec.js:1572`.

## Likely Cause

The export completes but the `has_working_video` flag is not set on the project object returned by the API. Could be:
- Export processing didn't complete in time
- The flag is not being set by the backend after export
- The project fetch doesn't include this field

## Impact

- Single test failure, no cascading
- Pre-existing issue, not caused by any recent change

## Complexity: 2
