# Jarvis UI Evaluation Checklist

Run this before calling the UI done.

## Functional Checks

- Start server with `npm start`.
- Run `npm run check`.
- Verify `/api/status`, `/api/projects`, `/api/kalshi/markets`, `/api/agents`, `/api/settings`, and `/api/brain` return useful JSON or a clear setup error.
- In the browser, test quick command buttons, typed command, mode switching, task add/complete/delete, Gemini key save/test, camera open/capture, screen scan prompt, canvas drawing/export, phone remote pairing, and sub-agent launch/progress.

## Visual Checks

- Capture desktop screenshot at 1440x1000.
- Capture mobile screenshot at 390x844.
- Check that the Three.js canvas is nonblank with pixel readback on both sizes.
- Confirm no console errors after reload and after interactions.
- Confirm no incoherent text overlap, clipped button labels, hidden primary controls, or body-level horizontal scroll.

## States

- Empty state: clear timeline/tasks and verify the app still looks intentional.
- Loading state: Gemini and Kalshi calls show active progress.
- Error state: missing Gemini key, camera denied, screen denied, and phone credentials missing are visible and actionable.
- Permission state: camera and screen access must be initiated by a user gesture.

## Final Delivery

Include the local URL, changed files, and exact verification performed. Mention any feature that requires user-provided third-party credentials.
