import { useCallback, useEffect, useMemo, useState } from "react";
import { api, post } from "../api";
import "./ContactsCommandCenter.css";

// The address book.
//
// Before this there was one component in the whole app that touched contacts: a picker card that
// appeared when a name was ambiguous. Everything else — seeing who Jarvis knows, adding someone by
// hand, correcting a handle, deleting a person, filling in a channel other than Instagram — had a
// working API and no way to reach it.
//
// Two things it must not do, both of which the store already refuses and this surface must not undo:
// invent a person, and hide a failure. A save that the backend rejects reports the backend's own
// reason ("that is not an email address"), because that reason is the useful part.

interface ChannelMeta { key: string; label: string; kind: string; icon: string; color: string; placeholder: string }
interface Contact {
  id: string; name: string; aliases?: string[]; notes?: string; tags?: string[]; pinned?: boolean;
  hasAvatar?: boolean; channelCount?: number; createdAt?: string; updatedAt?: string; lastUsedAt?: string | null;
  channels?: Record<string, { handle?: string; address?: string; link?: string; profileUrl?: string; threadUrl?: string; avatarUrl?: string }>;
}

function ago(value?: string | null) {
  if (!value) return "never";
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta)) return "unknown";
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

// A colour that belongs to this person and no one else. Grey initials would repeat the exact
// failure this whole feature exists to fix — two entries that look identical.
function hueFor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 360;
  return hash;
}

function Face({ contact, size = 38 }: { contact: Contact; size?: number }) {
  const [broken, setBroken] = useState(false);
  const hue = hueFor(contact.name || "?");
  // Cache-busted on update so a refreshed photo is actually seen; without it the browser serves the
  // old face and the refresh button looks like it does nothing.
  const src = `/api/contacts/${contact.id}/avatar?v=${encodeURIComponent(contact.updatedAt || "")}`;
  const showImage = contact.hasAvatar && !broken;
  return (
    <span
      className="cc-face"
      style={{
        width: size, height: size, fontSize: size * 0.4,
        background: showImage ? undefined : `linear-gradient(150deg, hsl(${hue} 62% 30%), hsl(${(hue + 40) % 360} 58% 17%))`,
        color: `hsl(${hue} 85% 78%)`,
      }}
    >
      {showImage
        ? <img src={src} alt="" onError={() => setBroken(true)} />
        : <b>{(contact.name || "?").trim().charAt(0).toUpperCase()}</b>}
    </span>
  );
}

const BLANK = { name: "", aliases: "", notes: "", tags: "", pinned: false };

export function ContactsCommandCenter({ data, loading, onRefresh }: { data: any; loading: boolean; onRefresh?: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>(data?.contacts || []);
  const [meta, setMeta] = useState<ChannelMeta[]>(data?.channels || []);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<null | "new" | "edit">(null);
  const [form, setForm] = useState({ ...BLANK });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => { if (data?.contacts) setContacts(data.contacts); }, [data?.contacts]);
  useEffect(() => { if (data?.channels?.length) setMeta(data.channels); }, [data?.channels]);

  const reload = useCallback(async () => {
    const result = await api<{ contacts: Contact[] }>("/api/contacts").catch(() => null);
    if (result?.contacts) setContacts(result.contacts);
    onRefresh?.();
  }, [onRefresh]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = term
      ? contacts.filter((contact) => `${contact.name} ${(contact.aliases || []).join(" ")} ${(contact.tags || []).join(" ")} ${Object.values(contact.channels || {}).map((c) => c.handle || c.address || "").join(" ")}`.toLowerCase().includes(term))
      : contacts;
    return [...matched].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.name.localeCompare(b.name));
  }, [contacts, query]);

  const selected = visible.find((contact) => contact.id === selectedId) || visible[0] || null;
  const withFaces = contacts.filter((contact) => contact.hasAvatar).length;
  const links = contacts.reduce((total, contact) => total + Object.keys(contact.channels || {}).length, 0);

  function openEditor(mode: "new" | "edit", contact?: Contact) {
    setMessage(null);
    setConfirmingDelete(false);
    setEditing(mode);
    if (mode === "new" || !contact) { setForm({ ...BLANK }); setValues({}); return; }
    setForm({
      name: contact.name,
      aliases: (contact.aliases || []).join(", "),
      notes: contact.notes || "",
      tags: (contact.tags || []).join(", "),
      pinned: Boolean(contact.pinned),
    });
    const next: Record<string, string> = {};
    for (const [key, account] of Object.entries(contact.channels || {})) next[key] = account.handle || account.address || "";
    setValues(next);
  }

  async function save() {
    if (!form.name.trim()) { setMessage({ tone: "error", text: "A contact needs a name." }); return; }
    setBusy(true); setMessage(null);
    // Every channel is sent: a value to set it, an explicit null to remove one that was cleared.
    // Omitting a cleared field would silently keep the old value — the edit would appear to work.
    const channels: Record<string, unknown> = {};
    for (const channel of meta) {
      const value = (values[channel.key] || "").trim();
      const had = Boolean(editing === "edit" && selected?.channels?.[channel.key]);
      if (value) channels[channel.key] = { handle: value };
      else if (had) channels[channel.key] = null;
    }
    try {
      const body = {
        id: editing === "edit" ? selected?.id : undefined,
        name: form.name,
        aliases: form.aliases.split(",").map((item) => item.trim()).filter(Boolean),
        replaceAliases: true,
        notes: form.notes,
        tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
        pinned: form.pinned,
        channels,
      };
      const result = await post<{ contact: Contact }>("/api/contacts", body);
      await reload();
      setSelectedId(result.contact.id);
      setEditing(null);
      setMessage({ tone: "ok", text: `Saved ${result.contact.name}.` });
    } catch (error) {
      // The store's reason is the useful part — "that is not an email address" beats "save failed".
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true); setMessage(null);
    try {
      await api(`/api/contacts/${selected.id}`, { method: "DELETE" });
      await reload();
      setSelectedId("");
      setConfirmingDelete(false);
      setMessage({ tone: "ok", text: `Removed ${selected.name}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }

  async function fetchFace() {
    if (!selected) return;
    setBusy(true); setMessage(null);
    try {
      await post(`/api/contacts/${selected.id}/avatar`, {});
      await reload();
      setMessage({ tone: "ok", text: "Photo cached." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }

  const metaFor = (key: string) => meta.find((channel) => channel.key === key);

  return <div className="cc-center">
    <section className="cc-hero">
      <span className="cc-stack">
        {contacts.slice(0, 5).map((contact) => <Face key={contact.id} contact={contact} size={40} />)}
        {contacts.length === 0 ? <Face contact={{ id: "none", name: "?" }} size={40} /> : null}
      </span>
      <div>
        <span>ADDRESS BOOK</span>
        <h2>People Jarvis Knows</h2>
        <p>Names, handles and conversations, stored once so “message them” never has to guess again.</p>
      </div>
    </section>

    <div className="cc-metrics">
      <article className="cc-metric"><span>People</span><strong>{contacts.length}</strong></article>
      <article className="cc-metric"><span>With a face</span><strong>{withFaces}</strong></article>
      <article className="cc-metric"><span>Channels linked</span><strong>{links}</strong></article>
      <article className="cc-metric"><span>Pinned</span><strong>{contacts.filter((contact) => contact.pinned).length}</strong></article>
    </div>

    <div className="cc-bar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, alias, handle or tag…" aria-label="Search contacts" />
      <button className="cc-btn" onClick={() => openEditor("new")}>+ New contact</button>
    </div>

    {message ? <div className="cc-msg" data-tone={message.tone}>{message.text}</div> : null}

    <div className="cc-split">
      <section className="cc-panel">
        <header><span>Contacts</span><small>{loading ? "loading" : `${visible.length} shown`}</small></header>
        <div className="cc-list">
          {visible.length === 0 ? (
            <div className="cc-empty">
              <b>{contacts.length ? "Nobody matches that" : "No contacts yet"}</b>
              {contacts.length
                ? "Try a handle or an alias."
                : "Add someone, or let Jarvis ask next time it cannot tell two people apart."}
            </div>
          ) : visible.map((contact) => (
            <button
              key={contact.id}
              className="cc-row"
              data-selected={selected?.id === contact.id}
              onClick={() => { setSelectedId(contact.id); setEditing(null); setConfirmingDelete(false); }}
            >
              <Face contact={contact} />
              <span>
                <strong>{contact.name}{contact.pinned ? <i className="cc-pin"> ★</i> : null}</strong>
                <small>{(contact.aliases || []).join(", ") || Object.keys(contact.channels || {}).map((key) => metaFor(key)?.label || key).join(" · ") || "no channels yet"}</small>
              </span>
              <span className="cc-dots">
                {Object.keys(contact.channels || {}).slice(0, 6).map((key) => (
                  <i key={key} style={{ background: metaFor(key)?.color || "#48D8FF" }} title={metaFor(key)?.label || key} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="cc-panel">
        <header>
          <span>{editing === "new" ? "New contact" : editing === "edit" ? "Editing" : "Dossier"}</span>
          <small>{editing ? "unsaved" : selected ? `used ${ago(selected.lastUsedAt)}` : "—"}</small>
        </header>

        {editing ? (
          <div className="cc-body">
            <div className="cc-form">
              <label className="cc-field"><span>Name</span>
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Their name" autoFocus />
              </label>
              <div className="cc-two">
                <label className="cc-field"><span>Also called</span>
                  <input value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="tg, roomie" />
                </label>
                <label className="cc-field"><span>Tags</span>
                  <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="family, work" />
                </label>
              </div>

              <div className="cc-field">
                <span>Channels</span>
                {meta.map((channel) => (
                  <div className="cc-chan-edit" key={channel.key}>
                    <label htmlFor={`cc-${channel.key}`}>
                      <i style={{ color: channel.color }}>{channel.icon}</i>{channel.label}
                    </label>
                    <input
                      id={`cc-${channel.key}`}
                      value={values[channel.key] || ""}
                      onChange={(event) => setValues({ ...values, [channel.key]: event.target.value })}
                      placeholder={channel.placeholder}
                    />
                  </div>
                ))}
              </div>

              <label className="cc-field"><span>Notes</span>
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Anything worth remembering about them." />
              </label>

              <label className="cc-check">
                <input type="checkbox" checked={form.pinned} onChange={(event) => setForm({ ...form, pinned: event.target.checked })} />
                Pin to the top
              </label>

              <div className="cc-actions">
                <button className="cc-btn" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save contact"}</button>
                <button className="cc-btn" data-quiet="true" onClick={() => { setEditing(null); setMessage(null); }} disabled={busy}>Cancel</button>
              </div>
            </div>
          </div>
        ) : selected ? (
          <div className="cc-body">
            <div className="cc-id">
              <Face contact={selected} size={62} />
              <div>
                <h3>{selected.name}</h3>
                <p>{(selected.aliases || []).length ? `also “${(selected.aliases || []).join("”, “")}”` : "no other names recorded"}</p>
              </div>
            </div>

            <div className="cc-chan">
              {Object.keys(selected.channels || {}).length === 0 ? (
                <div className="cc-empty"><b>No channels yet</b>Edit this contact to add a handle, number or address.</div>
              ) : Object.entries(selected.channels || {}).map(([key, account]) => {
                const channel = metaFor(key);
                const value = account.handle || account.address || "";
                return (
                  <article key={key}>
                    <i style={{ color: channel?.color, background: `${channel?.color || "#48D8FF"}18` }}>{channel?.icon || "•"}</i>
                    <div>
                      <span>{channel?.label || key}{account.threadUrl ? " · conversation known" : ""}</span>
                      <code>{value || "—"}</code>
                    </div>
                    <nav>
                      {value ? <button onClick={() => void navigator.clipboard?.writeText(value)}>Copy</button> : null}
                      {account.link ? <a href={account.link} target="_blank" rel="noreferrer noopener">Open</a> : null}
                    </nav>
                  </article>
                );
              })}
            </div>

            {selected.notes ? <div className="cc-note"><span>Notes</span><p>{selected.notes}</p></div> : null}
            {(selected.tags || []).length ? <div className="cc-tags">{(selected.tags || []).map((tag) => <code key={tag}>{tag}</code>)}</div> : null}

            <div className="cc-meta">
              <div><span>Added</span><strong>{ago(selected.createdAt)}</strong></div>
              <div><span>Updated</span><strong>{ago(selected.updatedAt)}</strong></div>
              <div><span>Last used</span><strong>{ago(selected.lastUsedAt)}</strong></div>
            </div>

            <div className="cc-actions">
              <button className="cc-btn" onClick={() => openEditor("edit", selected)}>Edit</button>
              <button className="cc-btn" data-quiet="true" onClick={() => void fetchFace()} disabled={busy}>
                {selected.hasAvatar ? "Refresh photo" : "Fetch photo"}
              </button>
              {confirmingDelete ? (
                <>
                  <button className="cc-btn" data-danger="true" onClick={() => void remove()} disabled={busy}>Delete {selected.name}</button>
                  <button className="cc-btn" data-quiet="true" onClick={() => setConfirmingDelete(false)}>Keep</button>
                </>
              ) : (
                <button className="cc-btn" data-danger="true" onClick={() => setConfirmingDelete(true)}>Delete</button>
              )}
            </div>
          </div>
        ) : (
          <div className="cc-empty">
            <b>Nobody selected</b>
            Pick someone on the left, or add the first contact.
          </div>
        )}
      </section>
    </div>
  </div>;
}
