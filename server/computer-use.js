// computer-use.js — Vision-grounded computer control for Jarvis
//
// Architecture (based on Skyvern / OmniParser / Browser-Use research):
//   SCREEN MODE (non-browser windows):
//     1. Single merged PowerShell call: foreground detection + UIA extraction + SoM overlay
//     2. Send annotated screenshot to Gemini Vision → picks element NUMBER (not coords)
//     3. Execute action → settle → repeat up to maxSteps
//
//   BROWSER MODE (Chrome/Edge/Firefox detected OR URL task):
//     1. Use Playwright browser service directly — no screenshot, no SoM
//     2. snapshot() → DOM elements with refs → text-only Gemini decides action
//     3. Execute via click(ref)/navigate(url)/type(ref,value) → ~200ms settle
//     Browser mode is 5-10x faster than screen mode for web tasks.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const MAX_STEPS = 20;
const ACTION_SETTLE_MS = 500;   // was 750 — most UI settles in 400-500ms
const TYPE_SETTLE_MS   = 620;   // paste via clipboard needs a bit more
const SCROLL_SETTLE_MS = 280;   // was 450
const BROWSER_SETTLE_MS = 200;  // Playwright actions are near-instant, DOM updates fast

const GEMINI_VISION_MODEL = "gemini-2.5-flash";
const GEMINI_TEXT_MODEL   = "gemini-2.5-flash";
const MAX_SCROLL_SAME_DIR = 8;

const BROWSER_PROC_RE = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|chromium)$/i;
const WEB_TASK_RE = /https?:\/\/|instagram|youtube|google\.com|twitter|reddit|github\.com|facebook|linkedin|tiktok|spotify|netflix|amazon|kalshi|open.*browser|navigate to|go to .*(website|page|url)/i;

// ── PowerShell runner ─────────────────────────────────────────────────────────
async function ps(script, timeoutMs = 18000) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 12 * 1024 * 1024 },
  );
  return stdout.trim();
}

// ── Shared MouseOps type definition ───────────────────────────────────────────
const MOUSE_TYPE = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CUMouseOps {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
'@ -ErrorAction SilentlyContinue`;

// ── Low-level primitives ──────────────────────────────────────────────────────

async function mouseClick(x, y, button = "left", isDouble = false) {
  const ix = Math.round(x), iy = Math.round(y);
  const [downF, upF] = button === "right" ? ["0x0008", "0x0010"] : ["0x0002", "0x0004"];
  const clicks = isDouble ? 2 : 1;
  const clickScript = Array.from({ length: clicks }, () => [
    `[CUMouseOps]::mouse_event(${downF},0,0,0,[UIntPtr]::Zero)`,
    "Start-Sleep -Milliseconds 55",
    `[CUMouseOps]::mouse_event(${upF},0,0,0,[UIntPtr]::Zero)`,
    "Start-Sleep -Milliseconds 80",
  ]).flat().join(";");

  const script = [
    MOUSE_TYPE,
    `$x=${ix};$y=${iy}`,
    `$sw=[CUMouseOps]::GetSystemMetrics(0);$sh=[CUMouseOps]::GetSystemMetrics(1)`,
    `if($x -lt 0 -or $x -ge $sw -or $y -lt 0 -or $y -ge $sh){ throw "Coordinate ($x,$y) outside screen" }`,
    `[CUMouseOps]::SetCursorPos($x,$y) | Out-Null`,
    "Start-Sleep -Milliseconds 45",
    clickScript,
    `[pscustomobject]@{ok=$true;action='${button}_click';x=$x;y=$y;clicks=${clicks}} | ConvertTo-Json -Compress`,
  ].join(";");
  return JSON.parse(await ps(script, 6000));
}

async function mouseScroll(x, y, direction, amount = 3) {
  const ix = Math.round(x), iy = Math.round(y);
  const rawDelta = direction === "down" ? -(120 * amount) : (120 * amount);
  const script = [
    MOUSE_TYPE,
    `$x=${ix};$y=${iy}`,
    `$raw=${rawDelta}`,
    `$delta=[uint32]($raw -band 0xFFFFFFFF)`,
    `[CUMouseOps]::SetCursorPos($x,$y) | Out-Null`,
    "Start-Sleep -Milliseconds 40",
    `[CUMouseOps]::mouse_event(0x0800,0,0,$delta,[UIntPtr]::Zero)`,
    `[pscustomobject]@{ok=$true;action='scroll';x=$x;y=$y;direction='${direction}';amount=${amount}} | ConvertTo-Json -Compress`,
  ].join(";");
  return JSON.parse(await ps(script, 5000));
}

async function keyboardType(text) {
  const safe = String(text).replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `Set-Clipboard -Value '${safe}'`,
    "Start-Sleep -Milliseconds 110",
    "[System.Windows.Forms.SendKeys]::SendWait('^v')",
    "Start-Sleep -Milliseconds 120",
    `[pscustomobject]@{ok=$true;action='type';length=${text.length}} | ConvertTo-Json -Compress`,
  ].join(";");
  return JSON.parse(await ps(script, 7000));
}

async function keyboardKey(keys) {
  const keyMap = {
    "return": "{ENTER}", "enter": "{ENTER}",
    "escape": "{ESC}", "esc": "{ESC}",
    "tab": "{TAB}", "backspace": "{BACKSPACE}", "delete": "{DELETE}",
    "space": " ", "up": "{UP}", "down": "{DOWN}",
    "left": "{LEFT}", "right": "{RIGHT}",
    "home": "{HOME}", "end": "{END}",
    "pageup": "{PGUP}", "pagedown": "{PGDN}",
    "f5": "{F5}", "f11": "{F11}", "f12": "{F12}",
    "ctrl+a": "^a", "ctrl+c": "^c", "ctrl+v": "^v",
    "ctrl+z": "^z", "ctrl+x": "^x", "ctrl+t": "^t",
    "ctrl+w": "^w", "ctrl+l": "^l", "ctrl+r": "^r", "ctrl+f": "^f",
    "ctrl+enter": "^{ENTER}",
  };
  const normalized = String(keys || "").toLowerCase().trim();
  const sequence = keyMap[normalized] || `{${keys.toUpperCase()}}`;
  const safe = sequence.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `[System.Windows.Forms.SendKeys]::SendWait('${safe}')`,
    `[pscustomobject]@{ok=$true;action='key';keys='${normalized}'} | ConvertTo-Json -Compress`,
  ].join(";");
  return JSON.parse(await ps(script, 5000));
}

// ── MERGED Set-of-Marks: single PowerShell call ───────────────────────────────
//
// One PS process does:
//   1. P/Invoke: get foreground HWND + process name (detects browser windows)
//   2. UIA walk (skipped for browser processes — they return no useful elements)
//   3. System.Drawing overlay with numbered boxes
//   4. Base64-encodes the annotated image inline — no extra Node.js file read
//
// Returns: { isBrowser, procName, hwnd, elements, annotatedB64 }
//
async function buildSetOfMarks(screenCaptureResult) {
  const imagePath = screenCaptureResult?.path || "";
  const imgPs = imagePath ? JSON.stringify(imagePath) : "''";

  // Single merged PowerShell script
  const script = `
${MOUSE_TYPE}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CUSysInfo { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); }' -ErrorAction SilentlyContinue
try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop } catch {}
$fgHwnd=[CUSysInfo]::GetForegroundWindow()
$fgPid=0; [CUSysInfo]::GetWindowThreadProcessId($fgHwnd,[ref]$fgPid) | Out-Null
$fgProc=Get-Process -Id $fgPid -ErrorAction SilentlyContinue
$procName=if($fgProc){$fgProc.Name.ToLower()}else{'unknown'}
$isBrowser=($procName -match 'chrome|msedge|firefox|brave|opera|vivaldi|arc|chromium')
$nodesList=@()
if(-not $isBrowser){
  try {
    $fg=[System.Windows.Automation.AutomationElement]::FocusedElement
    $window=$fg
    try {
      $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
      $p=$fg
      while($p -ne $null){
        $ct=[string]$p.Current.ControlType.ProgrammaticName
        if($ct -match 'Window'){ $window=$p; break }
        $p=$walker.GetParent($p)
      }
    } catch {}
    if($null -ne $window){
      $all=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      foreach($node in $all){
        try {
          $ct=[string]$node.Current.ControlType.ProgrammaticName
          if($ct -notmatch 'Button|Edit|ComboBox|ListItem|MenuItem|CheckBox|RadioButton|Hyperlink|Tab|DataItem|Image') { continue }
          $r=$node.Current.BoundingRectangle
          if($node.Current.IsOffscreen -or $r.Width -lt 8 -or $r.Height -lt 8 -or $r.Width -gt 2000) { continue }
          $nm=[string]$node.Current.Name
          $hp=[string]$node.Current.HelpText
          $lbl=if($nm){ $nm } elseif($hp){ $hp } else { $ct.Replace('ControlType.','') }
          $nodesList+=@{x=[int]$r.X;y=[int]$r.Y;w=[int]$r.Width;h=[int]$r.Height;name=$lbl.Substring(0,[Math]::Min(40,$lbl.Length));type=$ct.Replace('ControlType.','')}
          if($nodesList.Count -ge 80){ break }
        } catch {}
      }
    }
  } catch {}
}
$annotatedB64=$null
$imgPath=${imgPs}
if($nodesList.Count -gt 0 -and $imgPath -and (Test-Path $imgPath)){
  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $img=[System.Drawing.Image]::FromFile($imgPath)
    $bmp=New-Object System.Drawing.Bitmap($img)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    $colors=@([System.Drawing.Color]::Red,[System.Drawing.Color]::Blue,[System.Drawing.Color]::Green,[System.Drawing.Color]::Purple,[System.Drawing.Color]::Orange)
    $font=New-Object System.Drawing.Font('Arial',9,[System.Drawing.FontStyle]::Bold)
    $idx=1
    foreach($el in $nodesList){
      $col=$colors[$idx % $colors.Count]
      $pen=New-Object System.Drawing.Pen($col,2)
      $brush=New-Object System.Drawing.SolidBrush($col)
      $g.DrawRectangle($pen,[int]$el.x,[int]$el.y,[int]$el.w,[int]$el.h)
      $g.DrawString([string]$idx,$font,$brush,[int]$el.x,[Math]::Max(0,[int]$el.y-14))
      $pen.Dispose(); $brush.Dispose()
      $idx++
    }
    $font.Dispose(); $g.Dispose()
    $tmpOut=[System.IO.Path]::GetTempFileName()+'.png'
    $bmp.Save($tmpOut,[System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose(); $bmp.Dispose()
    $annotatedB64=[System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($tmpOut))
    Remove-Item $tmpOut -ErrorAction SilentlyContinue
  } catch { $annotatedB64=$null }
}
$elWithIdx=@(); $i=1
foreach($el in $nodesList){
  $elWithIdx+=@{id=$i;x=$el.x;y=$el.y;w=$el.w;h=$el.h;name=$el.name;type=$el.type}
  $i++
}
[pscustomobject]@{
  hwnd=[string]$fgHwnd
  procName=$procName
  isBrowser=$isBrowser
  elements=@($elWithIdx)
  annotatedB64=$annotatedB64
} | ConvertTo-Json -Compress -Depth 5
`;

  try {
    const raw = await ps(script, 20000);
    const result = JSON.parse(raw || "{}");
    const elements = Array.isArray(result.elements)
      ? result.elements.filter(Boolean).map((el) => ({
          id: Number(el.id) || 0,
          x: el.x || 0, y: el.y || 0,
          w: el.w || 20, h: el.h || 20,
          name: el.name || el.type || "element",
          type: el.type || "unknown",
          centerX: Math.round((el.x || 0) + (el.w || 20) / 2),
          centerY: Math.round((el.y || 0) + (el.h || 20) / 2),
        }))
      : [];
    return {
      isBrowser: Boolean(result.isBrowser),
      procName: String(result.procName || ""),
      hwnd: String(result.hwnd || ""),
      elements,
      annotatedB64: result.annotatedB64 || null,
    };
  } catch {
    return { isBrowser: false, procName: "", hwnd: "", elements: [], annotatedB64: null };
  }
}

// ── Gemini API helpers ────────────────────────────────────────────────────────

async function callGeminiVision(imageBase64, prompt, apiKey, timeoutMs = 30000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: imageBase64 } },
        ]}],
        generationConfig: { temperature: 0.05, maxOutputTokens: 800, responseMimeType: "application/json" },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(clean);
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiText(prompt, apiKey, timeoutMs = 20000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 600, responseMimeType: "application/json" },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(clean);
  } finally {
    clearTimeout(timer);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createComputerUse({ screenCapture, getSettings, browserService = null }) {
  if (!screenCapture) throw new Error("createComputerUse requires screenCapture callback");

  async function captureAndRead() {
    const c = await screenCapture({ reason: "computer-use observation" });
    let b64;
    if (c?.imageBase64) b64 = c.imageBase64;
    else if (c?.path) b64 = fs.readFileSync(c.path).toString("base64");
    else throw new Error("screenCapture returned no image data");
    const dims = c.dimensions || "1920x1080";
    const parts = dims.split("x");
    return { b64, width: Number(parts[0]) || 1920, height: Number(parts[1]) || 1080, captureResult: c };
  }

  function getApiKey() {
    const s = getSettings?.() || {};
    const key = s.geminiKey || s.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini API key required for computer use");
    return key;
  }

  // ── locateElement: find element visually, return coordinates ───────────────
  async function locateElement(description) {
    const apiKey = getApiKey();
    const { b64, width, height, captureResult } = await captureAndRead();
    const { elements, annotatedB64 } = await buildSetOfMarks(captureResult);

    if (annotatedB64 && elements.length) {
      const prompt = `You are analyzing an annotated screenshot (${width}x${height}) with numbered bounding boxes on interactive elements.

Find: "${description}"

Return ONLY JSON:
{
  "elementId": <integer — number of the matching element, or 0 if not found>,
  "confidence": <0.0-1.0>,
  "description": "<what you see at that element>"
}`;
      try {
        const result = await callGeminiVision(annotatedB64, prompt, apiKey);
        const el = elements.find((e) => e.id === result.elementId);
        if (el && result.confidence > 0.4) {
          return { found: true, x: el.centerX, y: el.centerY, confidence: result.confidence, description: result.description, method: "som" };
        }
      } catch {}
    }

    // Fallback: direct coordinate prediction from plain screenshot
    const prompt = `You are analyzing a ${width}x${height} screenshot.

Find this element: "${description}"

Return ONLY JSON:
{
  "found": true or false,
  "x": <integer pixel X of element center>,
  "y": <integer pixel Y of element center>,
  "confidence": <0.0-1.0>,
  "description": "<what you found>"
}`;
    const result = await callGeminiVision(b64, prompt, apiKey);
    return { ...result, method: "direct" };
  }

  // ── executeViaPlaywright: browser-mode ReAct loop ─────────────────────────
  // Uses Playwright DOM access instead of screenshots. 5-10x faster for web tasks.
  // No screenshot needed — Gemini gets a text description of all page elements.
  async function executeViaPlaywright(task, options = {}) {
    const maxSteps = Math.min(options.maxSteps || MAX_STEPS, 30);
    const onStep = options.onStep || null;
    const apiKey = getApiKey();
    const history = [];

    for (let i = 0; i < maxSteps; i++) {
      // Get current page state via Playwright snapshot (DOM elements + refs)
      let snap;
      try {
        snap = await browserService.snapshot({ limit: 60 });
      } catch (err) {
        return { success: false, steps: history, error: `Browser snapshot failed: ${err.message}`, stepsCompleted: i, mode: "playwright" };
      }

      const url   = snap.url || "";
      const title = snap.title || "";
      const elems = Array.isArray(snap.elements) ? snap.elements.filter((e) => !e.disabled).slice(0, 50) : [];

      const elemList = elems.map((e) =>
        `  ${e.ref} [${e.role || e.tag || "?"}${e.type ? "/" + e.type : ""}] ${JSON.stringify((e.name || e.text || e.ariaLabel || e.placeholder || "").slice(0, 60))}${e.href ? " → " + e.href.slice(0, 80) : ""}`,
      ).join("\n");

      const histText = history.length
        ? `\nActions taken:\n${history.slice(-6).map((h, idx) => `  ${idx + 1}. ${h.action}${h.ref ? ` [${h.ref}]` : ""}${h.value ? ` "${String(h.value).slice(0, 40)}"` : ""}${h.url ? ` → ${h.url.slice(0, 60)}` : ""} — ${h.reasoning || ""}`).join("\n")}`
        : "";

      const prompt = `You are a web automation agent controlling a browser via Playwright.

TASK: ${task}
CURRENT PAGE: ${url}
TITLE: "${title}"${histText}

INTERACTIVE ELEMENTS (use ref field to target):
${elemList || "  (no interactive elements visible — page may still be loading)"}

PAGE TEXT EXCERPT: ${(snap.pageText || "").slice(0, 600)}

Decide the NEXT SINGLE action. Rules:
- For clicking a visible button/link: use action "click" with its ref
- For typing into an input: use action "fill" with ref + value
- For pressing a key (Enter/Escape/Tab): use action "press" with key name
- For scrolling: use action "scroll" with deltaY (+600=down, -600=up)
- For navigating to a URL: use action "navigate" with url
- For waiting for page load: use action "wait"
- When fully done: set done=true
- For Instagram: after navigating to instagram.com, look for the + icon to create a post
- For YouTube: use the search box, type the query, press Enter, then click a result

Return ONLY valid JSON:
{
  "action": "click"|"fill"|"press"|"scroll"|"navigate"|"wait"|"done",
  "ref": "<e.g. e-4 — the ref from the element list above>",
  "value": "<text for fill action>",
  "key": "<key name for press: Enter, Escape, Tab, ArrowDown, etc.>",
  "deltaY": <integer for scroll — positive=down, negative=up>,
  "url": "<full URL for navigate>",
  "reasoning": "<one sentence: what you see and why this action>",
  "done": false,
  "result": "<summary when done=true>"
}`;

      let decision;
      try {
        decision = await callGeminiText(prompt, apiKey);
      } catch (err) {
        return { success: false, steps: history, error: `Gemini error: ${err.message}`, stepsCompleted: i, mode: "playwright" };
      }

      decision.step = i + 1;
      history.push(decision);
      onStep?.({ step: i + 1, ...decision });

      if (decision.done || decision.action === "done") {
        return { success: true, steps: history, result: decision.result || "Task complete", stepsCompleted: i + 1, mode: "playwright" };
      }

      // Execute via Playwright
      try {
        switch (decision.action) {
          case "navigate": {
            const navUrl = String(decision.url || "").trim();
            if (!navUrl) break;
            await browserService.navigate({ url: navUrl });
            await new Promise((r) => setTimeout(r, 800)); // navigation needs more settle time
            break;
          }
          case "click": {
            const ref = String(decision.ref || "").trim();
            if (!ref) break;
            await browserService.click({ ref });
            await new Promise((r) => setTimeout(r, BROWSER_SETTLE_MS));
            break;
          }
          case "fill": {
            const ref = String(decision.ref || "").trim();
            const value = String(decision.value ?? "");
            if (!ref) break;
            await browserService.type({ ref, value });
            await new Promise((r) => setTimeout(r, BROWSER_SETTLE_MS));
            break;
          }
          case "press": {
            const ref = String(decision.ref || "").trim();
            const key  = String(decision.key || "Enter").trim();
            if (ref) {
              await browserService.act({ action: "press", ref, key });
            } else {
              // No ref — use keyboard on focused element via keyboardKey fallback
              await keyboardKey(key.toLowerCase().replace("enter", "return").replace("escape", "esc"));
            }
            await new Promise((r) => setTimeout(r, BROWSER_SETTLE_MS));
            break;
          }
          case "scroll": {
            const ref    = String(decision.ref || "body").trim();
            const deltaY = Math.max(-5000, Math.min(5000, Number(decision.deltaY) || 600));
            try {
              await browserService.act({ action: "scroll", ref, deltaY });
            } catch {
              await browserService.act({ action: "scroll", selector: "body", deltaY });
            }
            await new Promise((r) => setTimeout(r, BROWSER_SETTLE_MS));
            break;
          }
          case "wait":
            await new Promise((r) => setTimeout(r, 1200));
            break;
          default:
            await new Promise((r) => setTimeout(r, 300));
        }
      } catch (execErr) {
        history[history.length - 1].error = execErr.message;
        // If browser action fails (stale ref, element gone), wait a beat and continue
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    return { success: false, steps: history, result: `Reached max steps (${maxSteps}) without completing task`, stepsCompleted: maxSteps, mode: "playwright" };
  }

  // ── execute: screen mode ReAct loop (SoM + Gemini Vision) ────────────────
  async function executeViaScreen(task, options = {}) {
    const maxSteps = Math.min(options.maxSteps || MAX_STEPS, 30);
    const onStep = options.onStep || null;
    const apiKey = getApiKey();
    const history = [];
    const scrollCounts = { up: 0, down: 0, left: 0, right: 0 };

    for (let i = 0; i < maxSteps; i++) {
      const { b64, width, height, captureResult } = await captureAndRead();
      const { elements, annotatedB64, isBrowser } = await buildSetOfMarks(captureResult);
      const imageToSend = annotatedB64 || b64;
      const hasSoM = Boolean(annotatedB64 && elements.length);

      const historyText = history.length
        ? `\nActions taken so far:\n${history.slice(-8).map((h, idx) =>
            `${idx + 1}. ${h.action}${h.elementId ? ` [element #${h.elementId}]` : h.x != null ? ` at (${h.x},${h.y})` : ""}${h.text ? ` "${String(h.text).slice(0, 40)}"` : ""}${h.key ? ` [${h.key}]` : ""} — ${h.reasoning || ""}`
          ).join("\n")}`
        : "";

      const somInstructions = hasSoM
        ? `\nThe screenshot has NUMBERED BOUNDING BOXES on every interactive element. When clicking, use elementId (pick a number you see) — much more reliable than raw coordinates.\nAvailable elements: ${elements.slice(0, 30).map((e) => `#${e.id}:${e.name}(${e.type})`).join(", ")}`
        : isBrowser
          ? "\nBrowser window detected — no UIA elements (web DOM not accessible via UIA). Use visual position for web elements."
          : "";

      const prompt = `You are a computer automation agent controlling a Windows PC (${width}x${height}).

TASK: ${task}
${historyText}
${somInstructions}

Decide the NEXT SINGLE action. Rules:
- Prefer elementId over raw x/y when numbered elements are visible
- For web apps (Instagram, YouTube, Chrome) use visual position if no elementId
- After typing, use key:"return" to submit
- For Instagram: tap the + or camera icon → then upload → find the file
- For YouTube: click the search bar → type → press return → click a video
- When task is fully complete, set done:true

Return ONLY valid JSON (no markdown):
{
  "action": "click"|"double_click"|"right_click"|"type"|"key"|"scroll"|"wait"|"done",
  "elementId": <int from numbered overlay, preferred over x/y>,
  "x": <int pixel X, only when elementId unavailable>,
  "y": <int pixel Y, only when elementId unavailable>,
  "text": "<text for type action>",
  "key": "<key: return/escape/tab/ctrl+a/ctrl+v/f5/etc>",
  "direction": "up"|"down"|"left"|"right",
  "amount": <int 1-10>,
  "reasoning": "<one sentence>",
  "done": false,
  "result": "<summary when done=true>"
}`;

      let decision;
      try {
        decision = await callGeminiVision(imageToSend, prompt, apiKey);
      } catch (err) {
        return { success: false, steps: history, error: `Vision API error: ${err.message}`, stepsCompleted: i, mode: "screen" };
      }

      decision.step = i + 1;

      if (decision.elementId && hasSoM) {
        const el = elements.find((e) => e.id === decision.elementId);
        if (el) { decision.x = el.centerX; decision.y = el.centerY; decision._resolvedFromSoM = true; }
      }
      if (decision.x != null) decision.x = Math.round(Number(decision.x));
      if (decision.y != null) decision.y = Math.round(Number(decision.y));

      if (decision.action === "scroll") {
        const dir = decision.direction || "down";
        scrollCounts[dir] = (scrollCounts[dir] || 0) + 1;
        Object.keys(scrollCounts).forEach((k) => { if (k !== dir) scrollCounts[k] = 0; });
        if (scrollCounts[dir] > MAX_SCROLL_SAME_DIR) {
          decision.action = "done";
          decision.done = true;
          decision.result = `Could not find target by scrolling ${dir} ${scrollCounts[dir]} times. Element may not exist.`;
        }
      } else {
        Object.keys(scrollCounts).forEach((k) => { scrollCounts[k] = 0; });
      }

      history.push(decision);
      onStep?.({ step: i + 1, ...decision });

      if (decision.done || decision.action === "done") {
        return { success: true, steps: history, result: decision.result || "Task complete", stepsCompleted: i + 1, mode: "screen" };
      }

      try {
        switch (decision.action) {
          case "click":
            if (decision.x == null || decision.y == null) break;
            await mouseClick(decision.x, decision.y, "left", false);
            await new Promise((r) => setTimeout(r, ACTION_SETTLE_MS));
            break;
          case "double_click":
            if (decision.x == null || decision.y == null) break;
            await mouseClick(decision.x, decision.y, "left", true);
            await new Promise((r) => setTimeout(r, ACTION_SETTLE_MS));
            break;
          case "right_click":
            if (decision.x == null || decision.y == null) break;
            await mouseClick(decision.x, decision.y, "right", false);
            await new Promise((r) => setTimeout(r, ACTION_SETTLE_MS));
            break;
          case "type":
            if (!decision.text) break;
            await keyboardType(String(decision.text));
            await new Promise((r) => setTimeout(r, TYPE_SETTLE_MS));
            break;
          case "key":
            if (!decision.key) break;
            await keyboardKey(String(decision.key));
            await new Promise((r) => setTimeout(r, ACTION_SETTLE_MS));
            break;
          case "scroll": {
            const sx = decision.x ?? Math.round(width / 2);
            const sy = decision.y ?? Math.round(height / 2);
            await mouseScroll(sx, sy, decision.direction || "down", Math.max(1, Math.min(10, decision.amount || 3)));
            await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));
            break;
          }
          case "wait": {
            const ms = Math.max(500, Math.min(5000, decision.ms || 1500));
            await new Promise((r) => setTimeout(r, ms));
            break;
          }
          default:
            await new Promise((r) => setTimeout(r, 300));
        }
      } catch (execErr) {
        history[history.length - 1].error = execErr.message;
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return { success: false, steps: history, result: `Reached max steps (${maxSteps}) without completing task`, stepsCompleted: maxSteps, mode: "screen" };
  }

  // ── execute: route to Playwright for browser tasks, screen mode otherwise ──
  async function execute(task, options = {}) {
    // Route to Playwright when:
    //  (a) browserService is available, AND
    //  (b) task is clearly web-related (URL, known site name, etc.)
    //
    // This is 5-10x faster for web tasks: no screenshots, no SoM, direct DOM access.
    const usePlaywright = browserService !== null && WEB_TASK_RE.test(task);

    if (usePlaywright) {
      try {
        return await executeViaPlaywright(task, options);
      } catch (err) {
        // Playwright failed (browser closed, network issue) — fall through to screen mode
        const screenResult = await executeViaScreen(task, options);
        return { ...screenResult, playwrightFallback: true, playwrightError: err.message };
      }
    }

    return executeViaScreen(task, options);
  }

  // ── observe: describe screen with element coordinates ─────────────────────
  async function observe(question) {
    const apiKey = getApiKey();
    const q = question || "Describe everything visible on this screen, including all interactive elements with their approximate pixel coordinates.";
    const { b64, width, height, captureResult } = await captureAndRead();
    const { elements, annotatedB64 } = await buildSetOfMarks(captureResult);
    const imageToSend = annotatedB64 || b64;

    const prompt = `You are analyzing a ${width}x${height} screenshot${annotatedB64 ? " with numbered element overlays" : ""}.

${q}

Return JSON:
{
  "summary": "<one sentence: current screen state>",
  "app": "<focused application name>",
  "url": "<current URL if browser visible, else null>",
  "elements": [{ "id": <element number or null>, "description": "<name/type>", "x": <int>, "y": <int>, "interactable": true|false }],
  "text_content": "<important visible text, max 400 chars>"
}`;

    const result = await callGeminiVision(imageToSend, prompt, apiKey);
    return { ...result, somElements: elements.length, hasSoM: Boolean(annotatedB64) };
  }

  return {
    execute,
    executeViaPlaywright,
    executeViaScreen,
    locateElement,
    observe,
    mouseClick,
    mouseScroll,
    keyboardType,
    keyboardKey,
  };
}

module.exports = { createComputerUse };
