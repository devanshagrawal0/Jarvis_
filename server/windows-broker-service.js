const readline = require("readline");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const brokerToken = process.env.JARVIS_BROKER_TOKEN;
const MAX_OUTPUT = 2 * 1024 * 1024;

if (!brokerToken) process.exit(2);

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function powershell(script, timeout = 30000) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT },
  );
  return stdout.trim();
}

function parseBrokerJson(output, fallback) {
  const raw = String(output || "").replace(/^\uFEFF/, "").trim();
  if (!raw && fallback !== undefined) return fallback;
  // UI Automation window/control titles can contain literal CR, LF, tabs, or
  // other control bytes. PowerShell's ConvertTo-Json may emit them raw, which
  // makes otherwise valid broker output impossible for JSON.parse to read.
  return JSON.parse(raw.replace(/[\u0000-\u001F]/g, " "));
}

const bootstrap = [
  "Add-Type -AssemblyName UIAutomationClient",
  "Add-Type -AssemblyName UIAutomationTypes",
  "Add-Type -AssemblyName System.Windows.Forms",
].join(";");

async function listWindows(args) {
  const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));
  const script = [
    bootstrap,
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    "$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)",
    `$items=$root.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)|Select-Object -First ${limit}`,
    "function Safe-Number($value){$number=[double]$value;if([double]::IsNaN($number)-or [double]::IsInfinity($number)){return $null};return $number}",
    "$result=@($items|ForEach-Object { $rect=$_.Current.BoundingRectangle;@{name=$_.Current.Name;automationId=$_.Current.AutomationId;processId=$_.Current.ProcessId;enabled=$_.Current.IsEnabled;offscreen=$_.Current.IsOffscreen;bounds=@{x=(Safe-Number $rect.X);y=(Safe-Number $rect.Y);width=(Safe-Number $rect.Width);height=(Safe-Number $rect.Height)}} })",
    "$result|ConvertTo-Json -Depth 5 -Compress",
  ].join(";");
  const output = await powershell(script);
  const parsed = parseBrokerJson(output, []);
  return { windows: Array.isArray(parsed) ? parsed : [parsed] };
}

async function inspectWindow(args) {
  const title = clean(args.title, 200);
  if (!title) throw new Error("Window title is required");
  const limit = Math.max(1, Math.min(200, Number(args.limit || 80)));
  const script = [
    bootstrap,
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    `$window=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -like ${psQuote(`*${title}*`)}}|Select-Object -First 1`,
    "if(-not $window){throw 'Window not found'}",
    `$nodes=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Select-Object -First ${limit}`,
    "$result=@($nodes|ForEach-Object { @{name=$_.Current.Name;automationId=$_.Current.AutomationId;controlType=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled;offscreen=$_.Current.IsOffscreen;processId=$_.Current.ProcessId} })",
    "@{window=@{name=$window.Current.Name;processId=$window.Current.ProcessId};controls=$result}|ConvertTo-Json -Depth 5 -Compress",
  ].join(";");
  return parseBrokerJson(await powershell(script));
}

async function focusWindow(args) {
  const title = clean(args.title, 200);
  if (!title) throw new Error("Window title is required");
  const script = [
    bootstrap,
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    `$window=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -like ${psQuote(`*${title}*`)}}|Select-Object -First 1`,
    "if(-not $window){throw 'Window not found'}",
    "$window.SetFocus()",
    "@{focused=$true;name=$window.Current.Name;processId=$window.Current.ProcessId}|ConvertTo-Json -Compress",
  ].join(";");
  return parseBrokerJson(await powershell(script));
}

async function createBrowserWindow(args) {
  const requestedUrl = clean(args.url, 2000);
  let parsed;
  try { parsed = new URL(requestedUrl); } catch { throw new Error("A valid browser URL is required"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) browser windows are allowed");
  const script = [
    bootstrap,
    "$candidates=@((Join-Path $env:ProgramFiles 'Google\\Chrome\\Application\\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Google\\Chrome\\Application\\chrome.exe'),(Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\Application\\chrome.exe'))",
    "$chrome=$candidates|Where-Object {$_ -and (Test-Path $_)}|Select-Object -First 1",
    "if(-not $chrome){throw 'Google Chrome executable was not found'}",
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    "$before=@($root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.ClassName -eq 'Chrome_WidgetWin_1'}|ForEach-Object {[int64]$_.Current.NativeWindowHandle})",
    `$url=${psQuote(parsed.href)}`,
    "Start-Process -FilePath $chrome -ArgumentList @('--new-window','--start-minimized',$url) -WindowStyle Minimized|Out-Null",
    "$deadline=(Get-Date).AddSeconds(10);$window=$null",
    "do{$window=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $before -notcontains [int64]$_.Current.NativeWindowHandle}|Select-Object -First 1;if(-not $window){Start-Sleep -Milliseconds 150}}while(-not $window -and (Get-Date)-lt $deadline)",
    "if(-not $window){throw 'A separate Chrome task window was not detected'}",
    "$pattern=$null;if($window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){$pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized)}",
    "@{created=$true;minimized=$true;handle=[string]$window.Current.NativeWindowHandle;processId=$window.Current.ProcessId;title=$window.Current.Name}|ConvertTo-Json -Compress",
  ].join(";");
  return parseBrokerJson(await powershell(script, 20000));
}

async function setWindowState(args, state) {
  const handle = clean(args.handle, 30);
  if (!/^\d+$/.test(handle) || handle === "0") throw new Error("A valid native window handle is required");
  const visualState = state === "restore" ? "Normal" : "Minimized";
  const script = [
    bootstrap,
    `$handle=[int]${handle}`,
    "$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)",
    "if(-not $root){throw 'Window handle is no longer available'}",
    "$pattern=$null;if(-not $root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Window state control is unavailable'}",
    `$pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::${visualState})`,
    state === "restore" ? "$root.SetFocus()" : "",
    `@{updated=$true;state=${psQuote(state)};handle=[string]$handle;title=$root.Current.Name}|ConvertTo-Json -Compress`,
  ].filter(Boolean).join(";");
  return parseBrokerJson(await powershell(script, 10000));
}

async function closeWindow(args) {
  const handle = clean(args.handle, 30);
  if (!/^\d+$/.test(handle) || handle === "0") throw new Error("A valid native window handle is required");
  const script = [
    bootstrap,
    `$handle=[int]${handle}`,
    "$window=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)",
    "if(-not $window){return @{closed=$true;alreadyGone=$true;handle=[string]$handle}|ConvertTo-Json -Compress}",
    "$pattern=$null;if(-not $window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Window close control is unavailable'}",
    "$pattern.Close()",
    "@{closed=$true;alreadyGone=$false;handle=[string]$handle}|ConvertTo-Json -Compress",
  ].join(";");
  return parseBrokerJson(await powershell(script, 10000));
}

async function invokeControl(args) {
  const windowTitle = clean(args.windowTitle, 200);
  const controlName = clean(args.controlName, 200);
  if (!windowTitle || !controlName) throw new Error("Window title and control name are required");
  const script = [
    bootstrap,
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    `$window=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -like ${psQuote(`*${windowTitle}*`)}}|Select-Object -First 1`,
    "if(-not $window){throw 'Window not found'}",
    `$control=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -eq ${psQuote(controlName)} -or $_.Current.AutomationId -eq ${psQuote(clean(args.automationId, 200))}}|Select-Object -First 1`,
    "if(-not $control){throw 'Control not found'}",
    "$pattern=$null",
    "if(-not $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){throw 'Control does not support InvokePattern'}",
    "$pattern.Invoke()",
    "@{invoked=$true;window=$window.Current.Name;control=$control.Current.Name;automationId=$control.Current.AutomationId}|ConvertTo-Json -Compress",
  ].join(";");
  return parseBrokerJson(await powershell(script));
}

async function setControlValue(args) {
  const windowTitle = clean(args.windowTitle, 200);
  const controlName = clean(args.controlName, 200);
  const value = clean(args.value, 8000);
  if (!windowTitle || !controlName) throw new Error("Window title and control name are required");
  const script = [
    bootstrap,
    "$root=[System.Windows.Automation.AutomationElement]::RootElement",
    `$window=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -like ${psQuote(`*${windowTitle}*`)}}|Select-Object -First 1`,
    "if(-not $window){throw 'Window not found'}",
    `$control=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.Name -eq ${psQuote(controlName)} -or $_.Current.AutomationId -eq ${psQuote(clean(args.automationId, 200))}}|Select-Object -First 1`,
    "if(-not $control){throw 'Control not found'}",
    "$pattern=$null",
    "if(-not $control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){throw 'Control does not support ValuePattern'}",
    `if($pattern.Current.IsReadOnly){throw 'Control is read-only'};$pattern.SetValue(${psQuote(value)})`,
    "@{updated=$true;window=$window.Current.Name;control=$control.Current.Name;valueLength=" + value.length + "}|ConvertTo-Json -Compress",
  ].join(";");
  return parseBrokerJson(await powershell(script));
}

const handlers = {
  health: async () => ({ ok: true, pid: process.pid, platform: process.platform, semanticAutomation: true }),
  list_windows: listWindows,
  inspect_window: inspectWindow,
  focus_window: focusWindow,
  create_browser_window: createBrowserWindow,
  minimize_window: (args) => setWindowState(args, "minimize"),
  restore_window: (args) => setWindowState(args, "restore"),
  close_window: closeWindow,
  invoke_control: invokeControl,
  set_control_value: setControlValue,
};

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    if (request.token !== brokerToken) throw new Error("Unauthorized broker request");
    const handler = handlers[request.method];
    if (!handler) throw new Error("Unknown broker method");
    const result = await handler(request.params || {});
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request?.id, ok: false, error: error.message })}\n`);
  }
});
