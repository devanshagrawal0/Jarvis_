# Browsing path — measured test log

Date: 2026-08-23. Machine: the owner's. Backend restarted with the day's changes before the run.
Every prompt below is new wording that appears nowhere in this repo, so nothing here is a test the
system was built against.

Method: real POST /api/chat turns through the running server, timed end to end. Browser state
verified independently afterwards by reading the Windows UI Automation tab tree — never by trusting
the reply text.

## Battery of 10

| # | prompt | ms | tools | what actually happened |
|---|--------|----|-------|------------------------|
| 1 | stick the bbc news front page up for me | 25972 | 9 | **all 9 failed** — model emitted `google:open_url`, a name that exists nowhere; ended in a refusal |
| 2 | whats the top headline on bbc.com right this second | 10065 | 0 | answered live news with **no tool at all** |
| 3 | read me the opening line of the wikipedia article about octopuses | 9021 | 1 | `web_research` (correct answer, wrong tool — `url_read` reads the page) |
| 4 | flick over to my chatgpt tab | 9162 | 1 | `desktop_control` on his screen |
| 5 | what tabs have i got going right now | 9153 | 1 | `screen_capture`; **entire reply was "6"** |
| 6 | throw open hacker news and then tell me what the number one story is | 16211 | 3 | `open_url` -> `url_read` -> `stage_render`; correct top story |
| 7 | get arxiv.org up on my screen | 9396 | 1 | `open_url` |
| 8 | whats playing on my youtube tab at the moment | 24254 | 2 | correct ("nothing is playing"), reply prefixed with stray `00s` |
| 9 | grab the current bitcoin price off coindesk without opening anything | 8631 | 1 | `web_research`, nothing opened — as asked |
| 10 | open reddit for me and scroll down a bit | 20325 | 3 | `computer_use` hit a CAPTCHA and failed; `open_url` + `desktop_control` recovered |

Median 10.1 s. Mean 14.2 s. 22 tool calls for 10 requests. 2 of 10 turns contained a failed tool.

Independent check after the run: focused Chrome window title was
`Reddit - The heart of the internet - Google Chrome`, confirming #10 really opened on his screen.

## Defects this run exposed

**D1 — a hallucinated tool name is retried until the budget dies.** The model called
`google:open_url`; `executeCapability` 404s it (`Unknown capability`). Nothing recognises "this tool
does not exist, and will not exist next time either", so the loop burned 9 calls and 26 s and then
told the owner it could not confirm anything. Duplicate suppression is keyed on tool+args, so
varying the argument defeats it entirely.

**D2 — the same prompt routes differently on consecutive runs.** #2 used zero tools. Re-run
immediately afterwards, the identical sentence used `web_research`. Same server, same session.

**D3 — "the headline on bbc.com" was answered without reading bbc.com.** The grounded sources
returned were `wikipedia.org` and `indiatimes.com`. The answer may be true; it is not what was
asked, and the reply does not say where it came from.

**D4 — there is no way to list the owner's open tabs.** #5 fell back to a screenshot and answered
"6". At that moment he had 3 real browser tabs. `browser_tabs` lists the invisible browser's tabs,
not his.

**D5 — reading a named page prefers search over reading it.** #3 was a request for the opening line
of a specific article; `web_research` (a grounded search) won over `url_read` (fetch that page).

**D6 — replies leak fragments.** #8 began with `00s`. An earlier run emitted a raw
`{"text": "...", type: text }` envelope as prose.

## The play-a-video chain, from an earlier run the same day

Request: "open youtube and tell me what videos are on there right now, then play one of them".
70 s, 4 tools: `activate_site` -> `screen_capture` -> `stage_render` -> `screen_act click`.
Reply claimed the video "has been selected and clicked". Independent check: Chrome's window title
was still `(101) YouTube - Google Chrome`, not the video's title. **Nothing played.**

Recorded internals of that click:

    foregroundWindow: { name: "", controlType: "ControlType.Pane" }   <- not Chrome
    matchedControl:   source: "visual_grounding", x: 2395, y: 980, confidence: 0.99
    alternatives:     []                                              <- UIA matched nothing
    performed:        { action: "click", x: 2395, y: 980 }
    verified:         true                                            <- while nothing happened

Causes, all confirmed from source or from that record:

1. `inspectScreen({ limit: 100 })` caps the control list at 100; a YouTube page has thousands, so
   the title was never in the list and it fell through to vision grounding.
2. The foreground window was Jarvis's own Electron pane, not Chrome. `screen_act` records
   `foregroundWindow` and never reads it.
3. `stage_render` drew a panel over the browser between the screenshot and the click.
4. `result.verified` is true whenever an after-capture exists. It never asks whether anything
   changed — a check that cannot fail.
5. Before and after captures are both taken and never compared.
6. The click is a blind screen-coordinate mouse event with no idea which window receives it.
7. The coordinates were seconds stale by the time they were used.
8. Vision's 0.99 confidence was about a pixel in a past image, not about the live screen.
9. Nothing re-focuses Chrome before clicking.
10. The surface honesty check cannot catch this: the act really did happen on his screen, it just
    was not the act described.
11. The reply named the overlay as a problem and reported success in the same sentence.

## Measured comparison with what the fast systems do

| | this system | published practice |
|---|---|---|
| reading a page | screenshot + vision | structural snapshot; 200-400 tokens vs 3000-5000 (Playwright MCP) |
| per screenshot | ~0.8 s inference each | avoided entirely |
| same task, end to end | screenshot-driven | DOM-first 68 s vs screenshot-first 330 s, 4.9x (browser-use) |
| clicking | screen x,y | element handle; the browser aims |
| tools offered | 159 | Claude in Chrome ships 21; Anthropic documents degradation past 30-50 |
| tool retrieval | none | 49% -> 74% (Anthropic MCP eval); 13.6% -> 43.1% (RAG-MCP, arXiv 2505.03275) |
| proof of an action | `ok: true` | post-state returned: final URL, title, fresh snapshot |
| claim verification | model judge | signed receipts, 94.2% detection at <15 ms (arXiv 2603.10060) |
| opening a URL | PowerShell shell-out, 400-600 ms startup | in-process ShellExecuteW, or one CDP message |

Sources: platform.claude.com tool-search docs; anthropic.com/engineering/advanced-tool-use;
arXiv 2505.03275; browser-use.com/posts/speed-matters; playwright.dev/mcp/snapshots;
developer.chrome.com/blog/remote-debugging-port; arXiv 2603.10060.

## Test hygiene

conversation.json backed up before the run and the test turns removed afterwards, so none of these
prompts remain in the owner's history.
