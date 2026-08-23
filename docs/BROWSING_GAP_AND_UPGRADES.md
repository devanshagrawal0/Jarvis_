# Browsing: where JARVIS stands against current practice, and what has to change

Written 2026-08-23, after the measured run recorded in `BROWSING_PATH_TEST_LOG.md`.
Deferred by the owner until after Stage Wave 4. Nothing here is implemented.

The left column is measured on the owner's own machine, through the running server, on 2026-08-23.
The right column is published practice, with sources at the foot.

## Side by side

| | JARVIS, measured | Current practice |
|---|---|---|
| tools the model chooses from | **159** | Claude in Chrome ships **21**; Playwright MCP ~25; Anthropic documents accuracy degrading past **30-50** |
| what that costs | 9 consecutive failed calls to an invented tool name (`google:open_url`) in one turn | tool retrieval measured **49% -> 74%** (Anthropic MCP eval), **13.6% -> 43.1%** (RAG-MCP) |
| how it reads a page | screenshot + vision model, in 3 of 10 measured turns | structural read of the live page |
| cost of one page read | **3000-5000 tokens** plus ~0.8 s of vision inference | **200-400 tokens**, no vision |
| how it clicks | a screen coordinate, e.g. `x: 2395, y: 980` | an element handle; the browser does the aiming |
| what that caused | the click landed on JARVIS's own window; the video never played | an overlay cannot intercept a handle |
| a multi-step web task | **70 s, 4 tools, failed** (open YouTube, list videos, play one) | DOM-first **68 s** vs screenshot-first **330 s**, a **4.9x** gap |
| a simple open | **9.4 s**, 1 tool | one message to the browser |
| open and read | **16.2 s**, 3 tools, correct | two messages |
| a typical request | median **10.1 s**, **2.2 tools** | - |
| the worst request | **26 s, 9 tools, no result** | - |
| opening a URL | shells out through PowerShell: **400-600 ms** of shell startup before anything happens, worse on a OneDrive-redirected profile | in-process `ShellExecuteW`, or one CDP message |
| which browser | three competing notions: the owner's Chrome, a hidden managed browser, and synthetic mouse/keyboard on the desktop | the owner's own Chrome, and only that |
| listing the owner's tabs | not possible; it screenshotted and answered `"6"` when he had 3 | one call returns every tab's title and URL |
| proof an action happened | `ok: true` - the tool marks its own homework | post-state comes back with the result: final URL, page title, a fresh read |
| catching a false claim | a model judge (added 2026-08-23) that catches off-screen claims only | signed tool receipts, **94.2%** detection at **<15 ms** |
| model round-trips per turn | **2 Pro-class calls**, ~8.6 s of a 10 s turn | one streaming call, tools fired from partial output |

**Summary in one line:** roughly **5-10x slower on simple requests, and structurally unable to
complete compound ones**. The gap is not tuning. Every fast system reads the page; this one
photographs it.

## What has to change, in order

### 1. Cut the tool menu
159 declarations is far past every published cliff. Consolidate related operations behind an
`action` parameter, namespace the families, keep the handful of hot tools always present, and put
the long tail behind retrieval. Expected to remove most wrong-tool turns, which are the same thing
as most extra tool calls.

### 2. Read the page, do not photograph it
Replace screenshot-and-vision page reading with a structural read. This is what removes the 0.8 s
per look and the 10x token cost, and it is the precondition for the next item.

### 3. Stop clicking pixels
`screen_act` computes an x,y and fires a mouse event. The owner's own windows can always be on top
of that pixel - which is exactly how the play-a-video request failed. Acting on an element handle
removes the failure mode rather than reducing it.

### 4. Attach to the owner's real Chrome over CDP
Viable on Windows in 2026 via `chrome://inspect/#remote-debugging` (Chrome 144+, stable from 146).
No relaunch, and it keeps every login. The `--remote-debugging-port` flag route died for the default
profile in Chrome 136 and is not the path.

Connect by reading `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort` (line 1 the port,
line 2 the websocket path) and opening that socket directly; Chrome 144+ has no HTTP discovery, so
`connectOverCDP` and `browserURL` both fail. Hold ONE long-lived connection so the permission
dialog is once per session rather than once per action.

What it turns into a single call: activate an existing tab; list every open tab with titles and
URLs; read a page's text and links; navigate. All four are currently either slow, unreliable, or
impossible.

Costs to accept, stated plainly: a permission dialog, an "automated test software" banner while
attached, and the process inheriting every logged-in session in the browser.

### 5. Make every tool return what actually happened
No tool should return `ok: true`. Return observed post-state - the final URL, the page title, a
fresh read - so a claim can be checked against evidence rather than against the tool's own opinion.
Then a deterministic pre-reply check: anything named in the answer that appears in no tool output
this turn is fabricated.

### 6. Open a URL without a shell
`ShellExecuteW` through an FFI binding is in-process, needs no escaping (an `&` or `?` in a URL is
literal because nothing parses a command line), and removes several hundred milliseconds per open.

### 7. One model call, not two
The turn spends most of its time in two Pro-class calls. Streaming function calls, and firing
idempotent reads from partial arguments, is measured at ~1.1 s average saving. Never speculate on a
call with a side effect.

## Bugs found in the same run, independent of the architecture

- a hallucinated tool name is retried until the budget dies; duplicate suppression is keyed on
  tool+args, so varying the argument defeats it
- the same prompt routed two different ways on consecutive runs
- "the top headline on bbc.com" was answered from wikipedia.org and indiatimes.com, without
  reading bbc.com and without saying so
- no capability lists the owner's open tabs
- a request to read a specific named page prefers grounded search over reading that page
- replies leak fragments: one began `00s`, another printed a raw `{"text": ..., type: text }`
  envelope as prose

## Sources

platform.claude.com tool-search docs; anthropic.com/engineering/advanced-tool-use;
arXiv 2505.03275 (RAG-MCP); browser-use.com/posts/speed-matters; playwright.dev/mcp/snapshots;
developer.chrome.com/blog/remote-debugging-port; developer.chrome.com/docs/devtools/agents;
github.com/ChromeDevTools/chrome-devtools-mcp; arXiv 2603.10060 (tool receipts);
arXiv 2606.20113 (streaming tool use); learn.microsoft.com ShellExecuteW.
