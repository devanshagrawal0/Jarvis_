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
  const parsed = output ? JSON.parse(output) : [];
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
  return JSON.parse(await powershell(script));
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
  return JSON.parse(await powershell(script));
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
  return JSON.parse(await powershell(script));
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
  return JSON.parse(await powershell(script));
}

const handlers = {
  health: async () => ({ ok: true, pid: process.pid, platform: process.platform, semanticAutomation: true }),
  list_windows: listWindows,
  inspect_window: inspectWindow,
  focus_window: focusWindow,
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
