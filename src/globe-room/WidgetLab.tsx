import {
  Activity, Atom, BookOpen, BrainCircuit, Camera, CheckCircle2, ChevronDown, ChevronRight, CircleDot,
  Code2, Database, FileText, GitBranch, Glasses, Laptop, MapPin, Maximize2, Mic, Monitor,
  Info, Network, Plus, RotateCcw, Search, Send, Server, ShieldCheck, SlidersHorizontal, Smartphone, Video
} from "lucide-react";
import WidgetLabScene from "./WidgetLabScene";

type ShellProps = {
  className: string;
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
};

function WidgetShell({ className, title, icon, meta, children }: ShellProps) {
  return (
    <section className={`lab-widget ${className}`}>
      <header><span className="lab-title">{icon}<b>{title}</b></span><span className="lab-meta">{meta}</span></header>
      <div className="lab-content">{children}</div><i className="lab-scanline" aria-hidden="true" />
    </section>
  );
}

const graphPoints = [
  "0,24 13,23 22,15 34,20 45,12 59,18 72,8 86,17 100,13 116,19",
  "0,23 14,22 29,20 42,12 55,18 67,7 78,20 92,9 104,15 116,8",
  "0,25 15,24 26,20 39,13 51,19 66,10 80,16 95,8 107,15 116,12",
  "0,24 14,23 27,16 39,20 53,11 68,18 82,9 96,17 108,10 116,14"
];

function MiniGraph({ index }: { index: number }) {
  return <svg className="lab-spark" viewBox="0 0 116 30" preserveAspectRatio="none"><path d="M0 25H116" /><polyline points={graphPoints[index]} /></svg>;
}

function SystemPulse() {
  const metrics = [["CPU", 32], ["Memory", 48], ["GPU", 26], ["Network", 72]];
  return (
    <WidgetShell className="lab-system pose-left-strong" title="SYSTEM PULSE" icon={<Activity />} meta={<span className="lab-live">Live</span>}>
      <div className="lab-metric-grid">{metrics.map(([label, value], index) => <article key={label}><span>{label}</span><strong>{value}%</strong><MiniGraph index={index} /></article>)}</div>
      <footer className="lab-system-footer"><span>Uptime <b>5d 18h 27m</b></span><span>Processes <b>248</b></span><button><SlidersHorizontal /> Optimize</button></footer>
    </WidgetShell>
  );
}

const agentRows = [
  ["Research Agent", "Scanning 128 sources", Atom, "cyan"],
  ["Code Agent", "Refactoring module", BrainCircuit, "violet"],
  ["Data Agent", "Analyzing datasets", Database, "amber"],
  ["Ops Agent", "Monitoring systems", Network, "neutral"],
  ["Assistant Agent", "Standing by", MapPin, "blue"]
] as const;

function Agents() {
  return (
    <WidgetShell className="lab-agents pose-left-strong" title="AGENTS" icon={<Network />} meta={<><span>7 Active</span><Plus /></>}>
      <div className="lab-agent-list">{agentRows.map(([name, detail, Icon, tone], index) => (
        <button className={index === 0 ? "selected" : ""} key={name}>
          <span className={`lab-agent-icon ${tone}`}><Icon /></span><span className="lab-agent-copy"><b>{name}</b><small>{detail}</small></span>
          <i className={index < 4 ? "online" : ""} />{index < 4 && <em>×</em>}
        </button>
      ))}</div>
    </WidgetShell>
  );
}

function CameraFeed() {
  return (
    <WidgetShell className="lab-camera pose-left-soft" title="CAMERA FEED" icon={<Camera />} meta={<span>Living Room <ChevronDown /></span>}>
      <div className="lab-camera-frame"><img src="/assets/reference-camera-feed.png" alt="Living room camera" /><button><Maximize2 /></button></div>
      <div className="lab-camera-tools"><button><Video /></button><button><ChevronDown /></button><button><Mic /></button><button><Camera /></button><button><RotateCcw /></button><button><Maximize2 /></button><span className="lab-live">Live</span></div>
    </WidgetShell>
  );
}

const memories = [
  ["10:21 AM", "Research findings saved", "Quantum compute brief"], ["09:48 AM", "Project Phoenix updated", "Module architecture v2"],
  ["09:32 AM", "Meeting with Alex", "Product strategy sync"], ["08:55 AM", "New note created", "Ideas for user flow"],
  ["08:17 AM", "Data set imported", "Machine learning samples"]
];

function MemoryTimeline() {
  return (
    <WidgetShell className="lab-memory pose-left-soft" title="MEMORY TIMELINE" icon={<CircleDot />} meta={<span>Today <ChevronDown /></span>}>
      <div className="lab-timeline">{memories.map(([time, title, detail]) => <article key={time}><time>{time}</time><i /><div><b>{title}</b><small>{detail}</small></div></article>)}</div>
      <button className="lab-footer-action">View all memories</button>
    </WidgetShell>
  );
}

function Research() {
  return (
    <WidgetShell className="lab-research pose-right-soft" title="RESEARCH" icon={<Network />} meta={<><Plus /><span>×</span></>}>
      <div className="lab-tabs"><button className="active">Current</button><button>Sources</button><button>Findings</button></div>
      <article className="lab-report"><b>Quantum Computing Breakthroughs</b><small>12 sources · Updated 2m ago</small><p>Analyzing the latest developments in quantum error correction and topological qubits.</p>
        <div className="lab-progress"><i><span style={{ width: "78%" }} /></i><b>78%</b></div><div className="lab-tags"><span>arXiv</span><span>Nature</span><span>IEEE</span><span>Google Scholar</span></div>
        <button className="lab-footer-action">View full report</button></article>
    </WidgetShell>
  );
}

const projects = [
  ["Project Phoenix", "In Progress", 72, Atom, "cyan"], ["Jarvis Core", "In Progress", 45, FileText, "violet"],
  ["Website Redesign", "In Review", 56, Code2, "green"], ["Data Pipeline", "In Progress", 30, Database, "blue"]
] as const;

function Projects() {
  return (
    <WidgetShell className="lab-projects pose-right-soft" title="PROJECTS" icon={<Code2 />} meta={<><span>Active <ChevronDown /></span><button><Plus /> New</button></>}>
      <div className="lab-project-list">{projects.map(([name, status, value, Icon, tone]) => <button key={name}><span className={`lab-project-icon ${tone}`}><Icon /></span><span className="lab-project-copy"><b>{name}</b><small>{status}</small><i><span style={{ width: `${value}%` }} /></i></span><strong>{value}%</strong><ChevronRight /></button>)}</div>
      <button className="lab-footer-action">View all projects</button>
    </WidgetShell>
  );
}

function BrowserWidget() {
  const pinned = [["Project Roadmap", "Notion", FileText], ["Architecture Diagram", "Miro", Network], ["Meeting Notes", "Google Docs", BookOpen], ["Research Brief", "PDF", FileText]] as const;
  return (
    <WidgetShell className="lab-browser pose-right-strong" title="BROWSER" icon={<Network />} meta={<><Plus /><span>×</span></>}>
      <div className="lab-address"><button>‹</button><span>jarvis://secure</span><Search /><RotateCcw /><Maximize2 /></div><p className="lab-section-label">Top Sites</p>
      <div className="lab-sites"><button><FileText /><span>Docs</span></button><button className="selected"><GitBranch /><span>GitHub</span></button><button><BookOpen /><span>Notion</span></button></div>
      <p className="lab-section-label">Pinned</p><div className="lab-pinned">{pinned.map(([title, source, Icon]) => <button key={title}><Icon /><span><b>{title}</b><small>{source}</small></span><ChevronRight /></button>)}</div>
      <button className="lab-footer-action">Show all</button>
    </WidgetShell>
  );
}

const devices = [["Workstation", Monitor], ["MacBook Pro", Laptop], ["iPhone 15 Pro", Smartphone], ["Vision Pro", Glasses], ["Home Server", Server], ["Living Room Cam", Camera]] as const;
function DeviceHub() {
  return (
    <WidgetShell className="lab-devices pose-right-strong" title="DEVICE HUB" icon={<Network />} meta={<><span>6 Connected</span><Plus /></>}>
      <div className="lab-device-list">{devices.map(([name, Icon]) => <button key={name}><Icon /><b>{name}</b><span>Online</span><i /></button>)}</div>
      <button className="lab-footer-action">Manage devices</button>
    </WidgetShell>
  );
}

const receipts = [
  ["System scan completed", "All systems operational", "10:42 AM", CheckCircle2, "success"],
  ["Research report generated", "Quantum Computing Breakthroughs", "10:39 AM", Info, "info"],
  ["Backup completed", "12.4 GB · Local + Cloud", "10:37 AM", CheckCircle2, "success"],
  ["New device connected", "iPhone 15 Pro", "10:35 AM", Info, "info"],
  ["Security check passed", "No threats detected", "10:33 AM", ShieldCheck, "success"]
] as const;

function CommandReceipts() {
  return (
    <WidgetShell className="lab-receipts pose-right-soft" title="COMMAND RECEIPTS" icon={<FileText />} meta={<button>Clear</button>}>
      <div className="lab-receipt-list">{receipts.map(([title, detail, time, Icon, tone]) => (
        <article key={title}><span className={tone}><Icon /></span><div><b>{title}</b><small>{detail}</small></div><time>{time}</time></article>
      ))}</div>
      <button className="lab-footer-action">View all receipts</button>
    </WidgetShell>
  );
}

function CommandStrip() {
  const points = "0,27 20,27 31,24 43,30 56,20 70,34 84,18 99,36 114,12 129,40 145,16 161,34 177,20 194,31 211,23 228,29 246,19 263,35 280,14 297,39 314,18 331,34 348,21 365,30 382,24 400,28 418,23 436,29 458,27";
  return (
    <section className="lab-command">
      <button className="lab-brain"><BrainCircuit /></button>
      <div><input placeholder="Ask Jarvis anything..." /><svg viewBox="0 0 458 52" preserveAspectRatio="none"><line x1="0" y1="27" x2="458" y2="27" /><polyline points={points} /></svg></div>
      <button><RotateCcw /></button><button><SlidersHorizontal /></button><button className="lab-send"><Send /></button>
    </section>
  );
}

export default function WidgetLab() {
  return (
    <main className="widget-lab" data-visual-ready="true"><WidgetLabScene /><div className="lab-atmosphere" />
      <header className="lab-heading"><span>JARVIS UI</span><i /> WIDGET LAB <i /><small>OPTICAL GLASS · SPATIAL PLANES · INTERACTIVE DOM</small></header>
      <div className="lab-grid"><SystemPulse /><Agents /><CameraFeed /><MemoryTimeline /><Research /><Projects /><BrowserWidget /><DeviceHub /></div>
      <CommandStrip />
    </main>
  );
}
