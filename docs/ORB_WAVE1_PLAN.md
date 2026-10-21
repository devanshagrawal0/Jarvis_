# ORB — Wave 1 build plan

Written 2026-08-23, combining three pieces of research:
`ORB_RESEARCH_WINDOWS.md` (the Windows implementation path), `ORB_RESEARCH_PRODUCTS.md` (how the real
products are built), and `ORB_GITHUB_SURVEY.md` (502 repositories harvested, 190 READMEs analysed by
script), plus a direct read of the source of the closest existing project.

---

## What Wave 1 is

A small orb that floats on the desktop above everything, all day.

- **You hold a key and talk to it.** It hears you, and it answers out loud.
- **It can see what is on your screen** — which app, which window, the web address, what you have
  selected, which box your cursor is in.
- **It answers about what it sees.** "What is this page" gets an answer about the page you are
  actually looking at.

**What it is NOT, on purpose:** no wake word, no Jarvis brain, no Jarvis tools, no typing into other
apps, no clicking anything, no workflows. It answers and it speaks. Nothing it does can reach the
Jarvis server, so nothing that works today can break — which is the constraint the owner set.

The push-to-talk key is fixed for now; making it configurable is later work and is deliberately not
in this wave.

---

## The decision: what it is built in, and why

**Recommendation: C# / .NET.**

The reasoning is not taste, it is the eyes. Everything else in this wave — a floating circle, a
hotkey, playing audio — is a day's work in any language. Reading the screen is not:

| Route | Reading the screen |
|---|---|
| **Node / Electron** | No usable binding. The options are a C++ add-on (native toolchain, rebuild every Electron bump), FFI COM calls by hand, or shelling to PowerShell at **400-600 ms per call** — measured on this machine, and worse because of the OneDrive-redirected profile. |
| **Rust / Tauri** | `uiautomation-rs` gives it natively and in-process. But Tauri's click-through is the weakest of the three (no mouse forwarding, open issue #6164), and there is almost nothing to borrow. |
| **C# / .NET** | UI Automation is a first-class .NET API. **And the closest existing project to ours is C#, open source, and 6,245 stars.** |

That project is [Sylinko/Everywhere](https://github.com/Sylinko/Everywhere) — "on-screen aware AI
assistant for your desktop, uses current app context, multiple LLMs and MCP tools to act across
apps". C# on Avalonia. It is the same product shape, already working, with its hard problems solved
in public. Raycast for Windows independently landed on the same family (C# + .NET 8 + WPF host +
WebView2) and published that they **rejected Electron** naming our exact requirements: panels that
float above other apps without stealing focus, and accessibility APIs.

**The strongest argument against, stated honestly:** Jarvis is Node and Electron. A C# orb is a
second language in the project, and none of the existing Jarvis visual work can be lifted into it.
If the orb turns out to be mostly a beautiful surface that occasionally glances at the screen, that
argument wins and Electron is the pragmatic answer. My read is the opposite — the eyes are the whole
point — but it is the owner's call and it should be made now, not discovered in Wave 3.

---

## What the research already saved us from

These are not theoretical. Each one is a day or a week that we are not going to lose.

**1. An opaque overlay makes Chrome go blind, and it looks like our bug.**
Chromium watches whether its window is occluded. When something opaque covers it, it hibernates the
renderer and **detaches the accessibility provider** — moving `Chrome_RenderWidgetHostHWND` under a
hidden message window. Everything we want to read goes with it, and what is left returns nothing
useful. The symptom is "reading the screen stopped working and I have no idea why."

The fix, from their source: set `WS_EX_LAYERED` and `SetLayeredWindowAttributes` with alpha **254,
not 255**. DWM then stops classifying the window as a full occluder and Chromium stays awake. One
value, and it is the difference between the eyes working and not.

**2. There is an undocumented switch that forces UIA to consider a window visible.**
`UIA_WindowVisibilityOverridden`, set as a window property: 1 means treat as visible, 2 means treat
as invisible. They found it by disassembling `BasicHwndUtils::GetWindowVisibility` inside
`UIAutomationCore.dll`. Keep it in the back pocket for windows that refuse to be read.

**3. Four window flags, and missing one ruins the product quietly.**
`WS_EX_NOACTIVATE` (clicking the orb never steals your focus) + `WS_EX_TOOLWINDOW` (never appears in
Alt-Tab or the taskbar) + `WS_EX_TOPMOST` + `WS_EX_LAYERED`. WPF, Electron and Tauri all expose
these. WinUI 3 fights you and cannot do per-pixel input pass-through at all, so it is out.

**4. Nobody watches the screen efficiently.**
Across 190 READMEs, **zero** projects use Windows event hooks. They poll, or they screenshot — which
is why so many of them are heavy. `SetWinEventHook` on foreground-change, registered out-of-process
with no DLL injection, is how this is done without burning a core. This is the one place we can be
plainly better than the field.

**5. Do not scan the window every time.**
Measured on this machine: walking every element of a Chrome window to find the address bar takes
**~215 ms**. On every window switch that is visible lag. Find it once, keep the element, read its
value — or subscribe to its change event and stop asking.

**6. Wispr Flow's text insertion is not magic** (for later waves): clipboard, a paste shortcut it
guesses per app, clipboard restored, and a fallback message when it fails. Worth knowing before we
over-engineer that.

---

## The honest limits, decided now rather than discovered later

- **Reading a browser URL succeeds roughly 70-75% of the time** in the general case. It worked first
  try on this machine, but that is one sample and the recipe is known to be version-fragile.
- **Chrome and Electron apps build no accessibility tree at all** unless something makes them.
  Alpha-254 addresses the occlusion half of this; the rest is Chromium's own on-demand behaviour.
- **Anything running as administrator returns an empty tree with no error** — indistinguishable from
  "nothing there". A non-elevated orb cannot read elevated windows, full stop.
- **Exclusive-fullscreen games cannot be overlaid or read** by any supported method. Borderless is
  fine. This is not fixable and should never be promised.
- **DRM-protected video** is dark.

**Wave 1 must produce a measured list of which of the owner's real apps are readable.** Every later
wave — "summarise this", "reply to that" — rests on it, and a small honest promise beats a large
broken one.

---

## Architecture

Three parts, one process unless measurement says otherwise:

**The window.** Frameless, transparent, always-on-top, layered at alpha 254, no-activate,
tool-window, per-monitor DPI aware, draggable, remembers where you left it.

**The eyes.** A UI Automation service holding a foreground-change hook and a focus-change hook.
On change it produces one small object: app, window title, URL if there is one, focused control,
selection. It caches the elements it has already found rather than re-scanning.

**The ears and voice.** Push-to-talk: key down starts capture, key up stops. Speech to text runs
locally. The answer comes back as speech, streamed so it starts before the sentence is finished.

**The answer.** ONE direct model call carrying the screen context and the question. No Jarvis brain,
no tool catalogue, no 159-tool menu. This is deliberate: it keeps the wave isolated, and it is also
the shape the fast path should keep later.

---

## The slices, and how each is proven

Proof means observed behaviour in front of the owner — a screenshot, a recording, a measured number.
Not "the code runs".

### 1a — The window exists and behaves
Floats above everything, drag it anywhere, remembers its position, survives sleep/wake and a monitor
being unplugged.
**Proof:** it sits over a borderless-fullscreen video and a game; clicking it does not move focus out
of an editor mid-sentence; it does not appear in Alt-Tab; it stays crisp on both monitors.

### 1b — The eyes
Foreground app, window title, URL, focused control and selected text, updating live, event-driven.
**Proof:** a recording of the orb's panel tracking as the owner moves between Chrome, VS Code, Explorer
and Claude; plus **a table of which of his real apps expose what** — the deliverable that matters most
in this wave.

### 1c — Cost
It has to be free to leave running.
**Proof:** CPU and memory after one idle hour, and again after an hour of normal work. A number, written
down. If it is not small, the design changes here rather than later.

### 1d — Push to talk
Hold the key, speak, release. Words come back.
**Proof:** dictation of a paragraph with names and numbers in it, and the error count stated.

### 1e — It answers, out loud
The question plus what is on screen goes to one model call; the answer is spoken and shown.
**Proof:** "what am I looking at" answered correctly for four different apps, with the time from key-up
to first spoken word measured. That number is the one that decides whether this feels alive.

---

## Order of work

1a and 1b are independent and 1b is the risky one, so **1b first** — if the eyes cannot see the
owner's actual apps, the whole product changes shape and it is better to know in the first week.
Then 1a, then 1c measured against both. 1d and 1e last, because they are the least uncertain.

---

## Still unknown, and worth stating

- **Idle CPU and memory for a transparent always-on-top window on Windows 11 is not published
  anywhere** — for Electron or anything else. The agent looked. It has to be measured, and it is a
  real input to the stack decision.
- Whether local speech-to-text is fast enough on this machine, or whether the first version needs a
  hosted model.
- How much of the owner's daily software is readable. Two apps tested so far; both readable.
