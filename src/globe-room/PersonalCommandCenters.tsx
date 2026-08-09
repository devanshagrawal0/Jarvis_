import { useMemo } from "react";
import "./PersonalCommandCenters.css";

function command(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
}

function dollars(value: unknown) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function compact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function duration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function Stat({ label, value, note, tone = "cyan" }: { label: string; value: string | number; note: string; tone?: string }) {
  return <article className={`pc-stat pc-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

export function ProfileCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const identity = data?.identity || {};
  const cost = data?.cost || {};
  const models = Object.entries(cost?.byModel || {}) as [string, any][];
  const preferences: any[] = data?.preferences || [];
  const goals: any[] = data?.goals || [];
  const facts: any[] = data?.facts || [];
  const locations: any[] = data?.locations || [];
  const totalTokens = Number(cost?.month?.tokIn || 0) + Number(cost?.month?.tokOut || 0);
  const maxCalls = Math.max(1, ...models.map(([, value]) => Number(value.calls || 0)));
  return <div className="pc-center profile-command">
    <section className="pc-hero"><div className="pc-avatar">{String(identity.preferred_name || identity.legal_name || "J").slice(0, 1)}</div><div><span>OWNER CONTEXT PLANE</span><h2>{identity.preferred_name || "Profile"}</h2><p>{identity.bio || "Your verified identity, preferences, context coverage and AI consumption."}</p></div><div className="pc-live"><i /> AUTHORITATIVE</div></section>
    <div className="pc-stats"><Stat label="Month spend" value={dollars(cost?.month?.cost)} note={`${cost?.month?.calls || 0} model calls`} tone="green" /><Stat label="Month tokens" value={compact(totalTokens)} note={`${compact(cost?.month?.tokIn || 0)} input`} /><Stat label="Known context" value={preferences.length + goals.length + facts.length + locations.length} note="profile records" tone="violet" /><Stat label="Home base" value={data?.location?.resolved?.placeName || "unknown"} note={identity.home_timezone || "timezone missing"} tone="amber" /></div>
    <div className="pc-profile-grid"><section className="pc-panel"><header><div><span>Verified identity</span><strong>{identity.legal_name || "Not configured"}</strong></div><small>{data?.time || "local time unavailable"}</small></header><div className="pc-key-grid"><div><span>Preferred name</span><strong>{identity.preferred_name || "—"}</strong></div><div><span>Locale</span><strong>{identity.locale || "—"}</strong></div><div><span>Email</span><strong>{identity.primary_email || "—"}</strong></div><div><span>Current place</span><strong>{data?.location?.resolved?.placeName || "—"}</strong></div><div><span>Location source</span><strong>{data?.location?.resolved?.source || "—"}</strong></div><div><span>Coordinates</span><strong>{data?.location?.resolved ? `${data.location.resolved.lat}, ${data.location.resolved.lon}` : "—"}</strong></div></div><div className="pc-actions"><button onClick={() => command("Use my verified owner profile as the active context. Summarize what you know, distinguish verified facts from missing information, and do not invent anything.")}>Load owner context</button><button onClick={() => command("Audit my JARVIS profile context. Tell me which useful preferences, recurring goals, locations, and facts are missing or stale. Do not change anything.")}>Audit context</button></div></section>
      <section className="pc-panel"><header><div><span>Context coverage</span><strong>{preferences.length + goals.length + facts.length + locations.length} records</strong></div><small>{loading ? "refreshing" : "live"}</small></header><div className="pc-coverage"><article><b>{preferences.length}</b><span>Preferences</span><p>{preferences.length ? preferences.map((item) => `${item.subject}: ${item.value}`).join(" · ") : "No response or workflow preferences saved."}</p></article><article><b>{goals.length}</b><span>Goals</span><p>{goals.length ? goals.slice(0, 3).map((item) => item.title || item.goal).join(" · ") : "No explicit active goals are attached to the profile."}</p></article><article><b>{locations.length}</b><span>Locations</span><p>{locations.length ? locations.map((item) => `${item.label}: ${item.address}`).join(" · ") : "No trusted places saved."}</p></article><article><b>{facts.length}</b><span>Facts</span><p>{facts.length ? facts.slice(0, 3).map((item) => item.value || item.fact).join(" · ") : "No standalone owner facts are saved in this profile store."}</p></article></div></section>
      <section className="pc-panel pc-span"><header><div><span>Model consumption</span><strong>{dollars(cost?.allTime?.cost)} all time</strong></div><small>{cost?.allTime?.calls || 0} calls</small></header><div className="pc-models">{models.map(([name, item]) => <article key={name}><div><strong>{name.replace("gemini-", "")}</strong><span>{item.calls} calls · {compact(Number(item.tokIn || 0) + Number(item.tokOut || 0))} tokens</span></div><div className="pc-bar"><i style={{ width: `${Math.max(4, Number(item.calls || 0) / maxCalls * 100)}%` }} /></div><b>{dollars(item.cost)}</b></article>)}</div><div className="pc-actions"><button onClick={() => command("Analyze my current model usage and cost by model. Identify waste, workloads that should use a cheaper tier, and workloads that justify a stronger model. Use the live profile cost data and give concrete routing rules.")}>Optimize model routing</button></div></section></div>
  </div>;
}

// ATLAS Wave 1 — Today. The assistant's home surface: now/next, the day's timeline, the few
// things that need the owner, and what he's waiting on. Reads /api/atlas/today (local day-model).
function clockOf(iso?: string | null, tz?: string) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }); } catch { return ""; }
}
export function TodayCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const tz = data?.tz;
  const now = data?.nowNext?.now || null;
  const next = data?.nowNext?.next || null;
  const timeline: any[] = data?.timeline || [];
  const top: any[] = data?.topOfMind || [];
  const waiting: any[] = data?.waitingOnThem || [];
  const counts = data?.counts || {};
  const nowIso = data?.now;
  return <div className="pc-center today-command">
    <section className="pc-hero"><div><span>YOUR DAY</span><h2>{now ? now.title : next ? `Next: ${next.title}` : "Nothing scheduled"}</h2><p>{now ? `On now until ${clockOf(now.endAt, tz) || "—"}${next ? ` · then ${next.title} at ${clockOf(next.startAt, tz)}` : ""}` : next ? `Starts at ${clockOf(next.startAt, tz)}${next.location ? ` · ${next.location}` : ""}` : `${data?.place || "your area"} · ${clockOf(nowIso, tz)} — the day is clear.`}</p></div><div className="pc-live"><i /> {loading ? "SYNCING" : "LIVE"}</div></section>
    <div className="pc-stats"><Stat label="Open tasks" value={counts.openTasks ?? 0} note="to do" tone="cyan" /><Stat label="Top of mind" value={top.length} note="need you today" tone="amber" /><Stat label="Waiting on others" value={counts.waitingOnThem ?? 0} note="delegated / replies" tone="violet" /><Stat label="Reminders set" value={counts.pendingReminders ?? 0} note="will fire on time" tone="green" /></div>
    <div className="pc-profile-grid">
      <section className="pc-panel pc-span"><header><div><span>Top of mind</span><strong>{top.length ? `${top.length} for today` : "All clear"}</strong></div><small>due today or high priority</small></header>
        {top.length ? <div className="pc-coverage">{top.map((t) => <article key={t.id}><b>{"!".repeat(Math.max(1, t.priority || 1))}</b><span>{t.title}</span><p>{t.dueAt ? `Due ${clockOf(t.dueAt, tz)}` : "No due time"}{t.waitingOn === "them" && t.actor ? ` · waiting on ${t.actor}` : ""}</p></article>)}</div>
          : <p style={{ opacity: 0.6, padding: "6px 2px" }}>Nothing urgent is due today. Add a task and it will show here.</p>}
        <div className="pc-actions"><button onClick={() => command("Plan my day from my ATLAS tasks, calendar and top-of-mind. Give a realistic order, protect focus time, and flag anything at risk. Do not invent items.")}>Plan my day</button><button onClick={() => command("What am I forgetting today? Check my open tasks, reminders and what I'm waiting on others for. Be concise and honest.")}>What am I forgetting?</button></div>
      </section>
      <section className="pc-panel"><header><div><span>Timeline</span><strong>{timeline.length} today</strong></div><small>{data?.place || ""}</small></header>
        {timeline.length ? <div className="today-timeline">{timeline.map((e) => <article key={e.id} className={now && e.id === now.id ? "is-now" : ""}><i>{clockOf(e.startAt, tz)}</i><div><strong>{e.title}</strong><small>{e.location || e.kind}{e.endAt ? ` · until ${clockOf(e.endAt, tz)}` : ""}</small></div></article>)}</div>
          : <p style={{ opacity: 0.6, padding: "6px 2px" }}>No events today.</p>}
      </section>
      <section className="pc-panel"><header><div><span>Waiting on others</span><strong>{waiting.length}</strong></div><small>delegated / expected replies</small></header>
        {waiting.length ? <div className="pc-coverage">{waiting.map((t) => <article key={t.id}><b>⧖</b><span>{t.title}</span><p>{t.actor ? `From ${t.actor}` : "Expected reply"}{t.dueAt ? ` · by ${clockOf(t.dueAt, tz)}` : ""}</p></article>)}</div>
          : <p style={{ opacity: 0.6, padding: "6px 2px" }}>You're not blocked on anyone right now.</p>}
      </section>
    </div>
  </div>;
}

export function WeatherCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const current = data?.current || {};
  const days: any[] = data?.days || [];
  const today = days[0] || {};
  const range = Number(today.hi || current.temp || 0) - Number(today.lo || current.temp || 0);
  const maxPrecip = Math.max(0, ...days.map((day) => Number(day.precip || 0)));
  const heat = Math.max(0, ...days.map((day) => Number(day.hi || 0)));
  return <div className="pc-center weather-command">
    <section className="pc-weather-hero"><div><span>LOCAL ENVIRONMENT</span><h2>{data?.place || "Weather unavailable"}</h2><p>{data?.available ? `${current.label}. Feels like ${current.feels}°. Live local conditions with four-day planning signals.` : "No verified weather response is available."}</p></div><div className="pc-temp"><i>{current.icon || "·"}</i><strong>{current.temp ?? "—"}°</strong><small>{loading ? "UPDATING" : "CURRENT"}</small></div></section>
    <div className="pc-stats"><Stat label="Feels like" value={`${current.feels ?? "—"}°`} note={current.label || "condition unknown"} /><Stat label="Humidity" value={`${current.humidity ?? "—"}%`} note={Number(current.humidity) >= 70 ? "humid" : "moderate"} tone="violet" /><Stat label="Wind" value={`${current.wind ?? "—"} mph`} note="reported speed" tone="green" /><Stat label="Today range" value={`${today.lo ?? "—"}–${today.hi ?? "—"}°`} note={`${range || 0}° swing`} tone="amber" /></div>
    <div className="pc-weather-grid"><section className="pc-panel pc-forecast"><header><div><span>Four-day trajectory</span><strong>{days.length} verified days</strong></div><small>forecast</small></header><div className="pc-days">{days.map((day, index) => <article key={day.date}><span>{index === 0 ? "Today" : new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</span><i>{day.icon}</i><strong>{day.hi}°</strong><small>{day.lo}° low</small><div><b style={{ width: `${Math.max(3, Number(day.precip || 0))}%` }} /></div><em>{day.precip}% rain</em></article>)}</div></section><section className="pc-panel"><header><div><span>Planning signals</span><strong>Decision support</strong></div></header>{data?.available ? <div className="pc-signals"><article data-level={heat >= 95 ? "warn" : "ok"}><i>H</i><div><strong>{heat >= 95 ? "Heat risk" : "Heat manageable"}</strong><p>Forecast peak is {heat || "unknown"}°. {heat >= 95 ? "Move strenuous outdoor work to cooler hours." : "No extreme heat threshold appears in this feed."}</p></div></article><article data-level={maxPrecip >= 50 ? "warn" : "ok"}><i>R</i><div><strong>{maxPrecip >= 50 ? "Rain likely" : "Low rain signal"}</strong><p>Highest listed precipitation probability is {maxPrecip}%.</p></div></article><article data-level={range >= 20 ? "warn" : "ok"}><i>Δ</i><div><strong>{range >= 20 ? "Large temperature swing" : "Stable daily range"}</strong><p>Today spans {range || 0}° between forecast low and high.</p></div></article></div> : <div className="pc-signals"><article data-level="warn"><i>!</i><div><strong>Forecast evidence unavailable</strong><p>{data?.error || "The weather provider has not returned verified current conditions. No heat, rain, or range conclusion is being inferred."}</p></div></article></div>}<div className="pc-actions"><button onClick={() => command(data?.available ? `Using the live weather for ${data?.place || "my verified home"}, make a concise plan for today. Cover clothing, outdoor timing, rain/heat risk, and any forecast uncertainty.` : "The Weather widget provider is unavailable. Diagnose the failure, retrieve current Boston weather from a verified source if available, cite it, and do not use the empty widget values.")}>{data?.available ? "Plan my day" : "Recover forecast"}</button><button onClick={() => command(`Explain the four-day weather trend for ${data?.place || "my location"} and highlight only meaningful changes or risks.`)} disabled={!data?.available}>Explain trend</button></div></section></div>
  </div>;
}

export function VitalsCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const memory = data?.memory || {};
  const jarvis = data?.jarvis || {};
  const pressure = Number(memory.pct || 0);
  const state = !data?.available ? "offline" : pressure >= 90 ? "critical" : pressure >= 80 ? "pressure" : "nominal";
  const heapRatio = jarvis.rssMB ? Math.round(Number(jarvis.heapMB || 0) / Number(jarvis.rssMB) * 100) : 0;
  return <div className="pc-center vitals-command">
    <section className="pc-hero"><div className={`pc-pulse pc-${state}`}><i /><b /></div><div><span>SYSTEM OBSERVABILITY</span><h2>{data?.host || "Host unavailable"}</h2><p>{data?.platform || "JARVIS cannot currently read host telemetry."}</p></div><div className={`pc-health pc-${state}`}>{loading ? "SYNCING" : state.toUpperCase()}</div></section>
    <div className="pc-stats"><Stat label="Host uptime" value={duration(Number(data?.uptimeSec || 0))} note="operating system" tone="green" /><Stat label="Memory pressure" value={`${pressure || 0}%`} note={`${memory.usedGB || 0} / ${memory.totalGB || 0} GB`} tone={pressure >= 80 ? "amber" : "cyan"} /><Stat label="JARVIS resident" value={`${jarvis.rssMB || 0} MB`} note={`${jarvis.heapMB || 0} MB heap`} tone="violet" /><Stat label="Runtime uptime" value={duration(Number(jarvis.uptimeSec || 0))} note="backend process" /></div>
    <div className="pc-vitals-grid"><section className="pc-panel"><header><div><span>Resource telemetry</span><strong>Host + process</strong></div><small>{loading ? "refreshing" : "live"}</small></header><div className="pc-gauges"><article><div style={{ "--gauge": `${pressure * 3.6}deg` } as React.CSSProperties}><strong>{pressure}%</strong><span>RAM</span></div><p>{pressure >= 90 ? "Critical pressure: reclaim memory before heavy research or local inference." : pressure >= 80 ? "Elevated pressure: concurrent heavy rooms may compete for memory." : "Memory headroom is currently comfortable."}</p></article><article><div style={{ "--gauge": `${Math.min(360, heapRatio * 3.6)}deg` } as React.CSSProperties}><strong>{heapRatio}%</strong><span>HEAP/RSS</span></div><p>JavaScript heap is {jarvis.heapMB || 0} MB of the {jarvis.rssMB || 0} MB resident process footprint.</p></article></div></section>
      <section className="pc-panel"><header><div><span>Compute identity</span><strong>{data?.cpu?.cores || 0} logical cores</strong></div></header><div className="pc-key-grid"><div className="pc-wide"><span>Processor</span><strong>{data?.cpu?.model || "unavailable"}</strong></div><div><span>Load average</span><strong>{data?.cpu?.load1 ? data.cpu.load1 : "not supplied"}</strong></div><div><span>Telemetry note</span><strong>{String(data?.platform || "").startsWith("Windows") ? "Windows does not expose Unix load1" : "one-minute load"}</strong></div><div><span>JARVIS heap</span><strong>{jarvis.heapMB || 0} MB</strong></div><div><span>JARVIS RSS</span><strong>{jarvis.rssMB || 0} MB</strong></div></div><div className="pc-actions"><button onClick={() => command("Assess the live system vitals for JARVIS. Explain memory pressure, process footprint, uptime, missing telemetry, and whether I should take action. Do not claim CPU health from a Windows load average of zero.")}>Diagnose system</button><button onClick={() => command("Create a safe performance runbook for this JARVIS host based on current vitals. Prioritize read-only checks and ask before stopping any process.")}>Build runbook</button></div></section></div>
  </div>;
}
