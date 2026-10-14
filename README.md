# Jev Browser Workspace · v0.3

A local browser agent with TypeSafe Jev choosing actions and a Chromium extension carrying them out. It works through browser pages, controls and native input; it does not replace website interactions with hidden site APIs.

## Start and connect

Requires Node.js 20.19+ and Chrome, Edge, or Brave based on Chromium 125+.

```sh
npm install
cp .env.example .env  # only if .env does not already exist
# Set TYPESAFE_API_KEY in .env.
npm start
```

Open http://localhost:3210. Load the `extension/` folder using your browser's extensions page: enable Developer mode, then Load unpacked. Name the browser/profile and paste the token from the workspace's **Connection setup** into the companion popup. Repeat for other browsers/profiles if needed.

**Upgrading from v0.1:** reload the companion on the extensions page and accept the updated permissions. It now needs `debugger` for browser-native input and `downloads` to track downloads. Chrome displays its own debugging/control banner while Jev owns a tab. Opening DevTools on an owned tab can detach the agent; close DevTools before resuming.

Loading the extension is a one-time setup. Pairing now survives local-server restarts: the server stores its random token in the private `.jev-data/connection-token` file and the companion remembers it. Start the local server when you need the agent; the extension reconnects automatically. Deleting that token or changing `JEV_CONNECTION_TOKEN` requires pairing again. The companion currently uses port 3210; changing PORT also requires updating its connection URL and CSP.

## Chat workspace and visible actions

Send tasks from the chat composer. Task options hold the browser, starting page, attachments, and optional helpers. Replies to paused tasks revise their instructions and resume the same task; follow-up messages after completion use the previous task tab unless a new conversation or starting page is selected.

The browser panel shows the action target, a colored pointer, and before/after screenshots. Mouse movement can publish intermediate views. Up to 30 recent views per task remain available in the visual timeline; selecting one holds it for review until **Return to live view** is clicked. These are action snapshots, not a continuous video stream. Full action logs and interpreted steps are expandable. **Take over** pauses the task and activates the actual task tab; switch away before resuming.

**Updating to v0.3:** reload the installed companion on the extensions page, then refresh the workspace. No new extension permissions are required. Preparation reports tab creation, control attachment, and page loading separately. Browser protocol calls and cleanup have deadlines, so a hung operation cannot indefinitely block the companion queue. API errors identify the failing browser operation.

Conversational requests such as “go into the website of … and give me the first 3 headlines” become ordered navigation and extraction steps. The chat displays saved page evidence. Headline replies currently show observed headings in page order; generated summaries still require a helper.

## Browser actions

| Capability | Implementation / scope |
| --- | --- |
| Click, double-click, right-click | Native DevTools mouse input; no OS cursor movement |
| Hover | Native pointer movement for menus and tooltips |
| Type and replace text | Native mouse focus, select-all, text insertion and blur; supports ordinary inputs and editors |
| Keyboard | Enter, Tab, Shift+Tab, Escape, arrows, deletion, Home/End, Page Up/Down, Space and select-all |
| Copy and paste | Task-local selected text; leaves the OS clipboard alone |
| Find text | Finds supplied text in page content without opening browser chrome |
| Native selects | Validated observed option plus input/change events |
| Scrolling | Main viewport, nested scroll areas, and scroll-to for offscreen controls |
| Drag and drop | Native pointer drag between observed controls in the same frame; site compatibility varies |
| Navigation | Named websites resolved through browser search, bare domains, supplied URLs and observed links; back, forward and reload |
| Multiple tabs | Up to eight task-owned background tabs; switch task context without activating a user tab; only task-created tabs can be closed |
| Frames | Isolated observations and actions per frame, including out-of-process/cross-origin frames; translate points through parent frames |
| Shadow DOM | Open roots plus semantic controls surfaced through the accessibility tree from closed roots |
| Upload | Files explicitly attached to the task; uses the browser's file-input protocol, including hidden file inputs; intercepts native pickers |
| Downloads | Normal browser downloads; correlates immediate downloads with the owned page and tracks state/filename |
| JavaScript dialogs | Alert/confirm/prompt handling through the browser protocol; prompt values must be supplied |
| Extraction | Text, links and tables from the page and frames; JSON/CSV exports |
| Screenshot view | A live background-page preview in the workspace |
| Visual-only controls | Optional vision helper proposes bounded screenshot coordinates; Jev chooses whether/where to interact |
| Generated form text | Optional text helper proposes field text and next-step advice; Jev selects the action/value |

The API integration has been checked against live TypeSafe responses for typing, hovering, and selecting an attached upload file. A live Chrome companion test also filled the Email field, extracted the expected pricing table, and completed in three decisions; saved pairing reconnected after a server restart. This is action coverage, not proof of reliability equal to commercial agents. End-to-end website behavior depends on the loaded companion, site widgets, browser policies, and model decisions.

## Commands and planning

The starting URL is optional when your command identifies a website. For example, `Go to the New York Times website, then click the science section and extract the headlines`. A named site starts an ordinary Google search for its official website; Jev chooses an observed result rather than inventing a domain. Search consent screens, CAPTCHA and network restrictions can still block that route. A bare domain such as `Visit nytimes.com` also works.

Explicit sequences using “then”, “and” followed by an action, and semicolons before actions become ordered steps shown in Live activity. Field assignments such as `name: Alex; email: alex@example.com` stay together. Each step receives live page state, and later steps stay pending until the current one completes. Search results cannot complete a website-navigation step; extraction steps require newly saved results. Instructions beginning “Do not”, “Don’t” or “Never” after sentence separators are carried across steps.

This is a bounded command parser, not a general language-model planner. Complex dependencies, implicit steps, corrections and arbitrary phrasing are not fully interpreted. Jev chooses interactions on each live page; supplied form values can use quotes, label/value assignments, “Type Alex into the name field”, or “Fill the message field with Hello team”. Generated prose still needs the optional helper. For a form-only task in a new tab, name its website or provide a starting page; an existing tab already supplies that context.

## Tasks and user control

Choose a connected browser and one of:

- **New background tab** (recommended): uses that browser/profile's current session without activating the tab.
- **Separate background window**: asks for an unfocused window in the same profile; cookies are shared.
- **Existing tab**: must be in the background; the agent will not close this borrowed tab.

The companion checks ownership/focus before each native input command and validates page controls in an isolated world. Native DevTools input can give a background renderer internal focus, so human takeover is determined by Chrome’s actual tab/window state rather than renderer focus alone. Opening an owned tab, focusing its active window, or trusted physical page input pauses and releases the task. Click **Resume task** after switching away. You can supply a revised goal in the optional clarification field. Login, passwords, CAPTCHA, missing information, and unsupported browser UI require user takeover.

Stop cancels model requests and locks the companion against further input. Effects of an interaction already executing cannot be undone. Main-world guards suppress normal popup and window-focus calls; standard new-window links are routed within the assigned tab. Use explicit **OPEN_TAB** actions for multi-tab work. These are application-level protections, not a guarantee against every browser dialog or arbitrary site behavior.

The page border, toolbar badge, highlighted target and agent dot identify activity. Purple indicates navigation/interactions, blue typing, green extraction/upload, and amber visual interactions. Screenshots in the workspace are observational; opening the target page gives you normal manual control and pauses Jev.

## Optional text and vision assistance

Jev returns typed choices, not generated prose or image understanding. For those capabilities, configure a provider implementing the Chat Completions interface:

```dotenv
HELPER_BASE_URL=https://api.openai.com/v1
HELPER_MODEL=your-text-or-vision-model
HELPER_API_KEY=your-provider-key
```

A compatible local provider can use a localhost URL and omit the key if its endpoint permits that. The provider/model must support JSON mode; visual assistance additionally requires image inputs. No helper model is enabled by default.

Restart the server and enable **Text assistance** for the task; **Visual assistance** is a separate opt-in. The helper proposes prose, next-step advice and optional CSS viewport points. Jev still selects every executable action from the offered choices. Generated values are tied to observed fields; never use them to invent personal information. Completion can be checked against the helper's observed evidence. If the helper fails, the task continues with Jev's ordinary action choices.

Relevant page content and your goal are sent to TypeSafe. When assistance is enabled, they also go to the configured helper; screenshots go to it only with Visual assistance. The TypeSafe and helper API keys stay on the local server, and `.env` is ignored by Git.

## Uploads, exports and limits

Attach up to 20 files per task, at most 10 MB each. Files are staged with private permissions under `.jev-data/`; model choices contain metadata/IDs, never arbitrary local paths. Only files attached to that task can be passed to a site's upload input. Remove a staged attachment with its × button. Staged files remain on disk until removed; a server restart clears their in-memory catalog, so attach them again for a new task. Do not store this directory in source control or a public web directory.

The default budget is 100 steps, configurable up to 300. Resume grants another budget while preserving action history and task tabs. Requests have timeouts; rate-limit/overload responses retry with bounded backoff. A rejected or stale target causes a fresh observation. An unchanged page is extracted once and saved result summaries inform the next decision. Repeated failures or unchanged pages hand control back to you instead of looping indefinitely.

Extraction is bounded: up to 200,000 combined text characters, 1,000 links, and 50 tables across inspected frames. A frame's own table extraction is limited to 20 tables of 500 rows each. Exports include source URLs, timestamps, actions and download activity. Results/history are held in server memory (normally 30 runs); export before restarting. Pairing is persistent; task state is not.

## Known gaps

Safari/Firefox, browser settings/extension UI, arbitrary browser-global shortcuts, OS dialogs, CAPTCHA/password automation, popup-based authentication, rotated iframe interactions, cross-frame dragging, and drag behavior requiring specialized HTML5 interception are not validated/supported. Closed shadow roots without accessible controls need the optional vision path. Some custom editors/date pickers, PDF viewers and heavily dynamic pages may need manual help. Background rendering or downloads may be restricted by browser/enterprise policy. Download tracking uses source-page correlation and may miss delayed/redirected downloads.

Native input removes the first version's synthetic-click limitation, but this is still an agent under development. Matching commercial-agent success rates requires a wider live-site evaluation suite and a configured text/vision model where relevant.

## Test and develop

```sh
npm run dev
npm test
node --env-file=.env scripts/verify-jev.js  # three live API checks; uses credits
node scripts/smoke-browser.js              # paired Chrome + local fixture; uses credits
node scripts/smoke-navigation.js           # named-site command without a URL; uses credits
```

Regression tests cover exact-choice validation, native input sequences, per-input ownership checks, drag release, frame coordinate routing, upload paths, hidden file inputs, DOM/shadow observations, stale/covered targets, visual bounds, helper advice, local bridge orchestration, pause/resume, staged attachments and origin restrictions. Native protocol tests use a mocked Chrome transport, DOM tests use JSDOM, and bridge tests mock TypeSafe. They do not validate every browser/site behavior.

Use the local action playground at http://localhost:3210/fixture to exercise forms, menus, native clicks, keyboard input, drag/drop, nested scrolling, open/closed shadow roots, frames, dialogs and downloads after loading the companion.

Implementation: `server.js` orchestrates tasks; `agent.js` defines Jev choices; `extension/driver.js` handles DevTools input/frames; `extension/page.js` observes/validates controls; `extension/background.js` handles browser ownership and pairing; `lib/helper.js` provides opt-in advice; `public/` contains the workspace and fixture.

Official references: [TypeSafe API](https://docs.typesafe.ai/api), [Jev decisions](https://docs.typesafe.ai/concepts/system-one), [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [Chrome extension WebSocket lifecycle](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets), and [Chat Completions text/image inputs](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
