/* APEX Backtest Engine — stylesheet (cyan-glass, on the shared --ax-* tokens). */
export const BT_CSS = `
.ax-bte { height:100%; display:flex; flex-direction:column; gap:10px; min-height:0; padding:2px; overflow:hidden;
  font-family:var(--ax-sans,ui-sans-serif); color:var(--ax-tx,#e8f0f4);
  --pos:var(--ax-pos,#34d399); --neg:var(--ax-neg,#f43f5e); --pur:var(--ax-pur,#a98bff); --cy:var(--ax-acc,#22d3ee); }
.bte-scroll { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:11px; padding-right:3px; }
.ax-bte * { box-sizing:border-box; }
.ax-bte button { cursor:pointer; font-family:inherit; }

/* HEADER */
.bte-head { display:flex; align-items:center; gap:16px; flex-wrap:wrap; flex-shrink:0; }
.bte-titleblock { display:flex; flex-direction:column; gap:1px; }
.bte-title { font-family:var(--ax-disp,Oxanium); font-size:19px; font-weight:800; letter-spacing:.14em;
  background:linear-gradient(180deg,#eafaff,#7cc8ee); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.bte-sub { font-family:var(--ax-disp,Oxanium); font-size:8.5px; letter-spacing:.26em; color:var(--ax-mut,#8aa); }
.bte-subtabs { display:flex; gap:2px; overflow-x:auto; scrollbar-width:none; }
.bte-subtabs::-webkit-scrollbar { display:none; }
.bte-tab { position:relative; background:none; border:0; color:var(--ax-mut,#8aa); font-family:var(--ax-disp,Oxanium);
  font-size:11px; font-weight:600; letter-spacing:.02em; padding:8px 11px; white-space:nowrap; border-radius:6px; }
.bte-tab:hover { color:#eef5fc; }
.bte-tab.on { color:#eafaff; }
.bte-tab.on::after { content:""; position:absolute; left:8px; right:8px; bottom:2px; height:2px; border-radius:2px; background:var(--cy); box-shadow:0 0 8px var(--cy); }
.bte-tc { margin-left:5px; font-size:8.5px; padding:1px 5px; border-radius:8px; background:color-mix(in srgb,var(--cy) 16%,transparent); color:var(--cy); }
.bte-actions { margin-left:auto; display:flex; gap:6px; }
.bte-b { background:var(--ax-surface,#10151a); border:1px solid var(--ax-bdsoft,rgba(120,205,225,.1)); color:var(--ax-mut,#9ab);
  border-radius:8px; padding:7px 12px; font-size:11px; font-weight:600; }
.bte-b:hover:not(:disabled) { border-color:var(--ax-bdglow,rgba(34,211,238,.5)); color:var(--ax-tx); }
.bte-b:disabled { opacity:.4; cursor:default; }
.bte-b.deploy { background:linear-gradient(120deg,#1298c9,#22d3ee); border-color:transparent; color:#04121a; font-weight:800; }
.bte-b.sm { padding:6px 9px; font-size:10px; flex:1; }
.bte-b.live { background:color-mix(in srgb,var(--cy) 16%,transparent); border-color:var(--ax-bdglow); color:var(--cy); font-weight:800; }
.bte-b.live:hover:not(:disabled) { background:color-mix(in srgb,var(--cy) 26%,transparent); }

/* GRID */
.bte-grid { display:grid; grid-template-columns:300px minmax(0,1fr) 356px; gap:11px; align-items:start; }
.bte-left,.bte-center,.bte-right { min-height:0; display:flex; flex-direction:column; gap:11px; }
@media(max-width:1340px){ .bte-grid{ grid-template-columns:280px minmax(0,1fr); } .bte-right{ display:none; } }

/* PANEL SHELL */
.bte-pnl { background:linear-gradient(180deg,var(--ax-panelhi,rgba(17,25,36,.88)),var(--ax-panel,rgba(11,17,26,.8)));
  border:1px solid var(--ax-bd,rgba(120,205,225,.14)); border-radius:14px; padding:12px; position:relative;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 8px 22px rgba(0,0,0,.4); }
.bte-ph { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.bte-pt { font-family:var(--ax-disp,Oxanium); font-size:11px; font-weight:700; letter-spacing:.12em; color:#dbeaf6; }
.bte-count { margin-left:auto; font-size:9px; padding:1px 7px; border-radius:8px; background:var(--ax-surface); color:var(--ax-cydim,#5ec8e4); }

/* LEFT — library */
.bte-lib { flex:1; min-height:220px; display:flex; flex-direction:column; }
.bte-search { display:flex; align-items:center; gap:7px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:7px 10px; margin-bottom:8px; }
.bte-search span { color:var(--ax-mut); font-size:12px; }
.bte-search input { flex:1; background:none; border:0; outline:none; color:var(--ax-tx); font-size:12px; }
.bte-liblist { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:5px; min-height:0; max-height:320px; }
.bte-strat { text-align:left; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:9px 10px; display:flex; flex-direction:column; gap:5px; }
.bte-strat:hover { border-color:var(--ax-bd); }
.bte-strat.on { border-color:var(--ax-bdglow); box-shadow:0 0 0 1px var(--ax-bdglow),inset 0 0 20px rgba(34,211,238,.06); }
.bte-strat-top { display:flex; align-items:center; gap:7px; }
.bte-strat-ic { color:var(--cy); font-size:11px; }
.bte-strat-n { font-family:var(--ax-disp,Oxanium); font-size:12.5px; font-weight:700; color:#eaf3fb; flex:1; }
.bte-strat-star { color:var(--ax-warn,#f5a524); font-size:11px; }
.bte-strat-tags { display:flex; gap:4px; flex-wrap:wrap; }
.bte-tag { font-size:8.5px; padding:1.5px 6px; border-radius:6px; background:color-mix(in srgb,var(--cy) 12%,transparent); color:var(--cy); letter-spacing:.03em; }
.bte-lib-foot { display:flex; gap:6px; margin-top:8px; }

/* LEFT — config card */
.bte-cfgrows { display:flex; flex-direction:column; }
.bte-cfgrow { display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--ax-hair,rgba(120,205,225,.08)); }
.bte-cfgrow:last-child { border-bottom:0; }
.bte-cfgk { font-family:var(--ax-disp,Oxanium); font-size:9px; letter-spacing:.06em; text-transform:uppercase; color:var(--ax-mut); }
.bte-cfgv { font-family:var(--ax-mono,ui-monospace); font-size:11px; color:var(--ax-tx); font-variant-numeric:tabular-nums; }

/* CENTER — config bar */
.bte-configbar { display:flex; align-items:flex-end; gap:9px; flex-wrap:wrap; background:linear-gradient(180deg,var(--ax-panelhi),var(--ax-panel));
  border:1px solid var(--ax-bd); border-radius:12px; padding:9px 11px; flex-shrink:0; box-shadow:var(--ax-panel-glow,inset 0 1px 0 rgba(255,255,255,.05)); }
.bte-field { display:flex; flex-direction:column; gap:3px; }
.bte-field label { font-family:var(--ax-disp,Oxanium); font-size:8px; letter-spacing:.1em; text-transform:uppercase; color:var(--ax-mut); }
.bte-field select,.bte-field input { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-tx); border-radius:7px; padding:6px 8px; font-size:11.5px; font-family:var(--ax-mono,ui-monospace); outline:none; min-width:74px; }
.bte-field input[type=number]{ width:98px; }
.bte-field select:focus,.bte-field input:focus { border-color:var(--cy); }
.bte-run { margin-left:auto; align-self:flex-end; background:linear-gradient(120deg,#1ba3a0,#34d399); border:0; color:#04140f; font-weight:800; font-size:12.5px; letter-spacing:.02em; border-radius:9px; padding:9px 18px; box-shadow:0 0 18px rgba(52,211,153,.28); }
.bte-run:disabled { opacity:.6; }

/* CENTER — overview */
.bte-overview { display:flex; flex-direction:column; gap:11px; }
.bte-hero { min-height:340px; display:flex; flex-direction:column; }
.bte-legend { margin-left:auto; display:flex; gap:14px; font-size:10.5px; color:var(--ax-mut); }
.bte-legend span { display:inline-flex; align-items:center; gap:5px; }
.bte-legend i { width:9px; height:3px; border-radius:2px; display:inline-block; }
.bte-legend b { color:var(--ax-tx); font-family:var(--ax-mono,ui-monospace); font-variant-numeric:tabular-nums; }
.bte-herobody { flex:1; min-height:280px; position:relative; }
.bte-eqcanvas { width:100%; height:100%; min-height:280px; display:block; }
.bte-empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; color:var(--ax-mut); font-size:12.5px; text-align:center; padding:20px; line-height:1.6; }
.bte-empty b { color:var(--cy); }
.bte-empty.bte-err { color:var(--neg); }
.bte-spin { width:30px; height:30px; border-radius:50%; border:2.5px solid var(--ax-bdsoft); border-top-color:var(--cy); animation:bte-rot .9s linear infinite; }
@keyframes bte-rot { to { transform:rotate(360deg); } }

/* KPI strip */
.bte-kpis { display:grid; grid-template-columns:repeat(9,1fr); gap:8px; }
@media(max-width:1500px){ .bte-kpis{ grid-template-columns:repeat(5,1fr); } }
.bte-kpi { background:var(--ax-elev,#161c22); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:9px 10px; }
.bte-kpi-l { font-size:8px; letter-spacing:.08em; color:var(--ax-dim,rgba(140,175,200,.5)); margin-bottom:5px; }
.bte-kpi-v { font-family:var(--ax-disp,Oxanium); font-size:19px; font-weight:800; font-variant-numeric:tabular-nums; }

.bte-caveat { font-size:10px; color:var(--ax-warn,#f5a524); background:color-mix(in srgb,var(--ax-warn,#f5a524) 8%,transparent); border:1px solid color-mix(in srgb,var(--ax-warn,#f5a524) 25%,transparent); border-radius:8px; padding:7px 11px; line-height:1.4; }

/* staged panels */
.bte-stagerow { display:grid; grid-template-columns:repeat(5,1fr); gap:11px; }
@media(max-width:1500px){ .bte-stagerow{ grid-template-columns:repeat(2,1fr); } }
.bte-stage { min-height:120px; }
.bte-stage-body,.bte-tabstage .bte-stage-body { color:var(--ax-dim); font-size:11px; padding:20px 4px; }
.bte-tabstage { min-height:300px; }

/* RIGHT rail */
.bte-gauge-stub { display:flex; flex-direction:column; align-items:center; gap:2px; padding:14px 0 12px; }
.bte-gauge-v { font-family:var(--ax-disp,Oxanium); font-size:38px; font-weight:800; font-variant-numeric:tabular-nums; }
.bte-gauge-l { font-size:8.5px; letter-spacing:.14em; color:var(--ax-cydim,#5ec8e4); }
.bte-perflist { display:flex; flex-direction:column; }
.bte-perfrow { display:flex; justify-content:space-between; align-items:center; padding:5.5px 0; border-bottom:1px solid var(--ax-hair,rgba(120,205,225,.08)); font-size:11.5px; }
.bte-perfrow:last-child { border-bottom:0; }
.bte-perfrow span { color:var(--ax-mut); }
.bte-perfrow b { font-family:var(--ax-mono,ui-monospace); font-variant-numeric:tabular-nums; color:var(--ax-tx); }
.bte-wf-sq { display:flex; align-items:center; gap:3px; margin-bottom:9px; flex-wrap:wrap; }
.bte-wf-sq span { width:13px; height:13px; border-radius:3px; background:var(--ax-bdsoft); }
.bte-wf-sq span.pass { background:var(--pos); box-shadow:0 0 6px rgba(52,211,153,.4); }
.bte-wf-sq span.fail { background:var(--neg); }
.bte-wf-sq em { margin-left:6px; font-style:normal; font-family:var(--ax-mono,ui-monospace); font-size:11px; color:var(--ax-tx); }
.bte-mc-note { margin-top:8px; font-size:8.5px; color:var(--ax-dim); letter-spacing:.02em; }

/* chart controls */
.bte-chartctl { display:flex; gap:12px; margin-left:14px; font-size:10.5px; color:var(--ax-mut); }
.bte-chartctl label { display:inline-flex; align-items:center; gap:4px; cursor:pointer; }
.bte-chartctl input { accent-color:var(--cy); }
.bte-gauge { display:flex; flex-direction:column; align-items:center; gap:1px; padding:6px 0 10px; }

/* KPI strip (full width) */
.bte-kpis { display:grid; grid-template-columns:repeat(9,1fr); gap:9px; }
@media(max-width:1340px){ .bte-kpis{ grid-template-columns:repeat(5,1fr); } }

/* widget row (full width) */
.bte-widgets { display:grid; grid-template-columns:repeat(6,1fr); gap:11px; align-items:start; }
.bte-w { grid-column:span 1; min-height:150px; }
.bte-w-wide { grid-column:span 2; }
@media(max-width:1340px){ .bte-widgets{ grid-template-columns:repeat(2,1fr); } .bte-w-wide{ grid-column:span 2; } }
.bte-w-row { display:flex; align-items:center; gap:12px; }
.bte-w-legend { display:flex; flex-direction:column; gap:5px; flex:1; min-width:0; }
.bte-w-lrow { display:flex; align-items:center; gap:7px; font-size:10.5px; color:var(--ax-mut); }
.bte-w-lrow b { margin-left:auto; color:var(--ax-tx); font-family:var(--ax-mono,ui-monospace); font-variant-numeric:tabular-nums; }
.bte-w-sw { width:9px; height:9px; border-radius:2px; flex-shrink:0; }
.bte-w-none { color:var(--ax-dim); text-align:center; padding:14px; }
.bte-statlist { display:flex; flex-direction:column; }

/* monthly heatmap */
.bte-heat-wrap { overflow-x:auto; }
.bte-heat { border-collapse:collapse; width:100%; font-family:var(--ax-mono,ui-monospace); font-size:9px; }
.bte-heat th { color:var(--ax-mut); font-family:var(--ax-disp,Oxanium); font-weight:600; font-size:7.5px; padding:2px 2px; text-align:center; }
.bte-heat td { text-align:center; padding:3px 2px; color:var(--ax-tx); font-variant-numeric:tabular-nums; }
.bte-heat td.yr { color:var(--ax-mut); font-weight:700; text-align:left; }
.bte-heat td.ytd,.bte-heat th.ytd { font-weight:700; border-left:1px solid var(--ax-hair,rgba(120,205,225,.1)); }

/* drawdown table */
.bte-ddtable { width:100%; border-collapse:collapse; font-size:10px; font-family:var(--ax-mono,ui-monospace); }
.bte-ddtable th { color:var(--ax-mut); font-family:var(--ax-disp,Oxanium); font-weight:600; font-size:8.5px; text-align:left; padding:3px 4px; letter-spacing:.03em; }
.bte-ddtable td { padding:4px 4px; color:var(--ax-tx); border-top:1px solid var(--ax-hair,rgba(120,205,225,.08)); font-variant-numeric:tabular-nums; }
.bte-ddtable tr.clk { cursor:pointer; }
.bte-ddtable tr.clk:hover td { background:rgba(120,205,225,.05); }

/* SUB-TABS content */
.bte-tabhost { display:flex; flex-direction:column; gap:11px; }
.bte-tabgrid { display:grid; grid-template-columns:1fr 1fr; gap:11px; align-items:start; }
.bte-tab-wide { grid-column:1 / -1; }
@media(max-width:1000px){ .bte-tabgrid{ grid-template-columns:1fr; } }
.bte-tabstage { min-height:280px; }
.bte-seg { margin-left:auto; display:flex; gap:2px; }
.bte-seg button { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:6px; padding:3px 9px; font-size:9.5px; text-transform:uppercase; }
.bte-seg button.on { color:var(--cy); border-color:var(--ax-bdglow); }
.bte-ledger-wrap { overflow:auto; max-height:540px; }
.bte-ledger { width:100%; border-collapse:collapse; font-family:var(--ax-mono,ui-monospace); font-size:10px; }
.bte-ledger th { position:sticky; top:0; background:var(--ax-panelhi); color:var(--ax-mut); font-family:var(--ax-disp,Oxanium); font-weight:600; font-size:8.5px; text-align:left; padding:5px 6px; letter-spacing:.03em; z-index:1; }
.bte-ledger th.clk { cursor:pointer; } .bte-ledger th.clk:hover { color:var(--cy); }
.bte-ledger td { padding:4px 6px; border-top:1px solid var(--ax-hair,rgba(120,205,225,.08)); color:var(--ax-tx); font-variant-numeric:tabular-nums; white-space:nowrap; }
.bte-ledger td.rsn { color:var(--ax-mut); }
.bte-riskcards { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; }
.bte-riskcard { background:var(--ax-elev,#161c22); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:9px 10px; }
.bte-riskv { font-family:var(--ax-disp,Oxanium); font-size:18px; font-weight:800; font-variant-numeric:tabular-nums; margin-top:3px; }
.bte-substats { display:flex; gap:14px; margin-top:8px; font-family:var(--ax-mono,ui-monospace); font-size:9.5px; color:var(--ax-mut); flex-wrap:wrap; }
.bte-repbtns { display:flex; gap:8px; flex-wrap:wrap; }

/* LABS — Autopsy + Improve */
.bta-grid { display:grid; grid-template-columns:320px 1fr; gap:11px; align-items:start; }
@media(max-width:1000px){ .bta-grid{ grid-template-columns:1fr; } }
.bta-left { display:flex; flex-direction:column; gap:11px; }
.bta-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.bta-flags { display:flex; flex-direction:column; gap:5px; margin-top:9px; }
.bta-flag { display:flex; align-items:center; gap:7px; font-size:10.5px; color:var(--ax-mut); }
.bta-flag b { margin-left:auto; color:var(--ax-tx); font-family:var(--ax-mono,ui-monospace); }
.bta-list { display:flex; flex-direction:column; gap:4px; max-height:340px; overflow-y:auto; }
.bta-trow { display:flex; align-items:center; gap:8px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:7px 9px; font-size:11px; color:var(--ax-tx); text-align:left; }
.bta-trow.on { border-color:var(--ax-bdglow); }
.bta-tno { font-family:var(--ax-mono,ui-monospace); color:var(--ax-mut); }
.bta-tout { font-size:8px; text-transform:uppercase; letter-spacing:.06em; padding:1px 6px; border-radius:5px; }
.bta-tout.win { color:var(--ax-pos); background:color-mix(in srgb,var(--ax-pos) 14%,transparent); }
.bta-tout.loss { color:var(--ax-neg); background:color-mix(in srgb,var(--ax-neg) 14%,transparent); }
.bta-tout.scratch { color:var(--ax-mut); background:var(--ax-elev); }
.bta-trow b { font-family:var(--ax-mono,ui-monospace); }
.bta-sev { color:var(--ax-neg); font-size:8px; letter-spacing:-1px; }
.bta-detail { min-height:420px; }
.bta-tree { display:flex; flex-direction:column; gap:2px; margin:6px 0; }
.bta-nrow { display:flex; align-items:center; gap:7px; padding:4px 6px; border-radius:6px; font-size:11.5px; flex-wrap:wrap; }
.bta-nrow.has { cursor:pointer; }
.bta-nrow.has:hover { background:rgba(120,205,225,.05); }
.bta-caret { color:var(--ax-mut); font-size:9px; width:9px; }
.bta-nlabel { font-weight:600; font-family:var(--ax-mono,ui-monospace); }
.bta-ndetail { color:var(--ax-mut); font-size:10px; }
.bta-narr { margin-top:8px; padding:9px 11px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:9px; font-size:11px; color:var(--ax-mut); line-height:1.5; }
.bta-narr b { color:var(--ax-cydim,#5ec8e4); }
.bta-ai { margin-top:9px; padding:10px 12px; background:color-mix(in srgb,var(--cy) 7%,var(--ax-surface)); border:1px solid var(--ax-bdglow); border-radius:9px; font-size:11.5px; color:var(--ax-tx); line-height:1.55; white-space:pre-wrap; }
.bta-ai b { color:var(--cy); }
.bti-group { margin-bottom:6px; }
.bti-gh { font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ax-cydim,#5ec8e4); margin:8px 0 4px; }
.bti-opt { display:flex; align-items:center; gap:7px; padding:5px 7px; border-radius:6px; font-size:11.5px; color:var(--ax-mut); cursor:pointer; }
.bti-opt.on { color:var(--ax-tx); }
.bti-opt input { accent-color:var(--cy); }
.bti-opt em { margin-left:auto; font-style:normal; font-size:7.5px; letter-spacing:.06em; color:var(--ax-cydim,#5ec8e4); background:color-mix(in srgb,var(--cy) 12%,transparent); padding:1px 5px; border-radius:5px; }
.bti-cards { display:grid; grid-template-columns:repeat(2,1fr); gap:11px; }
@media(max-width:900px){ .bti-cards{ grid-template-columns:1fr; } }
.bti-ctop { display:flex; align-items:baseline; justify-content:space-between; }
.bti-cname { font-family:var(--ax-disp,Oxanium); font-weight:700; font-size:12px; color:#eaf3fb; }
.bti-cval { font-family:var(--ax-disp,Oxanium); font-weight:800; font-size:18px; color:var(--cy); font-variant-numeric:tabular-nums; }
.bti-cint { font-size:10.5px; color:var(--ax-mut); margin:5px 0 7px; line-height:1.5; }
.bti-steps { margin:0; padding-left:16px; display:flex; flex-direction:column; gap:4px; }
.bti-steps li { font-size:10.5px; color:var(--ax-tx); line-height:1.45; }

/* NEWS / REGIME / STRESS */
.bte-elev { background:var(--ax-elev,#161c22); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:9px 10px; }
.btn-feed { display:flex; flex-direction:column; gap:2px; max-height:540px; overflow-y:auto; }
.btn-item { display:flex; align-items:center; gap:9px; padding:8px 4px; border-bottom:1px solid var(--ax-hair,rgba(120,205,225,.07)); }
.btn-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.btn-dot.bullish { background:var(--ax-pos); } .btn-dot.bearish { background:var(--ax-neg); }
.btn-body { flex:1; min-width:0; }
.btn-title { font-size:11.5px; color:var(--ax-tx); line-height:1.35; }
.btn-meta { font-size:9px; color:var(--ax-mut); margin-top:2px; text-transform:capitalize; }
.btn-impact { width:60px; height:4px; background:var(--ax-surface); border-radius:3px; overflow:hidden; flex-shrink:0; }
.btn-impact > span { display:block; height:100%; }
.btr-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:9px; font-size:10px; color:var(--ax-mut); }
.btr-legend span { display:inline-flex; align-items:center; gap:5px; }
.btr-legend i { width:9px; height:9px; border-radius:2px; }
.btr-legend b { color:var(--ax-tx); font-family:var(--ax-mono,ui-monospace); }
.btr-sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:6px; vertical-align:middle; }
.bts-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:9px; }
.bts-card { background:var(--ax-elev,#161c22); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:10px 11px; }
.bts-card.na { opacity:.5; }
.bts-label { font-size:9px; letter-spacing:.04em; color:var(--ax-mut); margin-bottom:6px; text-transform:uppercase; min-height:22px; }
.bts-ret { font-family:var(--ax-disp,Oxanium); font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; }
.bts-mkt { font-size:9.5px; color:var(--ax-mut); margin-top:2px; font-family:var(--ax-mono,ui-monospace); }
.bts-sub { font-size:9px; color:var(--ax-mut); margin-top:3px; font-family:var(--ax-mono,ui-monospace); }
.bts-na { font-size:10px; color:var(--ax-dim); font-style:italic; }
.bts-frag { display:flex; align-items:center; gap:10px; margin-top:11px; padding-top:9px; border-top:1px solid var(--ax-hair,rgba(120,205,225,.08)); font-size:10px; letter-spacing:.06em; color:var(--ax-mut); }
.bts-frag b { font-family:var(--ax-disp,Oxanium); font-size:18px; }

/* new-best shockwave */
.bte-shock { position:fixed; inset:0; z-index:11000; pointer-events:none; display:flex; align-items:center; justify-content:center; }
.bte-shock-ring { position:absolute; width:40px; height:40px; border-radius:50%; border:2px solid var(--cy); box-shadow:0 0 30px var(--cy); animation:bte-shock 1.1s cubic-bezier(.2,.7,.3,1) forwards; }
.bte-shock-ring.r2 { animation-delay:.18s; border-color:#8ffce0; }
@keyframes bte-shock { 0%{ transform:scale(1); opacity:.9 } 100%{ transform:scale(34); opacity:0 } }
.bte-shock-toast { position:relative; font-family:var(--ax-disp,Oxanium); font-weight:800; font-size:20px; letter-spacing:.1em; color:#eafaff; text-shadow:0 0 24px var(--cy); animation:bte-shocktoast 2.6s ease forwards; }
@keyframes bte-shocktoast { 0%{ opacity:0; transform:translateY(8px) scale(.9) } 12%{ opacity:1; transform:none } 82%{ opacity:1 } 100%{ opacity:0; transform:translateY(-6px) } }

/* FOOTER */
.bte-foot { display:flex; align-items:center; gap:9px; flex-shrink:0; padding:6px 4px 2px; font-family:var(--ax-mono,ui-monospace); font-size:9px; letter-spacing:.03em; color:var(--ax-dim); flex-wrap:wrap; }
.bte-foot b { color:var(--ax-mut); font-weight:600; }
.bte-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-dim); }
.bte-dot.on { background:var(--pos); box-shadow:0 0 6px rgba(52,211,153,.5); }
.bte-fsep { width:1px; height:10px; background:var(--ax-hair,rgba(120,205,225,.12)); }
.bte-badge { padding:2px 7px; border-radius:6px; font-size:8px; font-weight:800; letter-spacing:.06em; background:color-mix(in srgb,var(--cy) 14%,transparent); color:var(--cy); }
.bte-badge.warn { background:color-mix(in srgb,var(--ax-warn,#f5a524) 18%,transparent); color:var(--ax-warn,#f5a524); }
.bte-fright { margin-left:auto; color:var(--ax-dim); opacity:.8; }
`;
