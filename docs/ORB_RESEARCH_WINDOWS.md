# ORB — the Windows implementation path

Research half A, 2026-08-23. Companion to `ORB_RESEARCH_PRODUCTS.md` (product teardowns and the
stack question). This half answers: **given a stack, how is this actually built on Windows 11, and
what will refuse to work.**

Wave 1 scope only: a floating always-on-top orb that watches the screen and opens a small panel.
No voice, no brain, no tools, no typing into other apps.

---

## 1. The window

### 1.1 Never stealing focus — the thing that ruins it silently

The flag is **`WS_EX_NOACTIVATE`**. Without it, clicking the orb pulls focus out of whatever the
owner was doing: his editor loses the caret, a game may minimise, a full-screen video drops out.
This is the failure that passes every test and ruins real use, because in testing you click the orb
*on purpose*.

Electron does not expose it. Reaching it means a native call against the window handle after
creation (`SetWindowLongPtr` with `GWL_EXSTYLE`). In Rust/Tauri the same call is one line of
`windows-rs` and needs no addon.

Related: the window must also stay out of the taskbar and Alt-Tab (`WS_EX_TOOLWINDOW`), or it
becomes something the owner tabs into by accident all day.

### 1.2 Click-through with a live hole

The mechanism is `WS_EX_LAYERED | WS_EX_TRANSPARENT`, which makes the window invisible to hit
testing. The hard part is keeping ONE region clickable while the rest passes through, and still
knowing when the cursor is over the orb so it can react.

- **Electron**: `setIgnoreMouseEvents(true, { forward: true })`. The `forward` flag installs a
  low-level mouse hook so the window still receives `WM_MOUSEMOVE` while clicks pass through
  (electron/electron#10183). **Known defect**: forwarding stops while certain non-Electron windows
  hold focus — Task Manager and Device Manager are the cited cases (electron/electron#33281).
  Click-through survives; hover detection dies. For an orb that reacts on hover, that is visible.
- **Tauri**: `set_ignore_cursor_events` exists but has **no forward option** (tauri-apps/tauri#6164,
  still open) and is reported not working on Windows in #11461. CSS `pointer-events: none` does not
  forward to other applications — a common wrong answer in those threads.
- **Conclusion**: in Electron this is a library feature with a known hole; in Rust it is roughly 40
  lines of Win32 you own outright (toggle the extended style live, or install `WH_MOUSE_LL`
  yourself). The framework gap disappears when you have native access, and it is the same technique
  underneath either way.

### 1.3 Always-on-top, and the one case that is impossible

- Over normal windows and **borderless-fullscreen**: works.
- Over **exclusive-fullscreen** games: **impossible, and no library fixes it.** Such an app takes the
  desktop compositor out of the loop; "topmost" is a hint to a manager that is no longer running the
  display. The only answer is asking the game to run borderless.
- **Electron's `setAlwaysOnTop(true, 'screen-saver')` level is macOS-only.** On Windows it is plain
  topmost whatever level string is passed. Several threads assume otherwise; they are wrong.
- Sitting above the taskbar is a separate fight (electron/electron#38020).

### 1.4 Every virtual desktop

Windows has no supported public API for "show this window on all desktops"; the shell does it through
`IVirtualDesktopManager`, whose interface changes between Windows builds. Practical options: leave it
per-desktop (acceptable for Wave 1), or re-show the orb when a desktop switch is detected. **Decide
this explicitly rather than discovering it.**

### 1.5 DPI — the one that makes it look cheap

**Electron declares itself system-DPI-aware only** (electron/electron#8533). Drag a window between
monitors with different scaling and Windows bitmap-stretches it: a blurry orb, permanently. The fix is
a `PerMonitorV2` manifest and handling `WM_DPICHANGED`. Rust/Tauri is per-monitor aware by default.
On a laptop plus an external monitor — the owner's setup — this is visible every day, not a corner
case.

---

## 2. The eyes

### 2.1 JavaScript cannot reach UI Automation cheaply. Rust can.

UI Automation is COM. From Node every option is bad:

- **FFI (koffi / node-ffi)**: COM vtable calls by hand. Possible, unpleasant, fragile.
- **A C++ N-API addon**: works, but the project now carries a native toolchain and a rebuild on every
  Electron bump.
- **Shelling to PowerShell or C#**: **400–600 ms of process startup per call**, measured on this
  machine during the browsing work and made worse by the owner's OneDrive-redirected profile. Fatal
  for something that must keep up as he switches windows.

Against that, Rust has **`uiautomation-rs`** (crates.io, Apache-2.0, ~557 commits) wrapping
IUIAutomation directly: control patterns — so TextPattern and ValuePattern — and **event handlers
including focus-changed and property-changed**. That is exactly the surface Wave 1 needs, in-process,
no addon, no shell.

**This is the strongest single argument for a Rust orb, and it is about the EYES, not the window.**

### 2.2 Watch by event, never by polling

`SetWinEventHook` with `EVENT_SYSTEM_FOREGROUND`, registered **out-of-context** with process and
thread IDs both zero, receives foreground changes for every process **without injecting a DLL**.
UIA's own event system is built on WinEvents internally. Microsoft's stated reason for preferring
events is precisely our case: continually polling UI elements is what burns the CPU.

Design rule for Wave 1: **subscribe narrowly** — foreground change, focus change, selection change.
Nothing structural, nothing tree-wide. A broad subscription across all processes is how apps like
this end up sitting at 8% CPU all day.

### 2.3 What can and cannot be read

| Signal | How | Reliability |
|---|---|---|
| foreground window + title | `GetForegroundWindow` + `WM_GETTEXT`, or UIA `get_name()` | solid everywhere |
| process / app identity | `GetWindowThreadProcessId` | solid |
| focused control | UIA `FocusedElement`, or `GetFocus` after `AttachThreadInput` | good on native, patchy elsewhere |
| **browser URL** | find the address-bar Edit element, read `ValuePattern` | **fragile — see 2.4** |
| **selected text** | UIA `TextPattern.GetSelection()` | **varies by app — see 2.5** |

### 2.4 The browser URL problem

**Chrome's accessibility layer is off by default** and switches on when something asks for it
(Chromium accessibility overview). Reading the URL means locating the address bar as an Edit control
and reading its value — and Microsoft's own Q&A records that *different Chrome versions have
different underlying logic*, so it breaks on Chrome updates. `--force-renderer-accessibility` exists
but its bare form broke in Chrome 117 (crbug 40072866) and now needs `=complete`.

There is also a cost worth stating: turning Chrome's accessibility tree on has a real performance
price inside Chrome, which is exactly why it ships off.

**Honest position: the URL is best-effort, not guaranteed, and it will break on some Chrome update.**

### 2.5 The selected-text problem

`TextPattern.GetSelection()` is the correct path and, importantly, **does not touch the clipboard**.
But support is uneven: built-in **RichEdit** controls are documented as not exposing it reliably, and
**PDF viewers differ from program to program**. With nothing selected it returns a degenerate range at
the caret, and may return null when there is no caret — both need handling or the orb reports
nonsense.

The universal fallback is synthesising Ctrl+C and reading the clipboard, then restoring it. It works
almost everywhere and it is **invasive and racy**: it destroys the owner's clipboard for a moment,
needs a delay to settle, and can silently capture the wrong thing. Position: **UIA first, clipboard
fallback only on an explicit request** ("summarise this"), never on the ambient watch loop.

### 2.6 What will give us nothing

Known-dark surfaces, to be confirmed empirically in Wave 1 rather than assumed: elevated /
administrator windows (a non-elevated process cannot read them at all — a real limit, not a bug),
DRM-protected video, exclusive-fullscreen games, many Electron apps (thin accessibility trees),
custom-drawn canvases (some editors, Figma-style apps), and remote-desktop sessions.

**Wave 1 must produce a measured list of which of the owner's actual apps are readable.** Everything
later — "summarise this", "reply to that" — rests on it, and a promise the eyes cannot keep is worse
than a smaller promise.

---

## 3. The architecture that falls out of the above

The eyes and the orb need not be the same process, and separating them de-risks the stack choice:

- **Eyes** — a small native process owning UIA and the WinEvent hooks, emitting a compact state object
  (app, title, url, selection, focused control) over a local socket whenever it changes.
- **Orb** — whatever renders best, subscribing to that stream.

If both end up in Rust they are one process and the socket disappears. If the orb is Electron for the
visual work, the eyes still want to be native — so the split is the safe default until the product
research lands.

**It also satisfies the owner's constraint directly**: nothing here touches the Jarvis server, so
nothing that works today can break.

---

## 4. The stack, from this half's evidence only

| | Electron | Tauri / Rust |
|---|---|---|
| click-through + hover | built in, with a known focus-dependent defect | build it in Win32 yourself, no inherited defect |
| `WS_EX_NOACTIVATE` | needs a native call | one line |
| per-monitor DPI | system-aware only; blurry across mixed-DPI monitors | correct by default |
| UI Automation | no good binding: addon, FFI, or a 400–600 ms shell-out | `uiautomation-rs`, in-process, with events |
| idle footprint | heavy (a Chromium per app) | small |
| familiarity here | Jarvis is already Electron | a new toolchain |

On this half's evidence the answer leans **Rust**, and the deciding factor is the eyes rather than the
window: everything else is a day of Win32 either way, but the accessibility layer is a wall in
JavaScript and a library call in Rust.

**The strongest argument against**: Jarvis is Electron, the visual language already exists there, and a
Rust orb means the look cannot be lifted from the existing app. If the orb is mostly a beautiful
surface and only lightly a screen-reader, that argument wins. The product research should settle it.

---

## 5. Sources

electron/electron#10183 (mouse forwarding), #33281 (forwarding defect), #10078 and #38020
(always-on-top limits), #8533 (system DPI only) · tauri-apps/tauri#6164, #11461, #13070, #2090
(click-through gaps) · Microsoft Learn: SetWinEventHook, UI Automation events for clients,
TextPattern.GetSelection, AutomationElement.FocusedElement, ShellExecuteW · Chromium accessibility
overview and crbug 40072866 · crates.io / github: uiautomation-rs · Microsoft Q&A on reading Chrome
and Edge URLs via AutomationElement, and on reading selected text from another application.

## 6. Not verified

- No measured CPU figure for a narrow WinEvent subscription over a full day; needs measuring on this
  machine during Wave 1.
- Whether `uiautomation-rs` exposes everything needed for TextPattern selection specifically — the
  crate documents control patterns generally; the selection path needs a spike.
- Whether the owner's Chrome currently exposes its URL at all, and which of his daily apps are dark.
  Both are one small experiment, and both change what Wave 1 can honestly promise.
