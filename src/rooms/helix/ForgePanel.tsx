import React, { useEffect, useRef, useState, useMemo } from "react";
import gsap from "gsap";
import {
  ForgeDocument,
  ForgeBlock,
  ForgeMode,
  BlockType,
  BlockSource,
  ArtificerMessage,
  HelixEntry,
  VaultEntry,
  Strand,
  STRAND_META,
} from "./helix-types";

const FORGE_MODES: ForgeMode[] = ["document", "notes", "research", "spatial", "model"];
const FORGE_MODE_LABELS: Record<ForgeMode, { short: string; icon: string }> = {
  document: { short: "Doc", icon: "📄" },
  notes:    { short: "Notes", icon: "✏" },
  research: { short: "Research", icon: "🔍" },
  spatial:  { short: "Spatial", icon: "⬡" },
  model:    { short: "Model", icon: "◈" },
};
const BLOCK_SOURCE_COLORS: Record<BlockSource, string> = {
  manual: "rgba(255,255,255,0.18)", ai: "#ffe14a", pulled: "#4a9eff", synthesized: "#4afff0",
};
const BLOCK_TYPE_ICONS: Record<string, string> = {
  heading: "H", paragraph: "¶", list: "≡", quote: '"', code: "{}", insight: "💡", claim: "◈", scenario: "⑂", "spatial-note": "⬡",
};
const ARTIFICER_PRESETS = [
  "Outline this document",
  "Find supporting evidence for the key claims",
  "Write an executive summary",
  "What's missing or underdeveloped?",
  "Identify assumptions and gaps",
  "Suggest next research questions",
];

function ForgeBlockEditor({ block, active, isFirst, isLast, onFocus, onChange, onDelete, onAddBelow, onMoveUp, onMoveDown, onDuplicate }: {
  block: ForgeBlock;
  active: boolean;
  isFirst: boolean;
  isLast: boolean;
  onFocus: () => void;
  onChange: (c: string) => void;
  onDelete: () => void;
  onAddBelow: (type?: BlockType) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
}) {
  const color = block.strand ? STRAND_META[block.strand]?.color : undefined;
  const sourceColor = BLOCK_SOURCE_COLORS[block.source_type];

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, opts?: { heading?: boolean }) {
    if (e.key === "Enter" && (opts?.heading || e.shiftKey === false && block.type === "heading")) {
      e.preventDefault();
      onAddBelow("paragraph");
      return;
    }
    if (e.key === "Backspace" && (e.target as HTMLTextAreaElement).value === "") {
      e.preventDefault();
      onDelete();
      return;
    }
    if (e.key === "ArrowUp" && e.altKey) { e.preventDefault(); onMoveUp(); return; }
    if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); onMoveDown(); return; }
    if (e.key === "d" && e.ctrlKey) { e.preventDefault(); onDuplicate(); return; }
  }

  const sharedProps = {
    onFocus,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
  };

  return (
    <div
      data-block-id={block.id}
      className={`forge-block forge-block--${block.type}${active ? " forge-block--active" : ""}`}
      style={{ "--source-color": sourceColor } as React.CSSProperties}
      onClick={onFocus}>
      {/* Source strip */}
      <div className="forge-block-source-bar" style={{ background: sourceColor }}
        title={`Source: ${block.source_type}${block.strand ? ` · ${block.strand}` : ""}${block.confidence < 1 ? ` · ${Math.round(block.confidence * 100)}%` : ""}`} />

      {/* Block content */}
      {block.type === "heading" && (
        <textarea className="forge-block-input forge-block-heading" value={block.content}
          placeholder="Heading…" rows={1}
          {...sharedProps}
          onKeyDown={e => handleKeyDown(e, { heading: true })} />
      )}
      {block.type === "paragraph" && (
        <textarea className="forge-block-input forge-block-paragraph" value={block.content}
          placeholder="Write something… (Shift+Enter for line break, Enter to add block)"
          {...sharedProps} rows={3}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAddBelow("paragraph"); return; }
            handleKeyDown(e);
          }} />
      )}
      {block.type === "list" && (
        <textarea className="forge-block-input forge-block-list" value={block.content}
          placeholder={"• Item one\n• Item two\n• Item three"}
          {...sharedProps} rows={4} onKeyDown={handleKeyDown} />
      )}
      {block.type === "quote" && (
        <div className="forge-block-quote" style={{ borderLeftColor: color ?? "#4a9eff" }}>
          <textarea className="forge-block-input" value={block.content}
            placeholder="Quoted content…" {...sharedProps} rows={3} onKeyDown={handleKeyDown} />
          <div className="forge-block-cite">
            {block.strand && <span style={{ color }}>{STRAND_META[block.strand]?.label}</span>}
            <span className="forge-block-cite-source">{block.source_type}</span>
            {block.confidence < 1 && <span className="forge-block-cite-conf">{Math.round(block.confidence * 100)}%</span>}
          </div>
        </div>
      )}
      {block.type === "code" && (
        <div className="forge-block-code-wrap">
          <textarea className="forge-block-input forge-block-code" value={block.content}
            placeholder="// code here…" {...sharedProps} rows={6} onKeyDown={handleKeyDown} />
        </div>
      )}
      {block.type === "insight" && (
        <div className="forge-block-insight">
          <span className="forge-block-insight-icon">💡</span>
          <textarea className="forge-block-input" value={block.content}
            placeholder="Key insight…" {...sharedProps} rows={2} onKeyDown={handleKeyDown} />
        </div>
      )}
      {(block.type === "claim" || block.type === "scenario") && (
        <div className="forge-block-insight" style={{ "--insight-icon-color": block.type === "claim" ? "#4afff0" : "#9e4aff" } as React.CSSProperties}>
          <span className="forge-block-insight-icon">{block.type === "claim" ? "◈" : "⑂"}</span>
          <textarea className="forge-block-input" value={block.content}
            placeholder={`${block.type === "claim" ? "Claim" : "Scenario"}…`}
            {...sharedProps} rows={2} onKeyDown={handleKeyDown} />
        </div>
      )}

      {/* Block type badge */}
      <span className="forge-block-type-badge">{BLOCK_TYPE_ICONS[block.type] ?? block.type}</span>

      {/* Actions (visible on hover/active) */}
      <div className="forge-block-actions">
        {!isFirst && (
          <button className="forge-block-action forge-block-move" onClick={e => { e.stopPropagation(); onMoveUp(); }} title="Move up (Alt+↑)">↑</button>
        )}
        {!isLast && (
          <button className="forge-block-action forge-block-move" onClick={e => { e.stopPropagation(); onMoveDown(); }} title="Move down (Alt+↓)">↓</button>
        )}
        <button className="forge-block-action forge-block-dup" onClick={e => { e.stopPropagation(); onDuplicate(); }} title="Duplicate (Ctrl+D)">⎘</button>
        <button className="forge-block-action" onClick={e => { e.stopPropagation(); onAddBelow(); }} title="Add block below">+</button>
        <button className="forge-block-action forge-block-delete" onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete block">×</button>
      </div>
    </div>
  );
}

export function ForgePanel({
  doc, docs, blocks, saving, wordCount, lastSaved, focusMode, intelSearch,
  artificerMessages, artificerInput, artificerLoading, artificerActive,
  rail, relevant, entries, vault, activeBlockId,
  onSelectDoc, onNewDoc, onDeleteDoc, onUpdateTitle, onSwitchMode, onUpdateBlock, onAddBlock,
  onRemoveBlock, onMoveBlock, onDuplicateBlock, onPullEntry, onInsertArtificerBlock,
  onArtificerInput, onArtificerSubmit, onToggleArtificerActive,
  onSetRail, onLoadRelevant, onExport, onSetActiveBlock,
  onFocusMode, onIntelSearch, onClose,
}: {
  doc: ForgeDocument | null;
  docs: ForgeDocument[];
  blocks: ForgeBlock[];
  saving: boolean;
  wordCount: number;
  lastSaved: Date | null;
  focusMode: boolean;
  intelSearch: string;
  artificerMessages: ArtificerMessage[];
  artificerInput: string;
  artificerLoading: boolean;
  artificerActive: boolean;
  rail: "outline" | "artificer";
  relevant: HelixEntry[];
  entries: HelixEntry[];
  vault: VaultEntry[];
  activeBlockId: string | null;
  onSelectDoc: (d: ForgeDocument) => void;
  onNewDoc: () => void;
  onDeleteDoc: (id: string) => void;
  onUpdateTitle: (t: string) => void;
  onSwitchMode: (m: ForgeMode) => void;
  onUpdateBlock: (id: string, content: string) => void;
  onAddBlock: (type: BlockType, content?: string, sourceType?: BlockSource, sourceId?: string | null, strand?: Strand | null, conf?: number) => void;
  onRemoveBlock: (id: string) => void;
  onMoveBlock: (id: string, dir: "up" | "down") => void;
  onDuplicateBlock: (id: string) => void;
  onPullEntry: (e: HelixEntry) => void;
  onInsertArtificerBlock: (content: string) => void;
  onArtificerInput: (v: string) => void;
  onArtificerSubmit: (m: string) => void;
  onToggleArtificerActive: () => void;
  onSetRail: (r: "outline" | "artificer") => void;
  onLoadRelevant: () => void;
  onExport: () => void;
  onSetActiveBlock: (id: string | null) => void;
  onFocusMode: () => void;
  onIntelSearch: (q: string) => void;
  onClose: () => void;
}) {
  const [titleEdit, setTitleEdit] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [intelTab, setIntelTab] = useState<"relevant" | "evidence" | "vault">("relevant");
  const artificerEndRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => { artificerEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [artificerMessages.length]);

  useEffect(() => {
    if (overlayRef.current) {
      gsap.fromTo(overlayRef.current, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
    }
  }, []);

  function startTitleEdit() {
    setTitleDraft(doc?.title ?? "Untitled");
    setTitleEdit(true);
    setTimeout(() => titleInputRef.current?.select(), 30);
  }

  function commitTitle() {
    setTitleEdit(false);
    if (titleDraft.trim() && titleDraft !== doc?.title) onUpdateTitle(titleDraft.trim());
  }

  // Filter intel entries by search query
  const rawIntelEntries = intelTab === "relevant" ? relevant : entries.slice(-80);
  const intelEntries = intelSearch.trim()
    ? rawIntelEntries.filter(e => e.query.toLowerCase().includes(intelSearch.toLowerCase()) || e.text.toLowerCase().includes(intelSearch.toLowerCase()))
    : rawIntelEntries;
  const filteredVault = intelSearch.trim()
    ? vault.filter(v => (v.summary || v.query).toLowerCase().includes(intelSearch.toLowerCase()))
    : vault;

  // Format last saved time
  function fmtSaved(d: Date) {
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 5) return "just now";
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  }

  // Outline: headings only
  const outline = blocks.filter(b => b.type === "heading");

  // Scroll block into view when activated via outline
  function focusBlock(id: string) {
    onSetActiveBlock(id);
    setTimeout(() => {
      const el = bodyRef.current?.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <div ref={overlayRef} className={`forge-overlay${focusMode ? " forge-overlay--focus" : ""}`}>
      {/* Intelligence Rail */}
      {!focusMode && (
        <aside className="forge-rail forge-rail--left">
          <div className="forge-rail-tabs">
            <button className={`forge-rail-tab${intelTab === "relevant" ? " active" : ""}`}
              onClick={() => { setIntelTab("relevant"); onLoadRelevant(); }}>
              Relevant
            </button>
            <button className={`forge-rail-tab${intelTab === "evidence" ? " active" : ""}`}
              onClick={() => setIntelTab("evidence")}>
              Evidence
            </button>
            <button className={`forge-rail-tab${intelTab === "vault" ? " active" : ""}`}
              onClick={() => setIntelTab("vault")}>
              Vault
            </button>
          </div>
          <div className="forge-intel-search-wrap">
            <input
              className="forge-intel-search"
              placeholder="Search…"
              value={intelSearch}
              onChange={e => onIntelSearch(e.target.value)}
            />
          </div>
          <div className="forge-rail-body">
            {intelTab === "vault"
              ? filteredVault.map(v => (
                <div key={v.id} className="forge-intel-card forge-intel-card--vault" draggable
                  title="Drag to pull into document"
                  onClick={() => onAddBlock("quote", v.summary || v.query, "pulled", v.id, v.strand, 1.0)}
                  onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ type: "vault", id: v.id, content: v.summary || v.query, strand: v.strand }))}>
                  <span className="forge-intel-strand" style={{ color: STRAND_META[v.strand]?.color }}>⚿</span>
                  <span className="forge-intel-text">{v.summary || v.query}</span>
                </div>
              ))
              : intelEntries.map(entry => (
                <div key={entry.id} className="forge-intel-card" draggable
                  title={`${entry.strand} · ${Math.round(entry.confidence * 100)}% confidence — click or drag to pull`}
                  onClick={() => onPullEntry(entry)}
                  onDragStart={e => e.dataTransfer.setData("text/plain", JSON.stringify({ type: "entry", id: entry.id, content: entry.text, strand: entry.strand, confidence: entry.confidence }))}>
                  <span className="forge-intel-strand" style={{ color: STRAND_META[entry.strand as Strand]?.color }}>
                    {STRAND_META[entry.strand as Strand]?.label.slice(0, 3) ?? "?"}
                  </span>
                  <span className="forge-intel-text">{entry.query}</span>
                </div>
              ))
            }
            {intelEntries.length === 0 && intelTab === "relevant" && !intelSearch && (
              <div className="forge-rail-empty">
                Open a document and click Relevant to surface matching entries.
              </div>
            )}
            {intelEntries.length === 0 && intelSearch && (
              <div className="forge-rail-empty">No matches for "{intelSearch}"</div>
            )}
          </div>
        </aside>
      )}

      {/* Main Forge Panel */}
      <div className="forge-panel">
        {/* Forge topbar */}
        <div className="forge-topbar">
          <div className="forge-doc-list">
            {docs.map(d => (
              <div key={d.id} className={`forge-doc-tab-wrap${doc?.id === d.id ? " active" : ""}`}>
                <button className={`forge-doc-tab${doc?.id === d.id ? " active" : ""}`}
                  onClick={() => onSelectDoc(d)}
                  title={d.title}>
                  {d.title.slice(0, 18)}{d.title.length > 18 ? "…" : ""}
                </button>
                {doc?.id === d.id && (
                  <button className="forge-doc-tab-close" onClick={e => { e.stopPropagation(); onDeleteDoc(d.id); }} title="Delete document">×</button>
                )}
              </div>
            ))}
            <button className="forge-doc-new" onClick={onNewDoc} title="New document (⌘N)">+</button>
          </div>
          {doc && (
            <div className="forge-doc-meta">
              {titleEdit
                ? <input ref={titleInputRef} className="forge-title-input" value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={e => { if (e.key === "Enter") commitTitle(); if (e.key === "Escape") setTitleEdit(false); }} />
                : <span className="forge-title" onClick={startTitleEdit} title="Click to rename">{doc.title}</span>
              }
              <div className="forge-mode-tabs">
                {FORGE_MODES.map(m => (
                  <button key={m}
                    className={`forge-mode-tab${doc.mode === m ? " active" : ""}`}
                    onClick={() => onSwitchMode(m)}
                    title={m}>
                    <span className="forge-mode-icon">{FORGE_MODE_LABELS[m].icon}</span>
                    <span className="forge-mode-label">{FORGE_MODE_LABELS[m].short}</span>
                  </button>
                ))}
              </div>
              <div className="forge-actions">
                <button className="forge-action-btn" onClick={onExport} title="Export as Markdown">↓ MD</button>
                <button className={`forge-action-btn forge-focus-btn${focusMode ? " active" : ""}`}
                  onClick={onFocusMode} title={focusMode ? "Exit focus mode" : "Focus mode — hide rails"}>
                  {focusMode ? "⊠" : "⊞"}
                </button>
                {saving && <span className="forge-saving">● saving</span>}
              </div>
            </div>
          )}
          <button className="forge-close" onClick={onClose} title="Close Forge (Esc)">×</button>
        </div>

        {/* Block editor */}
        <div className="forge-body" ref={bodyRef}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            try {
              const data = JSON.parse(e.dataTransfer.getData("text/plain")) as { type: string; id: string; content: string; strand?: string; confidence?: number };
              if (data.type === "entry" || data.type === "vault") {
                onAddBlock("quote", data.content, "pulled", data.id, data.strand as Strand | null ?? null, data.confidence ?? 1.0);
              }
            } catch { /**/ }
          }}>
          {!doc && (
            <div className="forge-empty">
              <div className="forge-empty-icon">⚒</div>
              <p>The Forge — your intelligence workspace</p>
              <p className="forge-empty-sub">Pull entries, write analyses, build artifacts — all in one place</p>
              <button className="forge-empty-btn" onClick={onNewDoc}>+ New Document</button>
            </div>
          )}
          {doc && blocks.length === 0 && (
            <div className="forge-empty">
              <div className="forge-empty-icon">✦</div>
              <p>Start writing or pull from Intelligence</p>
              <p className="forge-empty-sub">Drag entries from the left rail, or choose a block type below</p>
              <div className="forge-quick-blocks">
                {(["heading", "paragraph", "list", "code", "insight"] as BlockType[]).map(t => (
                  <button key={t} className="forge-quick-block-btn" onClick={() => onAddBlock(t)}>
                    <span>{BLOCK_TYPE_ICONS[t]}</span> {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {blocks.map((block, idx) => (
            <ForgeBlockEditor
              key={block.id}
              block={block}
              active={activeBlockId === block.id}
              isFirst={idx === 0}
              isLast={idx === blocks.length - 1}
              onFocus={() => onSetActiveBlock(block.id)}
              onChange={(c) => onUpdateBlock(block.id, c)}
              onDelete={() => onRemoveBlock(block.id)}
              onAddBelow={(type) => onAddBlock(type ?? "paragraph")}
              onMoveUp={() => onMoveBlock(block.id, "up")}
              onMoveDown={() => onMoveBlock(block.id, "down")}
              onDuplicate={() => onDuplicateBlock(block.id)}
            />
          ))}
        </div>

        {/* Add bar + status bar */}
        {doc && (
          <>
            <div className="forge-add-bar">
              <span className="forge-add-label">Add</span>
              {(["heading", "paragraph", "list", "quote", "code", "insight"] as BlockType[]).map(t => (
                <button key={t} className="forge-add-type-btn" onClick={() => onAddBlock(t)} title={`Add ${t} block`}>
                  <span className="forge-add-icon">{BLOCK_TYPE_ICONS[t]}</span>
                  <span className="forge-add-text">{t}</span>
                </button>
              ))}
            </div>
            <div className="forge-status-bar">
              <span className="forge-status-item">{blocks.length} block{blocks.length !== 1 ? "s" : ""}</span>
              <span className="forge-status-sep">·</span>
              <span className="forge-status-item">{wordCount} word{wordCount !== 1 ? "s" : ""}</span>
              <span className="forge-status-sep">·</span>
              <span className="forge-status-item">{readingTime} min read</span>
              <span className="forge-status-sep">·</span>
              <span className="forge-status-item forge-status-mode">{FORGE_MODE_LABELS[doc.mode].icon} {doc.mode}</span>
              {lastSaved && (
                <>
                  <span className="forge-status-sep">·</span>
                  <span className="forge-status-item forge-status-saved">✓ {fmtSaved(lastSaved)}</span>
                </>
              )}
              {saving && <span className="forge-status-item forge-status-saving">● saving</span>}
            </div>
          </>
        )}
      </div>

      {/* Artificer Rail */}
      {!focusMode && (
        <aside className="forge-rail forge-rail--right">
          <div className="forge-rail-tabs">
            <button className={`forge-rail-tab${rail === "artificer" ? " active" : ""}`} onClick={() => onSetRail("artificer")}>
              ⚙ Artificer
            </button>
            <button className={`forge-rail-tab${rail === "outline" ? " active" : ""}`} onClick={() => onSetRail("outline")}>
              Outline
            </button>
          </div>
          {rail === "artificer" && (
            <div className="forge-artificer">
              <div className="forge-artificer-messages">
                {artificerMessages.length === 0 && (
                  <div className="forge-artificer-intro">
                    <p className="forge-artificer-name">⚙ The Artificer</p>
                    <p className="forge-artificer-desc">Your AI co-author with full context of this document and your HELIX intelligence.</p>
                    <div className="forge-artificer-prompts">
                      {ARTIFICER_PRESETS.map(p => (
                        <button key={p} className="forge-artificer-prompt" onClick={() => onArtificerSubmit(p)}>{p}</button>
                      ))}
                    </div>
                  </div>
                )}
                {artificerMessages.map((m, i) => (
                  <div key={i} className={`forge-artificer-msg forge-artificer-msg--${m.role}`}>
                    {m.role === "assistant" && (
                      <div className="forge-artificer-msg-head">
                        <span className="forge-artificer-label">Artificer</span>
                        <button className="forge-artificer-insert" title="Insert as block"
                          onClick={() => onInsertArtificerBlock(m.content)}>
                          + Block
                        </button>
                      </div>
                    )}
                    {m.role === "user" && <span className="forge-artificer-label forge-artificer-label--user">You</span>}
                    <p>{m.content}</p>
                  </div>
                ))}
                {artificerLoading && (
                  <div className="forge-artificer-msg forge-artificer-msg--assistant">
                    <span className="forge-artificer-label">Artificer</span>
                    <p className="forge-artificer-thinking">thinking…</p>
                  </div>
                )}
                <div ref={artificerEndRef} />
              </div>
              <div className="forge-artificer-input-row">
                <textarea
                  className="forge-artificer-input"
                  placeholder="Ask The Artificer…"
                  value={artificerInput}
                  rows={2}
                  onChange={e => onArtificerInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onArtificerSubmit(artificerInput); } }}
                  disabled={artificerLoading}
                />
                <button className="forge-artificer-send" onClick={() => onArtificerSubmit(artificerInput)} disabled={!artificerInput.trim() || artificerLoading}>→</button>
              </div>
            </div>
          )}
          {rail === "outline" && (
            <div className="forge-outline">
              {outline.length === 0 && (
                <div className="forge-rail-empty">Add headings to auto-build an outline.</div>
              )}
              {outline.map((b, i) => (
                <div key={b.id} className="forge-outline-item" onClick={() => focusBlock(b.id)}>
                  <span className="forge-outline-num">{i + 1}</span>
                  {b.content || "(untitled heading)"}
                </div>
              ))}
              {blocks.length > 0 && (
                <div className="forge-outline-stats">
                  <span>{blocks.length} blocks · {wordCount} words</span>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
