import { useCallback, useEffect, useMemo, useState } from "react";
import { api, post } from "../api";
import "./ContactsCommandCenter.css";

// The address book.
//
// Rewritten after the first attempt spent 400px of a 700px window on a hero restating the window
// title, four metric tiles reading "1 / 0 / 1 / 0", and a coloured banner — with the list of people
// scrolling in what was left. The window frame already reports the title and the count. Content
// starts 34px in now.
//
// Colour was doing work that hierarchy should do: a magenta panel accent plus a different neon per
// channel. Channels are labelled in monospace instead; the single accent marks selection and
// nothing else.
//
// Two things this surface must not do, both of which the store already refuses: invent a person,
// and hide a failure. A rejected save reports the store's own sentence, because that sentence is
// the useful part.

interface ChannelMeta { key: string; label: string; kind: string; icon: string; color: string; placeholder: string }
interface Contact {
  id: string; name: string; aliases?: string[]; notes?: string; tags?: string[]; pinned?: boolean;
  hasAvatar?: boolean; createdAt?: string; updatedAt?: string; lastUsedAt?: string | null;
  channels?: Record<string, { handle?: string; address?: string; link?: string; threadUrl?: string; avatarUrl?: string }>;
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

// Derived from the name so two people are never identical, but desaturated to near-graphite — the
// previous version's saturated hues turned a contact list into a colour chart.
function Face({ contact, size }: { contact: Contact; size: number }) {
  const [broken, setBroken] = useState(false);
  let hash = 0;
  const name = contact.name || "?";
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 360;
  // Cache-busted on update, or a refreshed photo never appears and the button looks inert.
  const src = `/api/contacts/${contact.id}/avatar?v=${encodeURIComponent(contact.updatedAt || "")}`;
  const showImage = contact.hasAvatar && !broken;
  return (
    <span
      className="cc-face"
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.42),
        background: showImage ? undefined : `hsl(${hash} 20% 24%)`,
        color: `hsl(${hash} 30% 74%)`,
      }}
    >
      {showImage ? <img src={src} alt="" onError={() => setBroken(true)} /> : <b>{name.trim().charAt(0).toUpperCase()}</b>}
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
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

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
  const metaFor = (key: string) => meta.find((channel) => channel.key === key);

  function openEditor(mode: "new" | "edit", contact?: Contact) {
    setNote(null);
    setConfirming(false);
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
    if (!form.name.trim()) { setNote({ tone: "error", text: "A contact needs a name." }); return; }
    setBusy(true); setNote(null);
    // Every channel is sent: a value to set it, an explicit null to clear one that was emptied.
    // Omitting an emptied field would keep the old value and the edit would look like it worked.
    const channels: Record<string, unknown> = {};
    for (const channel of meta) {
      const value = (values[channel.key] || "").trim();
      const had = Boolean(editing === "edit" && selected?.channels?.[channel.key]);
      if (value) channels[channel.key] = { handle: value };
      else if (had) channels[channel.key] = null;
    }
    try {
      const result = await post<{ contact: Contact }>("/api/contacts", {
        id: editing === "edit" ? selected?.id : undefined,
        name: form.name,
        aliases: form.aliases.split(",").map((item) => item.trim()).filter(Boolean),
        replaceAliases: true,
        notes: form.notes,
        tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
        pinned: form.pinned,
        channels,
      });
      await reload();
      setSelectedId(result.contact.id);
      setEditing(null);
      setNote({ tone: "ok", text: `Saved ${result.contact.name}.` });
    } catch (error) {
      setNote({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true); setNote(null);
    try {
      await api(`/api/contacts/${selected.id}`, { method: "DELETE" });
      await reload();
      setSelectedId(""); setConfirming(false);
      setNote({ tone: "ok", text: `Removed ${selected.name}.` });
    } catch (error) {
      setNote({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }

  async function fetchFace() {
    if (!selected) return;
    setBusy(true); setNote(null);
    try {
      await post(`/api/contacts/${selected.id}/avatar`, {});
      await reload();
      setNote({ tone: "ok", text: "Photo cached." });
    } catch (error) {
      setNote({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }

  const channelEntries = Object.entries(selected?.channels || {});

  return <div className="cc">
    <div className="cc-tools">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, alias, handle, tag" aria-label="Search contacts" />
      <span className="cc-count">{loading && !contacts.length ? "loading" : `${visible.length}${query ? `/${contacts.length}` : ""}`}</span>
      <button className="cc-act" onClick={() => openEditor("new")}>New</button>
    </div>

    {note ? <div className="cc-note-bar" data-tone={note.tone}>{note.text}</div> : null}

    <div className="cc-panes">
      <div className="cc-side">
        {visible.length === 0 ? (
          <div className="cc-blank">
            <b>{contacts.length ? "No match" : "No contacts yet"}</b>
            {contacts.length ? "Try a handle or an alias." : "Add someone, or let Jarvis ask next time it cannot tell two people apart."}
          </div>
        ) : visible.map((contact) => {
          const count = Object.keys(contact.channels || {}).length;
          return (
            <button
              key={contact.id}
              className="cc-row"
              data-selected={selected?.id === contact.id}
              onClick={() => { setSelectedId(contact.id); setEditing(null); setConfirming(false); }}
            >
              <Face contact={contact} size={22} />
              <span>
                <b>{contact.name}{contact.pinned ? <i className="cc-pin"> ●</i> : null}</b>
                <s>{(contact.aliases || []).join(", ") || Object.keys(contact.channels || {}).map((key) => metaFor(key)?.label || key).join(", ") || "no channels"}</s>
              </span>
              <em>{count || ""}</em>
            </button>
          );
        })}
      </div>

      <div className="cc-main">
        {editing ? (
          <div className="cc-form">
            <div className="cc-legend">Identity</div>
            <div className="cc-in" data-filled={Boolean(form.name)}>
              <label htmlFor="cc-name">Name</label>
              <input id="cc-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="their name" autoFocus />
            </div>
            <div className="cc-in" data-filled={Boolean(form.aliases)}>
              <label htmlFor="cc-alias">Also</label>
              <input id="cc-alias" value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="tg, roomie" />
            </div>
            <div className="cc-in" data-filled={Boolean(form.tags)}>
              <label htmlFor="cc-tags">Tags</label>
              <input id="cc-tags" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="family, work" />
            </div>

            <div className="cc-legend">Channels</div>
            {meta.map((channel) => (
              <div className="cc-in" key={channel.key} data-channel={channel.key} data-filled={Boolean(values[channel.key])}>
                <label htmlFor={`cc-${channel.key}`}>{channel.label}</label>
                <input
                  id={`cc-${channel.key}`}
                  value={values[channel.key] || ""}
                  onChange={(event) => setValues({ ...values, [channel.key]: event.target.value })}
                  placeholder={channel.placeholder}
                />
              </div>
            ))}

            <div className="cc-legend">Notes</div>
            <div className="cc-in" data-filled={Boolean(form.notes)}>
              <label htmlFor="cc-notes">Notes</label>
              <textarea id="cc-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="anything worth remembering" />
            </div>

            <label className="cc-check">
              <input type="checkbox" checked={form.pinned} onChange={(event) => setForm({ ...form, pinned: event.target.checked })} />
              Pin to top
            </label>

            <div className="cc-save">
              <button className="cc-act" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              <button className="cc-act" onClick={() => { setEditing(null); setNote(null); }} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : selected ? (
          <>
            <div className="cc-head">
              <Face contact={selected} size={34} />
              <div>
                <h3>{selected.name}</h3>
                <p>{(selected.aliases || []).join(", ") || "no other names"}</p>
              </div>
              <nav>
                <button className="cc-act" onClick={() => openEditor("edit", selected)}>Edit</button>
                <button className="cc-act" onClick={() => void fetchFace()} disabled={busy}>{selected.hasAvatar ? "Refresh photo" : "Photo"}</button>
                {confirming ? (
                  <>
                    <button className="cc-act" data-danger="true" onClick={() => void remove()} disabled={busy}>Delete {selected.name}</button>
                    <button className="cc-act" onClick={() => setConfirming(false)}>Keep</button>
                  </>
                ) : <button className="cc-act" data-danger="true" onClick={() => setConfirming(true)}>Delete</button>}
              </nav>
            </div>

            <div className="cc-rows">
              {channelEntries.length === 0
                ? <div className="cc-blank"><b>No channels</b>Edit to add a handle, number or address.</div>
                : channelEntries.map(([key, account]) => {
                  const value = account.handle || account.address || "";
                  return (
                    <div className="cc-def" key={key}>
                      <span>{metaFor(key)?.label || key}</span>
                      <code>{value || "—"}</code>
                      <nav>
                        {value ? <button className="cc-act" onClick={() => void navigator.clipboard?.writeText(value)}>Copy</button> : null}
                        {account.link ? <a className="cc-act" href={account.link} target="_blank" rel="noreferrer noopener">Open</a> : null}
                      </nav>
                    </div>
                  );
                })}
            </div>

            {selected.notes ? <div className="cc-sub"><span>Notes</span><p>{selected.notes}</p></div> : null}
            {(selected.tags || []).length ? <div className="cc-sub"><span>Tags</span><div className="cc-tags">{(selected.tags || []).map((tag) => <code key={tag}>{tag}</code>)}</div></div> : null}

            <div className="cc-foot">
              added {ago(selected.createdAt)} · updated {ago(selected.updatedAt)} · used {ago(selected.lastUsedAt)}
              {channelEntries.some(([, account]) => account.threadUrl) ? " · conversation known" : ""}
            </div>
          </>
        ) : (
          <div className="cc-blank"><b>Nobody selected</b>Pick someone on the left, or add the first contact.</div>
        )}
      </div>
    </div>
  </div>;
}
