# ORB — How the Real Products Are Built

Research dossier for a Windows 11 always-on-top "orb": a small floating surface that lives above every
window 24/7, reads screen context (foreground app, window title, browser URL, selected text, focused
field), opens a panel on click, and later grows a wake word, voice, and the ability to type into other apps.

**Method.** Primary sources only: official docs, source files in public repos, job boards' raw APIs,
issue threads, changelogs. Every claim below is tagged:

- **[CONFIRMED]** — a named URL says it, or the source code shows it.
- **[INFERRED]** — reasoned from indirect evidence; the reasoning is stated so you can disagree.
- **[UNVERIFIED]** — I could not establish it; collected again at the end of the document.

Written 2026-08-23. Status: **COMPLETE.** ~30 primary sources; full source list at the end.

---

# PART 1 — PRODUCT TEARDOWNS

## 1.1 Wispr Flow — the closest analogue

Wispr Flow is a floating dictation bar that sits on top of every app, listens on a hotkey, and drops
cleaned-up text into whatever field you were in. Structurally it is our orb minus the panel.

### What it's built in

The strongest evidence is their own job board, read through Ashby's raw posting API rather than the
JS-rendered page:

- **[CONFIRMED]** The *Software Engineer, Product* role asks you to "Build high-quality, tasteful product
  experiences across our **native macOS and Windows apps**" and requires "Strong experience building
  **native applications on macOS, Windows, or a combination**."
  Source: `https://api.ashbyhq.com/posting-api/job-board/wispr-flow`
- **[CONFIRMED]** Same posting: "**Wispr lives on top of every app a user has open and responsiveness is
  core to the experience**", and names the surfaces: "the **floating Flow Bar** on desktop, the **Flow
  Bubble** on Android, the voice keyboard on iOS." Same URL.
- **[CONFIRMED]** The *Design Engineer* role lists a **web** stack: "React, TypeScript, SCSS modules,
  Storybook, Motion, Lottie, Lucide, Figma." Same URL.
- **[CONFIRMED]** The Software Engineer posting has as a bonus: "experience building **accessibility
  features, system-level integrations**, or consumer products." Same URL.

Read those four together and the shape is clear:

- **[INFERRED]** Wispr Flow is a **hybrid**: a native (or native-hosted) shell that owns the window,
  hotkeys, audio capture and text injection, with the *visible* UI authored in React/TypeScript. A pure
  Swift/WinUI shop would not staff a Design Engineer on React + SCSS modules + Storybook + Lottie. A pure
  Electron shop would not demand "strong experience building native applications on macOS, Windows."
- **[INFERRED]** "Lottie" in the stack is a strong hint that the Flow Bar's breathing/listening animation
  is a **Lottie JSON animation**, not a shader or a native animation. Cheap to author, cheap to retheme,
  and it explains how the same idle animation appears on desktop and Android.

Second-hand claims that Flow's Windows client "is Electron" circulate widely, always in competitor blog
posts and always with the same "~800 MB RAM, 8% CPU idle" number attached. I could not trace that number
to a primary source, a screenshot of Task Manager, or a first-party statement.
**[UNVERIFIED] — treat the 800 MB / 8% figure as marketing from rivals until measured yourself.**

What *is* first-party evidence of a Chromium/Node substrate:

- **[CONFIRMED]** Wispr's own MDM/enterprise deployment guidance describes a **built-in auto-updater
  that is Electron `autoUpdater` / Squirrel-based**, offers an **MSI** for managed deployment instead of
  `Setup.exe`, and tells admins to allowlist **`dl.wisprflow.com`** (updates) and **`api.wisprflow.ai`**
  (auth). Source: `https://docs.wisprflow.ai/articles/1444083812-mdm-enterprise-deployment-guide`
  (the article ID 404s to a direct fetch now; the content is quoted through search indexing of that
  same URL, so treat the Electron-autoUpdater detail as **[CONFIRMED, weakly]** — one hop of indirection).
- **[INFERRED]** Squirrel + MSI + a `dl.` CDN is the standard `electron-builder` / `electron-forge`
  shipping pattern. Combined with the React stack this makes **Electron (or at minimum a Chromium
  webview) very likely for the Windows client**, with native code alongside it via N-API addons for the
  parts Electron cannot do.

### How its floating UI avoids stealing focus

- **[INFERRED]** Wispr never asks you to click the Flow Bar to dictate — the interaction is a **hotkey**,
  and the bar is feedback, not a control. That is the single most important design decision in the whole
  product: **if the overlay is not the input device, it never needs focus.**
- **[CONFIRMED]** Their docs say "**Click inside a text field before dictating — Flow needs an active
  text field to receive text.**"
  Source: `https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation`
  This is proof by contradiction: the product's correctness depends on the *other* app keeping focus
  the entire time the Flow Bar is visible and animating. The overlay therefore must be non-activating.
- **[INFERRED]** On Windows that means the Flow Bar window carries `WS_EX_NOACTIVATE` and
  `WS_EX_TOOLWINDOW` (details in Part 3A). There is no other supported way to show and animate a window
  without the foreground app losing its caret.

### How it inserts text into arbitrary apps

This is the best-documented part of the whole product, and it is humbler than you'd expect.

- **[CONFIRMED] It is a clipboard paste, not synthetic typing.** "Flow **temporarily uses your clipboard
  to paste text and restores your previous contents after a successful paste**." And on failure: "Flow
  leaves your dictated text on the clipboard so you can paste it with Cmd+V / Ctrl+V."
  Source: `https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation`
- **[CONFIRMED] The paste is a synthesized keystroke, and the keystroke is app-dependent.** In the
  integrated terminals of Cursor, VS Code and Windsurf on Windows, "**Flow uses Shift+Insert to paste
  when Ctrl+V isn't reliable**", and "Some terminals expect a different shortcut (such as Ctrl+Shift+V),
  so the paste may not land the first time."
  Source: `https://docs.wisprflow.ai/articles/6434410694-use-flow-with-cursor-vs-code-and-other-ides`
- **[CONFIRMED] Windows needs no accessibility permission; macOS does.** On Windows, Flow requires only
  the Microphone permission — Accessibility permission is a macOS-only requirement (System Settings →
  Privacy & Security → Accessibility). Sources: the two docs URLs above.
- **[CONFIRMED] Where it breaks:** remote desktops (Citrix Workspace, Microsoft RDP, VMware Horizon and
  other VDI), because "Flow runs on your local computer and pastes using your **local** clipboard";
  banking/corporate apps and password managers that block clipboard access or third-party keyboards;
  and the Chrome address bar on Android. Sources: the two docs URLs above plus
  `https://docs.wisprflow.ai/articles/7336156466-use-flow-with-remote-desktops-citrix-rdp-vdi`
- **[CONFIRMED] There is a designed fallback for "no text field."** "If you dictate in a supported IDE
  without a text field focused, Flow shows your clean dictated text in **a popup** and copies it to the
  clipboard." There is also an explicit "Quick Dictation to Clipboard" mode.
  Source: `https://docs.wisprflow.ai/articles/6434410694-use-flow-with-cursor-vs-code-and-other-ides`

**The lesson for us, stated plainly:** the market-leading product in exactly our category does *not*
do clever per-app text injection. It copies to the clipboard, presses a paste shortcut it guesses per
app, restores the clipboard, and when that fails it degrades to "your text is on the clipboard, paste
it yourself." Everything else is polish around that core.

### Footprint and known complaints

- **[CONFIRMED-ish]** Wikipedia's article on Wispr Flow lists as criticisms: requires an internet
  connection, "**exhibits startup delays**" and **high system resource usage**, keystroke-reading
  capability raising security concerns, and punctuation/grammar problems in certain apps.
  Source: `https://en.wikipedia.org/wiki/Wispr_Flow` (encyclopedic, not first-party).
- **[UNVERIFIED]** Specific idle RAM/CPU numbers; reports of it freezing VS Code / Notepad++ during
  dictation; the claim that it re-adds itself to system startup on every launch. These appear only in
  competitor-authored review blogs, which have an obvious interest.
- **[CONFIRMED]** The keystroke-reading concern is not paranoia in kind, only in degree: a product that
  must know *what app you are in* and *press paste shortcuts for you* necessarily holds a global input
  hook and a global window watcher. Any orb we build inherits exactly this trust problem.

---

## 1.2 Raycast for Windows — the best-documented architecture in this space

Raycast published an unusually honest engineering post about the 2.0 rewrite. This is the single most
useful source in the whole dossier, because they solved *our exact problem* and wrote down why.

Source for everything in this section:
`https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast`

- **[CONFIRMED] The stack is polyglot:** "TypeScript, Swift, C#, Rust, Node, and React."
- **[CONFIRMED] The Windows host app is C# with .NET 8 and WPF**, in Visual Studio. The macOS host app
  is Swift on AppKit, in Xcode.
- **[CONFIRMED] They embed the *system* WebView, not Chromium.** Windows uses **WebView2**; macOS uses
  **WKWebView**. The frontend is "one React + TypeScript project that ships to both platforms," with
  separate entry points per window.
- **[CONFIRMED] Business logic lives in one long-lived Node process** — database access and the
  extension runtime. Performance-critical work (the data layer, file indexing, cloud sync) is **Rust**.
- **[CONFIRMED] Why they rejected Electron — and they name our features specifically:** Raycast needs
  "global hotkeys, clipboard management, **accessibility APIs**, window management, **custom panels that
  float above other apps without stealing focus**." They wanted full control of the stack.
- **[CONFIRMED] IPC is schema-first:** "Interfaces are declared in one place and typed clients are
  generated for every side" — across Swift/C#, Node, WebView and Rust.
- **[CONFIRMED] WebView2 on Windows was the hard part:** each window needs "its own WebView2 environment
  configured with the right combination of **acrylic effects, custom chrome, and input handling**", and
  acrylic blur-behind with custom title bars needed care.
- **[CONFIRMED] Real memory numbers, from the vendor, for a v2 window:**

  | Component | Memory |
  |---|---|
  | WebView | ~120–200 MB |
  | Node.js process | ~150–200 MB |
  | Native host app | ~40 MB |
  | WebKit GPU process | ~18 MB |
  | **Total, v2** | **350–450 MB** |
  | (v1, fully native Swift) | 200–300 MB |

  Read that table twice. **A well-engineered, system-WebView, no-Electron, no-Chromium-bundle app still
  lands at 350–450 MB, and the single biggest line item is Node, not the WebView.** The "avoid Electron
  to save memory" argument is much weaker than the internet says; what you actually save is *bundle
  size* and *control*, not RAM — unless you also drop Node.

### The reverse-engineering companion

`https://github.com/yetone/native-feel-skill` — an agent skill distilled from the Raycast deep-dive plus
reverse-engineering of the shipping `Raycast Beta.app`. Useful because it names failure modes:

- **[CONFIRMED]** Its "WebKit/WebView2 survival guide" targets: **startup flicker** from WebView2
  initialization (needs a prewarm strategy), **occlusion handling** (toggling occlusion detection to
  stop rendering glitches), **font prewarming** to avoid first-paint text layout delay, and
  **suppressing the native WebView context menu** because it instantly breaks the native illusion.
- **[CONFIRMED]** Its tenets that matter to us: *"Rendering surface as seam"* — share UI above the
  WebView, diverge with native shells below it; *"Identity through muscle memory"* — the hotkey, the
  ranking and the interaction verbs **are** the app, and the UI is an implementation detail;
  *"Perception-driven performance"* — optimise what the user feels (launch, responsiveness), not the
  raw metric; and a claimed **~150× iteration-speed advantage** for web (200 ms hot reload vs ~30 s
  native rebuild).

**[INFERRED]** The last one is the honest reason most of these products are web-on-native rather than
pure native: not memory, not startup — **iteration speed on the UI**, which for an orb whose entire
value is how it feels is the dominant cost.

## 1.3 PowerToys Run — the cautionary tale about focus

PowerToys Run is the opposite design decision from our orb: it is a launcher, so it *wants* focus. The
value of studying it is the bug list, which is a catalogue of everything that goes wrong when a floating
window and the Windows foreground-activation rules disagree.

- **[CONFIRMED]** PowerToys Run is WPF; a recent change "Ported the UI from WPF-UI to .NET 9 WPF."
  Source: `https://github.com/microsoft/PowerToys` and the issue threads below.
- **[CONFIRMED]** Long-running focus defects, still open/recurring across many releases:
  - `https://github.com/microsoft/PowerToys/issues/16497` — focus loss, reported as far back as 0.55.2.
  - `https://github.com/microsoft/PowerToys/issues/20043` — triggering Run while the Start menu / OS
    search is open leaves focus on the Start menu; you must close and reopen.
  - `https://github.com/microsoft/PowerToys/issues/32188` — Run doesn't get keyboard focus when opened
    over certain apps (PowerToys Settings, GPU-Z, MSI Afterburner).
  - `https://github.com/microsoft/PowerToys/issues/14315` — doesn't get focus on first run.
  - `https://github.com/microsoft/PowerToys/issues/40122` — window focus lost.
- **[CONFIRMED]** There is even a feature request asking PowerToys for the *inverse*: a global
  "prevent applications stealing activation/focus" toggle, so apps can appear in the foreground
  visually without capturing keyboard input. `https://github.com/microsoft/PowerToys/issues/29073`
  (closed as duplicate — the ask recurs).

**[INFERRED] The lesson.** Microsoft's own team, writing native WPF, with full Win32 access, has been
fighting `SetForegroundWindow` foreground-lock rules for six years. Windows deliberately refuses to let
a background process steal focus (`SetForegroundWindow` silently fails unless your process satisfies the
foreground-lock conditions — you own the foreground, you're responding to the last input event, there's
no active foreground lock, etc.). **Every product in this category that tries to *take* focus fights the
OS forever; every product that never needs focus has no bug list at all.** Design the orb into the
second category and an entire class of defects never exists.

## 1.4 Flow Launcher

- **[CONFIRMED]** .NET (7 at time of writing), WPF, UI library `iNKORE.UI.WPF.Modern`, plugin-based
  architecture, targets Windows 7+.
  Sources: `https://github.com/Flow-Launcher/Flow.Launcher/blob/dev/README.md`,
  `https://deepwiki.com/Flow-Launcher/Flow.Launcher`
- **[UNVERIFIED]** Idle RAM/CPU figures for Flow Launcher — I found no first-party measurement.
- **[INFERRED]** The consistent pattern across *all three* Windows command surfaces (PowerToys Run,
  Flow Launcher, Raycast Windows) is **C#/.NET + WPF as the window host**. That is not a coincidence:
  WPF is the cheapest way on Windows to get a borderless, transparent, per-pixel-alpha, always-on-top
  window while still having `HwndSource` for raw `WndProc` access and full P/Invoke to Win32.

## 1.5 Overwolf — how overlays render over games at all

This matters to us for one question only: *what happens when the user is in a game?*

- **[CONFIRMED] There is no supported windowing answer.** "DirectX does not have a supported way for one
  application to draw on top of another."
  Source: `https://fredemmott.com/blog/2022/05/31/in-game-overlays.html`
- **[CONFIRMED] The real technique is code injection + function hooking.** For D3D11 the target is
  `IDXGISwapChain::Present()`, which "is called for every frame, can modify the frame, and has access to
  the Direct3D device." You inject a DLL, then rewrite the function at runtime with **Microsoft Detours**
  or **MinHook**. "It roughly applies to D3D12, OpenGL, and Vulkan as well." Same URL.
- **[CONFIRMED] It is indistinguishable from cheating, by construction.** "Everything here is modifying
  the game to do stuff it wasn't meant to do; the problems and solutions are shared with cheats."
  Signing your DLLs "*may* help"; the only real fix is to work with the anti-cheat vendors directly.
  Same URL.
- **[CONFIRMED] Overwolf's apps are HTML/JS/CSS injected through CEF** (Chromium Embedded Framework) and
  talk to games via the Game Events Provider (GEP); `IOverwolfOverlayApi` creates overlay windows,
  registers games for injection, and raises `game-launched` / `game-injected` events. They ship
  **ow-electron**, "built on top of the Electron.js framework," so an Electron app can have a real
  in-game overlay. Sources: `https://dev.overwolf.com/ow-electron/getting-started/changelog/ow-changelog/`,
  `https://dev.overwolf.com/ow-electron/getting-started/overview/`

**Conclusion for the orb: [CONFIRMED-by-implication]** — a normal topmost window **cannot** appear over
an exclusive-fullscreen D3D game, and the only way to do it is to become, technically, a cheat. Overwolf
exists as a company *because* this problem is that hard and requires per-anti-cheat business
relationships. **Do not promise the orb over games.** Detect fullscreen/game and hide (which is also the
correct behaviour — see Part 4).

---

## 1.6 Rewind / Limitless — the only real teardown of an always-watching app

Kevin Chen's teardown is a genuine binary-level teardown, and it is the most valuable single document
about what "watch the screen all day" actually costs.
Source: `https://kevinchen.co/blog/rewind-ai-app-teardown/`

- **[CONFIRMED] Rewind is native Cocoa, not Electron.** Linked frameworks include `whisper.cpp`
  (transcription), **VisionKit / `ImageAnalyzer`** (OCR — "the same pipeline that powers Live Text"),
  **ScreenCaptureKit** (capture), a statically-linked FFmpeg in the helper, and Sentry for telemetry.
- **[CONFIRMED] It uses the accessibility APIs to find the frontmost window**, then captures with
  ScreenCaptureKit, which can filter by window and recomposite the desktop. It auto-excludes private
  browser windows and user-blocklisted apps.
- **[CONFIRMED] Storage design:** in `~/Library/Application Support/com.memoryvault.MemoryVault` —
  H.264 video chunks ~5 minutes long at **0.5 fps**; a PNG screenshot every **2 seconds**; and a
  **SQLite** database of frames, OCR results, segments and transcripts, with a `node` table mapping text
  to positions in the frame, searched via **SQLite FTS**.
- **[CONFIRMED] The real cost, measured:**

  | Metric | Value |
  |---|---|
  | Screen recordings on disk | **180 MB/hour** |
  | Metadata + OCR + transcripts | **26 MB/hour** |
  | Console logs (!) | 4 MB/hour |
  | Main process CPU | **~20% continuously** |
  | Helper during encode | **spikes over 200% CPU** |
  | Battery life reduction | **20–40%** |

- **[CONFIRMED] The damning detail:** `ffprobe` showed `encoder: Lavc59.42.103 libx264` — **software
  encoding on an M-series Mac that has hardware VideoToolbox encoders**. A large fraction of that
  battery cost was avoidable and was simply a wrong default.
- **[CONFIRMED-ish]** Meta acquired Limitless (formerly Rewind) in December 2025; the Rewind Mac app was
  shut down and screen/audio capture disabled about two weeks later. (Widely reported; I did not reach a
  first-party announcement page.)

### The Windows equivalent numbers

- **[CONFIRMED]** `screenpipe` (open source, Rust + Tauri + React/TypeScript + SQLite + Whisper + OCR)
  is the closest apples-to-apples Windows/cross-platform build, and its own docs claim roughly
  **5–10% CPU on modern hardware, ~4 GB RAM, ~15 GB storage per month.**
  Sources: `https://github.com/screenpipe/screenpipe`, `https://deepwiki.com/screenpipe/screenpipe`
- **[CONFIRMED]** `Windrecorder` is the pure-Windows OSS take on the same idea (OCR-indexed screen
  history). `https://github.com/yuka-friends/Windrecorder`

**[INFERRED] What this means for our orb.** Continuous *video* capture is a 20%-CPU, 200-MB/hour,
kill-your-battery feature, and even the best-funded team shipped it with an embarrassing encoder
default. **Our orb should not record the screen.** Reading the *accessibility tree* of the foreground
window on demand is three orders of magnitude cheaper than framegrabbing, and it is what Rewind itself
used to decide *what* to capture. Frames are a fallback, not the design.

## 1.7 Cluely and the "invisible overlay" family

This family (Cluely, and the OSS clones: `woflydev/cluely`, `Blueturboguy07/cue`, OpenCluely) is worth
studying purely for the window mechanics, which are documented in their source.

- **[CONFIRMED] It is Electron.** The overlay is a `BrowserWindow` with `transparent: true`
  ("the background is fully transparent, showing only explicitly rendered content"), `alwaysOnTop: true`
  ("forces the overlay window to persistently float above all other applications"), plus
  `frame: false`, `skipTaskbar: true`, `resizable: false`.
  Source: `https://github.com/woflydev/cluely/blob/main/doc.md`
- **[CONFIRMED] The hiding trick is one Win32 call.** On Windows,
  **`SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`** removes the window from every DWM capture
  surface — "The window is displayed only on a monitor. Everywhere else, the window does not appear at
  all. One use for this affinity is for windows that show video recording controls, so that the controls
  are not included in the capture." Value `0x00000011`, **introduced in Windows 10 version 2004**; on
  older builds it silently degrades to `WDA_MONITOR` (black box instead of true exclusion). macOS
  equivalent is `NSWindowSharingNone`. In Electron this is exposed as `win.setContentProtection(true)`.
  Source: `https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity`
- **[CONFIRMED] Microsoft explicitly disclaims it as a security feature:** "unlike a security feature or
  an implementation of Digital Rights Management (DRM), there is no guarantee that using
  `SetWindowDisplayAffinity` … will strictly protect windowed content, for example where someone takes a
  photograph of the screen." It also "works only when the Desktop Window Manager (DWM) is composing the
  desktop." Same URL.
- **[CONFIRMED] What they read:** clipboard changes, screenshots of specific regions via native modules
  (`node-ffi`, `robotjs`), and OCR via Tesseract.js — then off to an AI backend over WebSocket/HTTP.
  Source: `https://github.com/woflydev/cluely/blob/main/doc.md`
- **[CONFIRMED] What their own docs admit:** these processes create "significant CPU and GPU usage," and
  "macOS and Windows can detect and restrict invisible overlays in secure or fullscreen contexts."
  Same URL.

**The criticism, stated plainly:** this entire category exists to deceive a third party (interviewer,
proctor, meeting host). Its reputation is why "always-on-top AI overlay that watches your screen" now
reads as *cheating tool* to a large part of the market. **[INFERRED] Our orb inherits that suspicion by
default and has to actively design against it** — see Part 4.

Note the useful inversion, though: `WDA_EXCLUDEFROMCAPTURE` is genuinely *good* behaviour for an orb
that isn't cheating. Excluding your own floating widget from the user's screen shares and recordings is
courteous — Zoom's own toolbar does it — and it prevents the orb from polluting every screenshot the
user takes.

## 1.8 Electron apps running 24/7 as overlays — what authors report

- **[CONFIRMED]** Overwolf publishes **`ow-electron`**, an Electron fork specifically so Electron apps
  can be real in-game overlays, because stock Electron cannot.
  `https://dev.overwolf.com/ow-electron/getting-started/overview/`
- **[CONFIRMED]** Raycast's team explicitly rejected Electron for a floating-panel product and named
  the reasons: global hotkeys, clipboard management, accessibility APIs, window management, and "custom
  panels that float above other apps without stealing focus."
  `https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast`
- **[CONFIRMED]** Raycast's *replacement* still costs 350–450 MB, of which ~150–200 MB is Node. So
  "not Electron" did not buy them memory.
- **[UNVERIFIED]** Hard idle-CPU numbers for a transparent, always-on-top Electron window doing nothing.
  I did not find a rigorous published measurement. The mechanism that matters is known though:
  a `transparent: true` frameless window is composited by DWM every frame it changes, so **any
  continuously-running CSS animation on a transparent overlay is a permanent GPU/compositor cost**, and
  Chromium's own occlusion detection cannot throttle a window that is never occluded because it is
  topmost. **[INFERRED] This is the single most important performance rule for our orb: the idle orb
  must be a static bitmap, not an animation.**

---

# PART 2 — THE STACK QUESTION

## 2.1 What each candidate actually is

| | Electron | Tauri v2 | C#/.NET + WPF | C#/WinUI 3 (Windows App SDK) | C++/Win32 | Rust + `windows-rs` |
|---|---|---|---|---|---|---|
| Renderer | bundled Chromium | system WebView2 | DirectX/`milcore` retained-mode | system WebView2 or Composition | you | you |
| Who ships this | Cluely & clones, ow-electron, (likely) Wispr Flow | screenpipe | **PowerToys Run, Flow Launcher, Raycast Windows** | rare in this category | overlay/injector tooling | screenpipe core |

## 2.2 Numbers, with an honesty warning

**[UNVERIFIED — READ THIS FIRST]** The widely-circulated Tauri-vs-Electron benchmark numbers below come
from comparison blogs, not from a controlled experiment I ran or a first-party benchmark. They are
directionally right and quantitatively unreliable. The one number in this whole document I trust is
Raycast's, because it is the vendor reporting on their own shipping app.

| Metric | Electron | Tauri v2 | WPF/.NET | Raycast v2 (WebView2+Node+C#) — **vendor-reported [CONFIRMED]** |
|---|---|---|---|---|
| Idle RAM | ~120–300 MB (blogs) | ~30–50 MB (blogs) | ~40–80 MB (unmeasured) | **350–450 MB total** |
| Bundle | 80–200 MB (blogs) | 2–10 MB (blogs) | 1–5 MB + runtime | — |
| Cold start | ~1.4 s (blogs) | ~0.38 s (blogs) | ~0.3–0.8 s (unmeasured) | — |

Sources for the blog column: `https://www.pkgpulse.com/guides/electron-vs-tauri-2026`,
`https://rustify.rs/articles/rust-tauri-vs-electron-2026` — **[UNVERIFIED]**, treat as folklore.
Source for the Raycast column: `https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast`
— **[CONFIRMED]**.

**The important correction to the folklore:** Raycast's breakdown shows the **Node process (~150–200 MB)
costs more than the WebView (~120–200 MB)**. So "Tauri saves memory" is really "*not shipping a
JavaScript runtime* saves memory." If your Tauri app also runs Node for your agent logic, you get the
Electron number back. Choose based on **whether you need a long-lived JS runtime**, not on the
framework logo.

## 2.3 Honest trade-offs on the axes that matter for an orb

### Reaching Win32 extended window styles (`WS_EX_NOACTIVATE`, `WS_EX_TOOLWINDOW`, `WS_EX_TRANSPARENT`, layering, display affinity)

- **WPF / C#** — best in class. You get the `HWND` from `HwndSource`/`WindowInteropHelper`, and every
  Win32 call is one `[DllImport]` away. `AllowsTransparency=true` + `WindowStyle=None` gives per-pixel
  alpha with no interop at all. **This is why all three Windows command surfaces are WPF.** [INFERRED,
  from the convergent evidence in 1.2–1.4]
- **Electron** — good for the common cases, opaque for the rest. `focusable: false`, `transparent`,
  `frame: false`, `skipTaskbar`, `alwaysOnTop` with a level, `setIgnoreMouseEvents(ignore, {forward})`,
  and `setContentProtection()` are first-class.
  [CONFIRMED: `https://www.electronjs.org/docs/latest/api/browser-window`]. Anything **not** on that
  list means a native addon (`node-ffi`, `koffi`, or a N-API module) plus `win.getNativeWindowHandle()`,
  and you are now maintaining C++ inside an Electron app anyway.
- **Tauri v2** — exposes `alwaysOnTop`, `alwaysOnBottom`, `decorations`, `transparent`, `focus`,
  `skipTaskbar`, `shadow`, `visibleOnAllWorkspaces`, **`contentProtected`** in `WindowConfig`
  [CONFIRMED: `https://v2.tauri.app/reference/config/`], plus `set_ignore_cursor_events`. Beyond that
  you drop to `raw_window_handle` + the `windows` crate — which, being Rust, is actually pleasant.
- **WinUI 3** — the worst of the candidates for this specific job, and there is direct evidence:
  - `OverlappedPresenter.IsAlwaysOnTop` exists [CONFIRMED:
    `https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.windowing.overlappedpresenter.isalwaysontop`],
    **but** "Click through not working with `IsAlwaysOnTop = true`"
    [CONFIRMED: `https://github.com/castorix/WinUI3_SwapChainPanel_Layered/issues/5`].
  - There is no built-in per-pixel input pass-through: "WinUI 3 lacks built-in functionality to
    selectively pass input through transparent pixels. Using `WS_EX_TRANSPARENT` makes the entire
    window transparent to input, even the non-transparent pieces." The community answer is 30-year-old
    `CreateRectRgn` / `CombineRgn` / `SetWindowRgn`, with a participant noting "using an API which is
    >30 years old is not great; there should be a better method."
    [CONFIRMED: `https://github.com/microsoft/microsoft-ui-xaml/discussions/10746`]
  - Getting a transparent WinUI 3 window at all requires `DwmExtendFrameIntoClientArea` +
    `DwmEnableBlurBehindWindow` + `SetWindowSubclass` + a `SwapChainPanel` sample, per Microsoft's own
    support answer. [CONFIRMED:
    `https://learn.microsoft.com/en-us/answers/questions/1418063/(winui3)-semi-transparent-window-click-through-win`]

  **Verdict: WinUI 3 is a bad fit for a transparent always-on-top click-through orb.** Microsoft's own
  Q&A tells you to write Win32 interop to escape it.

### Reaching UI Automation

- **C#** — `System.Windows.Automation` (managed, older, slower) and the COM `IUIAutomation` interop
  (`Interop.UIAutomationClient`) are both native to the language. Zero friction.
- **Rust** — the `uiautomation` crate and `windows-rs` cover it; ergonomic, but you write the tree
  walking yourself.
- **Electron/Node** — **there is no good story.** You need a native addon. This is the strongest single
  argument against a pure-Electron orb: our headline feature (read the accessibility tree) is precisely
  the thing Electron cannot do without leaving Electron. Raycast said this in as many words when they
  listed "accessibility APIs" among their reasons to skip Electron. [CONFIRMED, Raycast blog]
- **C++** — native, obviously; also the most code per feature.

### Auto-update

- **Electron** — `autoUpdater` + Squirrel/NSIS, mature; this is what Wispr ships. [CONFIRMED-weakly, MDM doc]
- **Tauri** — built-in updater plugin, signed manifests.
- **WPF/native C#** — you build it, or bolt on Squirrel/Velopack/ClickOnce/MSIX.

### Code signing / SmartScreen — identical for everyone

Framework choice does not affect this at all; see Part 3G.

---

# PART 3 — DIRECT ANSWERS

## A) What exactly prevents focus theft on Windows

**The flag is `WS_EX_NOACTIVATE` (0x08000000).** Microsoft's definition, verbatim:

> "A top-level window created with this style **does not become the foreground window when the user
> clicks it**. The system does not bring this window to the foreground when the user minimizes or
> closes the foreground window. The window should not be activated through programmatic access or via
> keyboard navigation by accessible technology, such as Narrator. To activate the window, use the
> `SetActiveWindow` or `SetForegroundWindow` function. **The window does not appear on the taskbar by
> default.** To force the window to appear on the taskbar, use the `WS_EX_APPWINDOW` style."

[CONFIRMED: `https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles`]

The complete orb window recipe, from the same page:

| Style | Value | What it buys you |
|---|---|---|
| `WS_EX_NOACTIVATE` | 0x08000000 | clicking the orb does not move foreground/focus; keeps the caret in the other app |
| `WS_EX_TOOLWINDOW` | 0x00000080 | "does not appear in the taskbar or in the dialog that appears when the user presses ALT+TAB" |
| `WS_EX_TOPMOST` | 0x00000008 | "placed above all non-topmost windows and should stay above them, **even when the window is deactivated**"; set/cleared via `SetWindowPos` |
| `WS_EX_LAYERED` | 0x00080000 | per-pixel alpha (`UpdateLayeredWindow` / `SetLayeredWindowAttributes`) — how you get a soft-edged glowing orb |
| `WS_EX_TRANSPARENT` | 0x00000020 | hit-test pass-through (whole window — see C) |
| `WS_EX_NOREDIRECTIONBITMAP` | 0x00200000 | "for windows that do not have visible content or that use mechanisms other than surfaces" — used with swapchain-composited transparent windows |

**One more thing, non-obvious:** even with the right styles, `SetForegroundWindow` from a background
process is *supposed* to fail. The PowerToys Run bug list in §1.3 is six years of a Microsoft team
losing that fight (`#14315`, `#16497`, `#20043`, `#32188`, `#40122`). **[INFERRED but strongly
evidenced: any orb design that needs to grab focus will inherit that entire bug class.]**

**Which frameworks expose it cleanly:**

| Framework | `NOACTIVATE`-equivalent | Verdict |
|---|---|---|
| Electron | `focusable: false` (docs: "determines whether the window is focusable"; also `setFocusable()`) + `skipTaskbar` + `alwaysOnTop(flag, level)` | **clean** [CONFIRMED, Electron docs] |
| Tauri v2 | `focus: false` in `WindowConfig`, `alwaysOnTop`, `skipTaskbar` | **clean** [CONFIRMED, Tauri config ref] |
| WPF | `ShowActivated="False"` + one `SetWindowLong(GWL_EXSTYLE, ...)` on the `HwndSource` | **clean, and full Win32 underneath** |
| WinUI 3 | no first-class equivalent; interop | **fights you** [CONFIRMED via the two threads above] |
| Win32/Rust | it *is* the API | trivially clean |

**One Electron trap worth knowing:** `setAlwaysOnTop(flag, level)` — levels `floating` through `status`
put the window **below the taskbar** on Windows; `pop-up-menu` and above put it **above** the taskbar.
[CONFIRMED, Electron docs]. If your orb needs to float over the taskbar, `floating` is the wrong level.

## B) Always-on-top over borderless vs exclusive fullscreen

- **Borderless (fullscreen-windowed) apps: works.** They are ordinary DWM-composited windows; a
  `WS_EX_TOPMOST` window sits above them. This covers essentially all modern productivity software,
  browsers in F11, Teams/Zoom, and most modern games' default mode. **[INFERRED from the DWM
  composition model — no single URL states it as a rule, but every overlay product relies on it.]**
- **Exclusive fullscreen D3D: does not work, at all, by any supported means.**
  > "DirectX does not have a supported way for one application to draw on top of another."
  [CONFIRMED: `https://fredemmott.com/blog/2022/05/31/in-game-overlays.html`]
  The only technique is DLL injection + hooking `IDXGISwapChain::Present()` with Detours or MinHook,
  which is architecturally identical to a cheat: "Everything here is modifying the game to do stuff it
  wasn't meant to do; the problems and solutions are shared with cheats." Same URL.
- **This is Overwolf's entire moat**: CEF-injected HTML overlays, `IOverwolfOverlayApi` for overlay
  window creation and game registration, `game-launched`/`game-injected` events, and a separate
  Electron fork (`ow-electron`) so Electron apps can do it.
  [CONFIRMED: `https://dev.overwolf.com/ow-electron/getting-started/overview/`]
- **Also blocked:** the secure desktop (UAC prompt, Ctrl+Alt+Del, lock screen) runs on a different
  desktop object; nothing you draw appears there. **[INFERRED, standard Windows behaviour.]**

**Honest promise for our orb: "floats above every normal window, hides during exclusive-fullscreen
games and UAC prompts."**

## C) Click-through with a clickable hole

Three techniques, in increasing order of correctness:

1. **Whole-window pass-through** — `WS_EX_TRANSPARENT` (+ `WS_EX_LAYERED`). Simple, and **wrong for an
   orb**, because it is all-or-nothing: "Using `WS_EX_TRANSPARENT` makes the entire window transparent
   to input, even the non-transparent pieces."
   [CONFIRMED: `https://github.com/microsoft/microsoft-ui-xaml/discussions/10746`]
2. **Region clipping** — `CreateRectRgn` / `CreateEllipticRgn` / `CombineRgn` / `SetWindowRgn` to make
   the window literally not exist outside the orb's circle. This is what the WinUI 3 community landed
   on, complete with the complaint about using a 30-year-old API. [CONFIRMED, same URL] Gotcha: regions
   are in **physical pixels**, so you must re-apply on DPI change and per-monitor moves; the WinUIEx
   maintainer wrapped it specifically to fix "device-independent units / high-resolution screen issues."
   [CONFIRMED, same URL]
3. **Dynamic hit-testing** — keep `WS_EX_LAYERED` for alpha, keep the window hit-testable, and answer
   `WM_NCHITTEST` with `HTTRANSPARENT` for points outside the orb. Cheapest and DPI-proof, but requires
   a `WndProc`.

**Per framework:**

- **Electron:** `win.setIgnoreMouseEvents(ignore, { forward })` — "Makes the window ignore all mouse
  events"; `forward: true` (macOS, Windows) "forwards mouse move messages to Chromium, enabling mouse
  related events such as `mouseleave`. **Only used when `ignore` is true.**"
  [CONFIRMED: `https://www.electronjs.org/docs/latest/api/browser-window`]
  **The idiomatic hole-punch is:** set `setIgnoreMouseEvents(true, {forward:true})`, listen to
  `mousemove` in the renderer, and toggle to `setIgnoreMouseEvents(false)` when the pointer enters the
  orb's bounds, back to `true` when it leaves. **Gotcha [INFERRED]:** this is a per-frame IPC round trip
  during mouse movement over your window, and it has a one-frame race at the boundary — fast diagonal
  entries can drop the first click.
- **Tauri v2:** `set_ignore_cursor_events(bool)`, same shape, same race.
- **WPF:** you own the `HWND`, so option 3 is available and is the right answer.
- **WinUI 3:** `IsAlwaysOnTop = true` **breaks** click-through
  [CONFIRMED: `https://github.com/castorix/WinUI3_SwapChainPanel_Layered/issues/5`], and you additionally
  need `IsHitTestVisible=false` on the XAML elements
  [CONFIRMED: the MS Q&A thread]. Two independent footguns for the two features we need simultaneously.

## D) How these products know foreground app / window title / URL / selected text / focused control

There is no single API. Every product stacks four or five mechanisms and degrades between them.

| Signal | Mechanism | Confidence |
|---|---|---|
| Foreground window changed | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, …, WINEVENT_OUTOFCONTEXT \| WINEVENT_SKIPOWNPROCESS)`. Out-of-context means "the callback function is not mapped into the address space of the process that generates the event… the system must queue events. Although this method is asynchronous, events are guaranteed to be in sequential order." **The client thread must have a message loop.** | [CONFIRMED: `https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook`] |
| Focus moved to a new control | `EVENT_OBJECT_FOCUS` on the same hook, or `IUIAutomation::GetFocusedElement()` / a focus-changed event handler | [CONFIRMED, same URL for the hook] |
| Window title | `GetWindowText` on the foreground `HWND`; or UIA `Name` property | standard |
| Owning app | `GetWindowThreadProcessId` → `QueryFullProcessImageName` | standard |
| Focused field's contents / type | **UI Automation**: `ValuePattern`, `TextPattern`, or `LegacyIAccessiblePattern` | [CONFIRMED, see below] |
| Selected text | UIA `TextPattern.GetSelection()`; fallback = synthesize Ctrl+C and read the clipboard | [INFERRED for the fallback; it is what every OSS clone does] |
| Browser URL | UIA on the address-bar edit control — see the reliability numbers below | [CONFIRMED] |
| Everything else | Screen capture + OCR | [CONFIRMED for Rewind (VisionKit) and Cluely (Tesseract.js)] |

**Browser URL specifically — this is worse than people assume.** A Microsoft Q&A thread on exactly this:

- The naive approach (find a `ControlType.Edit` descendant of the Chrome window and read `ValuePattern`)
  "gives result sometimes but not always. This take while for some urls."
- The moderator's improved recipe: enumerate windows with `EnumDesktopWindows` matching class
  **`Chrome_WidgetWin_1`**, walk automation elements, and identify the address bar by
  **control type `50004` (`UIA_EditControlTypeId`) *and* access key `"Ctrl+L"`**, then read it through
  **`UIA_LegacyIAccessiblePatternId` (10018)** rather than `ValuePattern`.
- **The reporter's measured result with the improved recipe: works 70–75% of the time.**

[CONFIRMED: `https://learn.microsoft.com/en-us/answers/questions/494433/automationelement-to-detect-chrome-url-is-not-cons`]

**[INFERRED] Design consequence:** a 70–75%-reliable URL read is not a feature you can build a promise
on. If browser URL matters, the honest answer is a **browser extension** (native messaging back to the
orb) for Chrome/Edge/Firefox, with UIA as the degraded fallback when no extension is installed. That is
also almost certainly why every serious "AI browser copilot" ships an extension.

**Performance note:** UIA is cross-process COM; every uncached property read is an RPC into the target
app, and a naive `FindAll(TreeScope.Descendants)` on a Chrome window can walk thousands of nodes. Use
`CacheRequest`/`BuildUpdatedCache` to batch, scope to `TreeScope.Children` where possible, and **never**
walk the tree on a timer. **[INFERRED — Microsoft's client guide portal
(`https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-clientportal`) covers caching but I
could not retrieve a page stating a specific cost figure, so treat the magnitude as unquantified.]**

## E) Apps known to expose nothing useful to accessibility

This is the section that determines what the orb can honestly promise.

| App / class | What you get | Why | Evidence |
|---|---|---|---|
| **Chrome / Edge / any Chromium, by default** | a window, a title, and a nearly-empty tree | "Accessibility features in Chrome are off by default and **enabled automatically on-demand**"; Chromium waits until it detects assistive technology before building the tree. Modes: `--force-renderer-accessibility[=basic\|form-controls\|complete]`, default `complete`. | [CONFIRMED: `https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/overview.md`] |
| **Chrome address bar (URL)** | ~70–75% success even with the best-known recipe | tree shape changes between Chrome versions; `ValuePattern` unreliable, `LegacyIAccessible` better | [CONFIRMED: MS Q&A 494433] |
| **Electron apps (VS Code, Slack, Discord, Teams, Notion, Figma desktop, Postman…)** | same problem as Chrome, inherited | "Electron applications enable accessibility automatically when assistive technology is detected"; otherwise the Chrome accessibility tree is not exposed. `app.setAccessibilitySupportEnabled()` exists but "the user's system assistive utilities have priority over this setting and will override it." | [CONFIRMED: `https://www.electronjs.org/docs/latest/tutorial/accessibility`] |
| **Any elevated / admin-run app** (installers, Task Manager, regedit-as-admin, admin PowerShell, many game launchers/anti-cheat services) | **an empty tree, with no error** | UIPI: "When the caller is Medium and the target window belongs to a High-integrity process, the OS returns **an empty element tree — no error, just silence**." Input: "SendInput mouse events from Medium → High are **discarded by the window manager** before they reach the target." Symptom: clicks report success and do nothing. | [CONFIRMED: `https://github.com/NousResearch/hermes-agent/issues/49067`] |
| **Games (D3D/OpenGL/Vulkan surfaces)** | a window handle and nothing inside it | there is no UI tree; the content is pixels in a swapchain | [CONFIRMED-by-implication: `https://fredemmott.com/blog/2022/05/31/in-game-overlays.html`] |
| **DRM / capture-protected windows** (Netflix in Edge, some banking and enterprise apps, apps using `WDA_EXCLUDEFROMCAPTURE`) | visible to you as a rectangle; **invisible to any screen capture you take** | `SetWindowDisplayAffinity` removes the window from every DWM capture surface | [CONFIRMED: `https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity`] |
| **RDP / Citrix / VMware Horizon sessions** | the remote app's tree is on the *remote* machine | Wispr's own docs: "Flow runs on your local computer and pastes using your **local** clipboard" — the same boundary blocks reading | [CONFIRMED: `https://docs.wisprflow.ai/articles/7336156466-use-flow-with-remote-desktops-citrix-rdp-vdi`] |
| **The secure desktop** (UAC prompt, lock screen, Ctrl+Alt+Del) | nothing; different desktop object | by design | [INFERRED, standard Windows] |
| **Banking apps, password managers, some corporate apps** | actively block clipboard and third-party input | Wispr documents this failure class explicitly | [CONFIRMED: `https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation`] |
| **Java Swing/AWT without Java Access Bridge; old Delphi/VB6; custom-drawn Qt** | little or nothing | no UIA provider implemented | [UNVERIFIED — widely known, no URL gathered] |

**The single most consequential item on that list:** the browser and every Electron app — which together
are where the user spends most of their day — are dark by default. **[INFERRED]** There is a real
mitigation: launching Chromium with `--force-renderer-accessibility` turns the tree on. But you cannot
relaunch the user's browser for them, and doing it silently would be exactly the kind of behaviour that
gets an app labelled spyware. Practical options, honestly ranked: (1) ship a browser extension;
(2) ask the user once, explain, and offer to add the flag to their shortcut; (3) degrade to
window-title-only context.

## F) Typing into another app: SendInput vs clipboard-paste vs UIA `ValuePattern`

| Technique | How it fails |
|---|---|
| **Clipboard + synthesized paste keystroke** | needs the *right* paste shortcut per app; destroys clipboard if restore fails; loses to apps that block clipboard; loses to RDP/VDI |
| **`SendInput` character-by-character** | slow; races with the app's own input handling; IME/dead-key/layout hell for non-US keyboards; **mouse events silently dropped into elevated windows** |
| **UIA `ValuePattern.SetValue`** | replaces the *entire* field rather than inserting at the caret; many controls don't implement it; read-only/rich-text controls refuse; browsers rarely support it on web content |

**What the real product does — and this is the whole answer:**

> "Flow **temporarily uses your clipboard to paste text and restores your previous contents after a
> successful paste**." If it fails, "Flow leaves your dictated text on the clipboard so you can paste it
> with Cmd+V / Ctrl+V."
> [CONFIRMED: `https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation`]

with a **per-app keystroke table**:

> "In the integrated terminals of Cursor, VS Code, and Windsurf on Windows, Flow uses **Shift+Insert**
> to paste when Ctrl+V isn't reliable." … "Some terminals expect a different shortcut (such as
> Ctrl+Shift+V), so the paste may not land the first time."
> [CONFIRMED: `https://docs.wisprflow.ai/articles/6434410694-use-flow-with-cursor-vs-code-and-other-ides`]

and an **explicit degraded mode**: no focused text field → show the text in a popup and leave it on the
clipboard. [CONFIRMED, same URL]

**The elevated-window rule, precisely:** keyboard `SendInput` (`KEYEVENTF_KEYDOWN`/`KEYEVENTF_KEYUP`)
**partially bypasses the UIPI filter and can reach elevated windows**; mouse events cannot.
[CONFIRMED: `https://github.com/NousResearch/hermes-agent/issues/49067`] So a clipboard + Ctrl+V paste
has a *better* chance into an admin window than a synthetic click does — a genuinely non-obvious fact.

**The escape hatch nobody should take lightly:** `uiAccess="true"` in the manifest lets you bypass UIPI
entirely — "A process with UIAccess rights can drive any application window by using the `SendInput`
function." But Windows enforces two hard conditions: **a PKI signature check on any interactive
application requesting UIAccess**, and the binary **must live in a secure location — `\Program Files\`,
`\Program Files (x86)\`, or `\Windows\System32\`**.
[CONFIRMED: `https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/jj852244(v=ws.11)`]
That rules out per-user installs (and therefore rules out the default `electron-builder`/Squirrel
install location). Screen readers do this; consumer apps essentially never do.

## G) Shipping: signing, SmartScreen, auto-update, autostart, elevation

Microsoft's current guidance, quoted:

- **EV certificates no longer help with SmartScreen.**
  > "EV certificates no longer bypass SmartScreen. Years ago, signing files with an Extended Validation
  > (EV) code signing certificate would result in positive SmartScreen reputation by default, but this
  > behavior no longer exists. … **Paying a premium for EV solely to avoid SmartScreen warnings is no
  > longer justified.**"
- **Reputation is per file-hash *and* per publisher certificate.** "Even when signed, a newly created
  binary could still show a SmartScreen warning until its hash or publisher certificate accumulates
  sufficient evidence of positive reputation."
- **How long:** "There is no exact threshold, but it can take **several weeks and hundreds of clean
  installs from a wide audience**."
- **No manual submission for consumers:** "There is no need (or mechanism) to manually submit a file for
  SmartScreen reputation review for consumer endpoints."
- **Artifact Signing (formerly Trusted Signing)** is Microsoft's recommended non-Store option: **starts
  at $9.99/month**, Azure-managed HSM, no hardware token, CI/CD-native, identity validation required.
- **Smart App Control (Windows 11)** "may supersede SmartScreen Application Reputation… will block
  execution of unsigned files unless the file has a positive reputation," and applies to **all**
  executables, not just downloaded ones.
- **The Store bypasses all of it:** "Apps published through the Microsoft Store are re-signed by
  Microsoft and carry full reputation. Users will never see a SmartScreen warning."

[All of the above CONFIRMED:
`https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation`]

Two field notes worth having:

- **[CONFIRMED]** A third-party report (ToDesktop, who sign a lot of Electron apps) corroborates:
  "EV code signing certificates no longer grant instant SmartScreen reputation," dating the change to
  Microsoft's 2024 Trusted Root Program update; and documents that around **26 March 2026 Microsoft
  silently migrated many Trusted Signing customers to new intermediate CAs**, which reset reputation and
  produced SmartScreen warnings for previously-trusted publishers. Their advice: an OV cert is now as
  good as EV; **avoid certificate rotation near a release**; ship to a small audience first to build
  reputation. `https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore`
  Corroborating Microsoft Q&A threads: `https://learn.microsoft.com/en-ca/answers/questions/5855442/azure-trusted-signing-new-intermediate-cas-causing`,
  `https://learn.microsoft.com/en-us/answers/questions/5900208/smartscreen-reputation-reset-following-ev-certific`
- **Auto-update:** Electron `autoUpdater` + Squirrel/NSIS is the default and is what Wispr appears to
  ship, alongside an **MSI** specifically for managed/MDM deployment [CONFIRMED-weakly, Wispr MDM doc].

**Elevation — the direct answer to "does any of it need admin on Windows 11":**

| Thing | Needs elevation? |
|---|---|
| Always-on-top / no-activate / layered / click-through window | **No** |
| Reading UIA from normal (medium-IL) apps | **No** |
| Reading UIA from **elevated** apps | **Yes** (or `uiAccess`, which needs signing + Program Files) [CONFIRMED, hermes issue + MS UIAccess doc] |
| `SetWinEventHook` out-of-context, global | **No** |
| `SendInput` into normal apps | **No** |
| `SendInput` mouse into elevated apps | **Yes/never** — silently dropped [CONFIRMED] |
| `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on **your own** window | **No** (Win10 2004+) [CONFIRMED] |
| Per-user install to `%LocalAppData%` + autostart via `HKCU\...\Run` or a per-user Task Scheduler task | **No** |
| Machine-wide install to `Program Files` / `HKLM` / `uiAccess` | **Yes** |
| Wake word / microphone | **No** — a Windows 11 mic privacy consent, not elevation |

**[INFERRED but high-confidence]** The whole orb, minus reading-from-elevated-apps, ships as a
non-elevated per-user app.

---

# PART 4 — THE INTERESTING PART

The non-obvious things the best of these do. Each one is either a trick I can point at a source for, or
clearly labelled as my own extrapolation.

## 4.1 The window is already alive before you see it

Raycast's opening trick, verbatim: "we **order the window to front but keep it visually hidden
(`alphaValue = 0`)**, and **disable WebKit's occlusion detection (`windowOcclusionDetectionEnabled =
false`)**." [CONFIRMED, Raycast blog]

Both halves matter. Ordering it to front means the compositor already has it. Disabling occlusion
detection stops the WebView from throttling/discarding its rendering while invisible. **The panel is
never "opened" — it is un-hidden.**

**[INFERRED] Windows equivalents:** keep the panel as a `WS_EX_LAYERED` window with alpha 0 (via
`SetLayeredWindowAttributes`) rather than `SW_HIDE`; and in WebView2 the analogous knob is keeping the
controller visible with `IsVisible = true` on a zero-alpha window rather than toggling controller
visibility, plus `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` on the
Chromium command line. I did not find a Windows-specific source confirming the WebView2 flags are
sufficient — **[UNVERIFIED]**, but the mechanism is the same one Raycast describes.

## 4.2 Never show a frame you haven't finished drawing

- Raycast uses `_doAfterNextPresentationUpdate`, "a WebKit API for synchronizing rendered state with
  native presentation, **to make sure the WebView has finished drawing before the window becomes
  visible**." [CONFIRMED]
- And they force "rendering in a `requestAnimationFrame` to avoid flickering" immediately before the
  show. [CONFIRMED]

That is the difference between an overlay that feels like an OS surface and one that feels like a web
page. The visible symptom you are avoiding is a one-frame flash of stale or empty content — which is
exactly what makes cheap overlays feel cheap.

## 4.3 Render bigger than the window, so growth is free

"Keeping the **WKWebView frame always at the expanded size, even when the window itself is compact**.
The WebView renders beyond the window's visible bounds." [CONFIRMED, Raycast blog]

So when Raycast expands from compact to full, there is no layout pass, no reflow, no blank region — the
content was already drawn, the window just got bigger. **For an orb that grows into a panel, this is the
single most valuable trick in the document.** Lay out the full panel at all times; the orb state is a
window that is smaller than its content.

## 4.4 Prewarm the specific slow thing, not "everything"

Raycast's emoji picker was slow because "WebKit was falling back through the font chain for every emoji
glyph"; the fix was to **prewarm the emoji font on startup**. [CONFIRMED]

The generalisable lesson: for a surface that must open instantly, the startup cost you can afford is
*any* cost, because it happens once at login. Front-load font loading, the WebView environment, the UIA
COM apartment, the first `IUIAutomation` instantiation, and the audio device enumeration — all of them
have a first-call penalty you do not want on the user's first click.

## 4.5 Make the overlay not be the input device

This is Wispr's actual design and it is a structural insight, not a detail. The Flow Bar is *feedback*;
the **hotkey** is the interface. Because the user never has to click the floating thing, the floating
thing never needs focus, so the entire focus-theft bug class (see the PowerToys list) does not exist.

`native-feel-skill` states the same principle as a tenet: **"Identity through muscle memory — the
hotkey, command ranking, and interaction verbs define the app; UI is implementation detail."**
[CONFIRMED, `https://github.com/yetone/native-feel-skill`]

**[INFERRED] For our orb:** every capability must be reachable without touching the orb. The orb is
the *status*, the hotkey is the *verb*. Clicking it should be the slow path, not the only path.

## 4.6 The visual material rule, from Microsoft, that almost nobody follows

Microsoft's own backdrop guidance draws a hard line, and it maps exactly onto orb-vs-panel:

> "**Mica** is an opaque material that incorporates the user's theme and desktop wallpaper… **Mica is
> designed for performance as it only captures the background wallpaper once to create its
> visualization**, so we recommend it for the foundation layer of your app."
>
> "**Acrylic** is a semi-transparent material that replicates the effect of frosted glass. **It's used
> only for transient, light-dismiss surfaces** such as flyouts and context menus."

[CONFIRMED: `https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops`]

**Read as a performance rule for a 24/7 overlay:** *real-time* blur (Acrylic) samples what is behind the
window continuously; Mica samples the wallpaper **once**. An always-on-top orb sitting over other apps
all day with live Acrylic is asking DWM to blur a moving backdrop forever. **Idle orb: static/Mica-like
(sampled once). Panel while open: Acrylic (transient, light-dismiss).** That is both the Microsoft
design rule and the battery rule, and they happen to agree.

Also worth knowing: the platform gates these itself — `MicaController.IsSupported()` /
`DesktopAcrylicController.IsSupported()` exist precisely so the effect degrades on unsupported hardware,
and the materials fall back to solid colours when transparency is off or battery saver is on.
[CONFIRMED, same URL for `IsSupported`; **[UNVERIFIED]** for the exact battery-saver fallback list.]

## 4.7 Use accessibility to decide *what* to capture, not as a fallback for capture

Rewind's design, per the teardown: it "uses Apple's accessibility APIs to identify the frontmost
window, then captures via ScreenCaptureKit, which allows filtering by window and can recomposite the
desktop." [CONFIRMED: `https://kevinchen.co/blog/rewind-ai-app-teardown/`]

The accessibility tree is the *index*; pixels are the *payload*. Most people build it the other way
around (capture everything, OCR everything, search the OCR) and pay 20% CPU and 180 MB/hour for it.

**[INFERRED] For the orb:** the entire "what is on screen" feature should be a `SetWinEventHook`
subscription — `EVENT_SYSTEM_FOREGROUND` and `EVENT_OBJECT_FOCUS`, out-of-context, with
`WINEVENT_SKIPOWNPROCESS` so the orb never reacts to itself — plus one **cached** UIA read per event.
That is a few microseconds of work per window switch, versus a continuous capture pipeline. Screenshot +
OCR becomes an explicit, user-initiated fallback for the known-dark apps in Part 3E.

## 4.8 Privacy features that are also performance features

- Rewind "automatically excludes private browser windows and user-defined apps." [CONFIRMED, teardown]
- `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on **our own** orb window keeps it out of every
  screen share, recording and screenshot the user takes. Zoom's own toolbar does this. [CONFIRMED, MS
  docs] The cheating-tool crowd uses it to hide from the interviewer; used honestly it just means **your
  floating widget never ruins a screenshot**, which is a real, small, delightful thing.
- **[INFERRED, and the important one]** Every app in this category has a trust problem it created by
  being opaque about what it reads. Wikipedia's Wispr entry lists "keystroke-reading capability raising
  security concerns" as a criticism. The differentiating move is a **visible, live "what I can see right
  now" readout** — app name, window title, whether the field is readable, and a per-app kill switch —
  rendered *inside the orb's panel*, not buried in settings. An orb that continuously shows you the
  small amount it knows is far more trustworthy than one that shows nothing and knows the same amount.

## 4.9 Degrade out loud

Wispr's docs are full of designed-degradation, and it is why the product survives contact with reality:
no focused text field → **show the text in a popup and leave it on the clipboard**; paste failed →
**leave the dictated text on the clipboard and say so**; a terminal that wants a different shortcut →
**a documented per-app override**. [CONFIRMED, the two docs URLs in §1.1]

**[INFERRED]** The orb equivalent: when the foreground app is one of the known-dark ones (Part 3E), the
orb should *say* "I can see the window title but not its contents" rather than silently returning less.
Users forgive a limitation they were told about; they do not forgive an assistant that quietly guesses.

## 4.10 Six ideas that would make our orb more than a floating microphone button

All **[INFERRED]** — my extrapolations from the above, flagged as such.

1. **Context-reactive resting state.** The orb's idle appearance encodes what it currently understands —
   a different accent when a readable text field is focused, a dimmed state in a dark app, a distinct
   state when it has something unsolicited to say. Zero interaction required to get value; it becomes a
   *status light for its own competence*.
2. **The panel grows out of the orb, it doesn't replace it.** Same window, same layered surface, one
   size animation, content already laid out at full size (§4.3). Never a second window appearing.
3. **Proximity peek.** `WM_MOUSEMOVE` over a `setIgnoreMouseEvents(true, {forward:true})` window is
   already being forwarded to you — so hovering *near* the orb can reveal a one-line summary of the
   current context without a click and without focus. Cheap, and it is exactly the affordance a
   status-light needs to be readable.
4. **Snap-and-dodge.** The orb should own a docked edge position, and *move out of the way* when the
   foreground window's caret or an active dialog is under it. You already know the focused element's
   bounding rectangle from UIA — use it to avoid ever covering what the user is typing into.
5. **Silence in the right places.** Auto-hide during exclusive fullscreen (which you cannot draw over
   anyway — Part 3B), during screen-share unless invited, on the lock screen, and while a UAC prompt is
   up. An overlay that knows when to disappear earns the right to be there the rest of the time.
6. **A visible "context ledger."** One scrolling line per foreground change: app, title, what was
   readable. It doubles as the trust surface (§4.8), the debugging surface for us, and the thing that
   makes the orb's memory legible instead of spooky.

---

# RECOMMENDATION

## What to build

**Copy Raycast's Windows architecture: a native .NET host that owns the window, plus WebView2 rendering
our existing React UI, plus the agent logic in the long-lived Node process we already run.**

Concretely, three layers:

1. **Shell (C#/.NET, WPF window host).** Owns the `HWND` and every Win32 concern: `WS_EX_NOACTIVATE` +
   `WS_EX_TOOLWINDOW` + `WS_EX_TOPMOST` + `WS_EX_LAYERED`, `WM_NCHITTEST` hole-punching, global hotkey,
   `SetWinEventHook`, `IUIAutomation` with cache requests, clipboard save/restore, `SendInput`,
   `SetWindowDisplayAffinity`, tray, autostart.
2. **Surface (WebView2 + our React/TypeScript).** The orb, the panel, all animation and design.
3. **Brain (existing Node/Jarvis process).** Unchanged, over a schema-typed local IPC — Raycast's
   "interfaces declared in one place, typed clients generated for every side."

## Why

- **Convergent evidence.** The three shipped Windows command surfaces I could examine — Raycast for
  Windows, PowerToys Run, Flow Launcher — are all **C#/.NET + WPF window hosts**. Wispr Flow, the
  closest analogue to our orb, hires for "native applications on macOS, Windows" while staffing a
  design engineer on React/TypeScript. That is four out of four for "native shell, web surface."
- **Raycast rejected Electron for our exact feature list**, in writing: global hotkeys, clipboard
  management, **accessibility APIs**, window management, and "custom panels that float above other apps
  without stealing focus."
- **UI Automation is the orb's core feature and it is a first-class C# API.** In Electron it is a native
  addon you must write and maintain anyway.
- **WPF gives full Win32 without fighting anything**, which is decisively not true of WinUI 3 (where
  `IsAlwaysOnTop` breaks click-through and per-pixel input pass-through does not exist).
- **We keep the React investment.** WebView2 renders the same components; iteration stays at web speed,
  which `native-feel-skill` puts at roughly 150× faster than native rebuild cycles.

## The strongest argument AGAINST it

**We are a JavaScript shop, and this recommendation asks us to run two runtimes, two build systems, two
debuggers and a hand-written IPC contract to buy things Electron mostly already gives us.**

Spelled out, because it is a genuinely good argument:

- Electron already exposes `focusable: false`, `transparent`, `frame: false`, `skipTaskbar`,
  `alwaysOnTop(flag, level)`, `setIgnoreMouseEvents(ignore, {forward})` and `setContentProtection()`
  as first-class, documented APIs. That is Part 3A, 3B and 3C — most of the hard window work — done.
- The one real gap is UI Automation, and that is **a single N-API/koffi module**, not an architecture.
  You will end up writing native code either way; the question is only how much of the app sits on the
  other side of that boundary.
- **The memory argument is weaker than it looks.** Raycast's own numbers: their no-Electron rewrite
  costs **350–450 MB**, *more* than v1's fully-native 200–300 MB, and the largest single component is
  **Node (150–200 MB), not the WebView**. Since we are keeping a Node brain regardless, most of the
  saving evaporates.
- Raycast could do this because they hired dedicated C# engineers for the Windows host. We have not.
  The failure mode is not "the architecture is wrong" — it is that the C# layer becomes the part nobody
  wants to touch, and the orb stops improving.
- **[UNVERIFIED and material]** I have no measured idle CPU/RAM number for a transparent, always-on-top
  Electron window on Windows 11 doing nothing. If that number turns out to be small, the entire case for
  the native shell rests on UIA ergonomics alone — which a well-built addon neutralises.

**The honest resolution:** the architectures differ in *where the seam is*, not in whether there is one.
If we start with Electron + a native context addon and keep the addon's surface small and well-defined
(foreground events, UIA reads, injection, window styles), we can move the shell to .NET later without
touching the React or the brain. **Measure first: build the Electron orb, instrument idle CPU/RAM/GPU
over a real 12-hour day, and let that number — not this document — pick the shell.**

---

# TABLE — APPS AND CLASSES KNOWN TO BE BAD FOR ACCESSIBILITY READING

| # | App / class | What the orb can get | Root cause | Workaround | Evidence |
|---|---|---|---|---|---|
| 1 | Chrome / Edge / Chromium, default state | window + title only | accessibility tree built **on demand**, only when assistive tech is detected | `--force-renderer-accessibility[=basic\|form-controls\|complete]`; or a browser extension | [CONFIRMED] Chromium a11y overview |
| 2 | Chrome address bar (URL) | ~**70–75%** success with the best-known recipe | tree shape changes per Chrome version; `ValuePattern` unreliable | match `UIA_EditControlTypeId` (50004) + access key `Ctrl+L`, read via `UIA_LegacyIAccessiblePatternId` (10018); or extension | [CONFIRMED] MS Q&A 494433 |
| 3 | Electron apps — VS Code, Slack, Discord, Teams, Notion, Figma, Postman | same as #1 | inherits Chromium's on-demand a11y | `app.setAccessibilitySupportEnabled` exists but **user's assistive utilities override it** | [CONFIRMED] Electron accessibility docs |
| 4 | Any elevated / admin app (installers, Task Manager, admin shells, some launchers) | **empty tree, no error** | UIPI: Medium→High is blocked silently | run elevated, or `uiAccess=true` (needs PKI signature **and** install in `Program Files`) | [CONFIRMED] hermes-agent #49067; MS UIAccess policy doc |
| 5 | Games (D3D/OpenGL/Vulkan) | window handle only | content is a swapchain, there is no UI tree | none that isn't a cheat | [CONFIRMED] fredemmott.com |
| 6 | Exclusive-fullscreen games | orb cannot even be *drawn* | "DirectX does not have a supported way for one application to draw on top of another" | inject + hook `Present()` (Overwolf's business); otherwise hide | [CONFIRMED] fredemmott.com |
| 7 | Capture-protected / DRM windows (Netflix in Edge, some banking & enterprise apps) | visible on screen, **absent from any capture** | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` strips them from DWM capture surfaces | UIA may still work; OCR will not | [CONFIRMED] MS `SetWindowDisplayAffinity` |
| 8 | RDP / Citrix / VMware Horizon sessions | pixels of a remote desktop | the real app runs on another machine; clipboard is local | run the orb inside the session | [CONFIRMED] Wispr RDP/VDI doc |
| 9 | Banking apps, password managers, some corporate apps | blocked clipboard and/or third-party input | deliberate anti-automation hardening | none; degrade and say so | [CONFIRMED] Wispr paste doc |
| 10 | Secure desktop — UAC prompt, lock screen, Ctrl+Alt+Del | nothing | separate desktop object | none, by design | [INFERRED] |
| 11 | Java Swing/AWT without Java Access Bridge; VB6/old Delphi; some custom-drawn Qt | little to nothing | no UIA provider implemented | OCR fallback | **[UNVERIFIED]** — widely believed, no source gathered |
| 12 | Windows Store / UWP apps with in-context hooks | in-context hook DLLs are **not** loaded into Store app processes unless installed by a UIAccess process | documented `SetWinEventHook` restriction | use `WINEVENT_OUTOFCONTEXT` (which we should anyway) | [CONFIRMED] MS `SetWinEventHook` remarks |

---

# EVERYTHING I COULD NOT VERIFY

Stated plainly, so nothing in this document gets treated as settled when it isn't.

1. **Whether Wispr Flow's Windows client is literally Electron.** Strong circumstantial evidence
   (React/TS/Storybook/Lottie design stack; Squirrel-based auto-updater + MSI + `dl.` CDN in their MDM
   guidance) versus a job posting demanding "strong experience building **native** applications on
   macOS, Windows." Most likely hybrid. **Not confirmed.**
2. **Wispr Flow's idle CPU and RAM.** The "~800 MB RAM, 8% CPU idle" figure appears only in
   competitor-authored review blogs, never with a screenshot, a methodology, or a first-party number.
   **Do not cite it.** Same for "freezes VS Code / Notepad++ during dictation" and "re-adds itself to
   startup on every launch."
3. **The Wispr MDM/enterprise deployment page itself.** `docs.wisprflow.ai/articles/1444083812-...`
   returned 404 on direct fetch; its content reached me only through search indexing. The
   Electron-`autoUpdater`/Squirrel/MSI detail is therefore one hop of indirection.
4. **All Tauri-vs-Electron benchmark numbers** in Part 2 (idle RAM, bundle size, cold start). Blog-
   sourced, no controlled methodology. Directionally right, quantitatively worthless. The **only**
   trustworthy footprint numbers in this document are Raycast's own (350–450 MB, with the per-component
   split) and Rewind's from the teardown (20% CPU, 180 MB/hour, 20–40% battery).
5. **Idle CPU/GPU cost of a transparent, always-on-top Electron (or WebView2) window on Windows 11 doing
   nothing.** No rigorous published measurement found. This is the single most decision-relevant number
   in the whole dossier and it is missing. **Measure it ourselves before committing to a shell.**
6. **Flow Launcher's and PowerToys Run's idle footprint.** No first-party measurement found.
7. **Whether WebView2's Chromium flags (`--disable-backgrounding-occluded-windows`,
   `--disable-renderer-backgrounding`) fully reproduce Raycast's macOS
   `windowOcclusionDetectionEnabled = false` trick.** The mechanism is analogous; I found no source
   confirming the Windows equivalence.
8. **Exact SmartScreen thresholds.** Microsoft says explicitly there is no published threshold — only
   "several weeks and hundreds of clean installs from a wide audience."
9. **A quantified cost for uncached UI Automation property reads.** Microsoft documents that caching
   exists and why, but I could not retrieve a page with a latency figure. "Cross-process COM RPC is
   expensive" is sound reasoning, not a measured claim.
10. **Which non-browser Windows apps expose nothing to UIA.** Row 11 of the table above is folklore. If
    this matters, the answer is an afternoon with **Accessibility Insights for Windows** / `inspect.exe`
    walking the user's real top-20 apps — which is worth doing before the orb promises anything.
11. **Rewind/Limitless shutdown specifics.** The Meta acquisition and app shutdown are widely reported;
    I did not reach a first-party announcement.
12. **How Wispr's Flow Bar behaves on multi-monitor and mixed-DPI setups**, and whether it repositions
    per-display. No source found; likely only answerable by installing it.
13. **Whether any product in this category ships `uiAccess=true`.** I found the requirements
    (PKI signature + install under `Program Files`) but no evidence that Wispr, Raycast or any consumer
    orb actually does it. My assumption is that none of them do.

---

## SOURCE LIST

Wispr Flow: `https://api.ashbyhq.com/posting-api/job-board/wispr-flow` ·
`https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation` ·
`https://docs.wisprflow.ai/articles/6434410694-use-flow-with-cursor-vs-code-and-other-ides` ·
`https://docs.wisprflow.ai/articles/7336156466-use-flow-with-remote-desktops-citrix-rdp-vdi` ·
`https://docs.wisprflow.ai/articles/1444083812-mdm-enterprise-deployment-guide` ·
`https://en.wikipedia.org/wiki/Wispr_Flow`

Raycast & native-feel: `https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast` ·
`https://github.com/yetone/native-feel-skill`

Windows command surfaces: `https://github.com/microsoft/PowerToys` (issues 14315, 16497, 20043, 29073,
32188, 40122) · `https://github.com/Flow-Launcher/Flow.Launcher/blob/dev/README.md` ·
`https://deepwiki.com/Flow-Launcher/Flow.Launcher`

Overlays over games: `https://fredemmott.com/blog/2022/05/31/in-game-overlays.html` ·
`https://dev.overwolf.com/ow-electron/getting-started/overview/` ·
`https://dev.overwolf.com/ow-electron/getting-started/changelog/ow-changelog/`

Always-watching apps: `https://kevinchen.co/blog/rewind-ai-app-teardown/` ·
`https://github.com/screenpipe/screenpipe` · `https://github.com/yuka-friends/Windrecorder` ·
`https://github.com/woflydev/cluely/blob/main/doc.md`

Win32 / Windows platform: `https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles` ·
`https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity` ·
`https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook` ·
`https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-clientportal` ·
`https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops` ·
`https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/jj852244(v=ws.11)`

Accessibility reality: `https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/overview.md` ·
`https://www.electronjs.org/docs/latest/tutorial/accessibility` ·
`https://learn.microsoft.com/en-us/answers/questions/494433/automationelement-to-detect-chrome-url-is-not-cons` ·
`https://github.com/NousResearch/hermes-agent/issues/49067`

Framework window models: `https://www.electronjs.org/docs/latest/api/browser-window` ·
`https://v2.tauri.app/reference/config/` ·
`https://github.com/microsoft/microsoft-ui-xaml/discussions/10746` ·
`https://github.com/castorix/WinUI3_SwapChainPanel_Layered/issues/5` ·
`https://learn.microsoft.com/en-us/answers/questions/1418063/(winui3)-semi-transparent-window-click-through-win`

Shipping: `https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation` ·
`https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore` ·
`https://learn.microsoft.com/en-ca/answers/questions/5855442/azure-trusted-signing-new-intermediate-cas-causing`

**Status: COMPLETE.**
