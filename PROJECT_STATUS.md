# Project status — 2026-10-14

## Current state

Version 0.3.0 is saved in package.json, package-lock.json and extension/manifest.json. New feature work was stopped at the user's request; the current scope is verification and documentation.

The local workspace is served at http://localhost:3210. npm run dev was started during this session; process lifetime is not guaranteed after this session. If unreachable, run npm start from the project root. Node.js 20.19+ is required; validation used Node 20.20.0.

The original verification handoff saved source files to disk while they were still untracked. The user subsequently requested a Git commit and GitHub push of this v0.3 checkpoint. No GitHub remote was configured at that point; check git status, git log and git remote -v for the current commit/publication state.

## Implemented in this iteration

- Replaced the form/dashboard layout with a chat composer, user messages, conversational task status, inline saved evidence and expandable settings/logs.
- Added a large browser preview next to chat with up to 30 recent screenshot views per task. Before/after action views remain reviewable; selecting a thumbnail pins it until Return to live view.
- Added target marking before an action and intermediate pointer views during native movement. Text input continues to use browser-native events.
- Added explicit Take over: pause/release automation, then activate the actual task tab and its window. Resume uses retained task tabs.
- Added chat replies for revising paused tasks, new-conversation selection, and follow-up tasks using the previous tab when no new starting page is supplied.
- Added preparation progress for tab/window creation, debugger attachment and page loading.
- Added browser protocol deadlines, attach failure cleanup and bounded release. RPC timeouts identify the browser operation rather than reporting a generic timeout.
- Page loading waits are bounded; a site whose ads keep loading can proceed to document inspection.
- Extended the bounded parser for “go into/on …” and “give/show/list/tell …” requests, including navigation followed by headline extraction.
- Extraction now includes observed visible headings; headline chat output lists them in page order with the requested first/top count where recognized.
- Fixed saved-result rendering when returning to a historical task after starting a new conversation.

## Diagnosed failures and evidence

1. The original failing integration test used a stale mock provider. The server had moved to two-stage decisions; the mock tried to access page elements during the argument request, where elements are intentionally omitted. Fixed tests/mock-provider.js to choose from offered argument criteria. This was a test-double defect.
2. Live task records showed Browser operation timed out before the first action, including on the local fixture. The old companion was connected and publishing its browser identity, but did not return preparation results. The exact Chrome protocol operation was not observable in that version.
3. The revised companion now bounds browser calls and reports preparation stages, addressing the unbounded queue failure mode. This has been verified against mocked Chrome APIs, but the exact original live failure is not yet confirmed resolved.
4. Original previews were captured before actions and overwritten during the next observation. Before/after storage and pointer views now preserve action evidence.

## Validation

Final verification: npm test passed all 45 tests with local port access. All 25 JavaScript files passed node --check. JSON metadata parsed successfully and versions match 0.3.0.

Coverage includes:
- Operation and argument grounding, confidence gates, model context compaction and stale choices.
- Native mouse/key sequences, ownership checks before each input, drag release, frames, uploads and dialog ownership.
- Page/shadow observations, hidden file inputs, stale/covered controls, extraction and physical-input guards.
- Chat rendering, plain-text handling of user/page/error content, paused-task replies, new/history switching, offline send disabling and pinned/live preview selection.
- Actual companion module running against mocked Chrome/WebSocket APIs: preparation, progress, non-input preview, native typing, intermediate images, heading/table extraction, release, explicit takeover, focused-tab rejection and recovery after failed attachment.
- Local HTTP/WebSocket integration with a mock provider: typed actions, extraction, planning, pause/resume, uploads, host/origin restrictions, image endpoint, before/after metadata and takeover.
- Timeout rejection and subsequent-command availability.

Mocked tests do not prove real Chrome rendering, screenshot appearance, site compatibility, latency, or live TypeSafe decision quality.

## Remaining verification / limitations

- The last inspected connected Chrome companion still reported protocol version 2. The server now requires version 3. Reload the installed Jev Browser Companion at chrome://extensions before running live tasks. Existing pairing should be reused.
- This iteration has not completed a successful live Chrome/TypeSafe fixture run after the changes. The previous fixture run failed during preparation on the old extension. No claim of full end-to-end success should be made.
- Visual layout has not been inspected in a rendered browser during this iteration. Computer Use could not inspect Chrome's then-current URL; an in-app browser was unavailable. JSDOM validates UI behavior, not CSS/layout.
- The chat currently formats saved page evidence; it is not a general conversational language model. Headline output uses visible headings and can include section headings. Generated summaries/prose still require a configured helper.
- Replies to paused tasks replace the task goal/plan; they are not automatic merges of all previous instructions. User messages are retained, but full assistant-message history is not a persistent chat transcript.
- Attachments are supplied when starting a task; attaching additional files to a paused task is not implemented.
- Visual history holds only the latest 30 views and is lost on server restart. It is an action snapshot stream, not a continuous remote browser/video.
- Arbitrary Chrome tab/window API calls can still require further investigation if the new stage logs show they are hanging. Broader site validation remains outstanding.
- See README Known gaps for unsupported browser UI, authentication, frames/widgets and browser policies.

## Next verification sequence

1. Start npm start (or keep npm run dev running); open http://localhost:3210.
2. Reload the installed companion and confirm /api/state reports browser.version = 3, without printing the connection token.
3. Refresh the workspace. Select Try a form, which supplies the local fixture URL, then send:
   Fill email: alex@example.com; then extract the pricing table. Do not submit any form.
4. Confirm completion, actual Email value, saved pricing table, blue typing marker, before/after views and no automatic foreground activation.
5. Run node scripts/smoke-browser.js for the same live fixture. It uses TypeSafe credits and expects the paired version-3 companion.
6. During a fixture task, test Stop, Take over, reply/revise and Resume. After takeover switch away from the owned tab before resuming.
7. Run node scripts/smoke-navigation.js to test named-site navigation. Search consent/CAPTCHA can require manual help.
8. Inspect desktop and narrow-window layouts, review pinned action thumbnails, and verify exports. Record live outcomes and any concrete failing stage in this file.

Do not resume feature development without a new user request. Resolve regressions within the saved scope first.
