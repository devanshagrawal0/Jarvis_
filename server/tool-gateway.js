const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");

const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "your", "you", "please", "can", "could", "would"]);

function tokenize(value) {
  const separated = String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return [...new Set((separated.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || []).filter((token) => !STOP_WORDS.has(token)))];
}

function createToolGateway({ capabilityEngine, moduleRegistry, codeKnowledge }) {
  const mcp = new McpServer({ name: "jarvis-local-tools", version: "1.0.0" });

  for (const definition of capabilityEngine.definitions) {
    mcp.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: z.object({}).catchall(z.unknown()),
      },
      async (args) => {
        const result = await capabilityEngine.execute(definition.name, args, {
          deviceId: "mcp-client",
          source: "mcp",
        });
        return {
          isError: !result.ok,
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      },
    );
  }

  mcp.registerResource(
    "jarvis-capabilities",
    "jarvis://capabilities",
    { description: "The executable JARVIS capability catalog.", mimeType: "application/json" },
    async () => ({
      contents: [{
        uri: "jarvis://capabilities",
        mimeType: "application/json",
        text: JSON.stringify(capabilityEngine.definitions),
      }],
    }),
  );
  mcp.registerResource(
    "jarvis-modules",
    "jarvis://modules",
    { description: "The complete JARVIS module registry and readiness state.", mimeType: "application/json" },
    async () => ({
      contents: [{
        uri: "jarvis://modules",
        mimeType: "application/json",
        text: JSON.stringify(moduleRegistry()),
      }],
    }),
  );

  function scoreTool(definition, queryTokens) {
    const haystack = tokenize(`${definition.name} ${definition.description}`);
    const matches = queryTokens.filter((token) => haystack.some((word) =>
      word === token
      || (token.length >= 4 && word.length >= 4 && (word.startsWith(token) || token.startsWith(word))),
    ));
    let score = matches.length * 4;
    const query = queryTokens.join(" ");
    const name = definition.name.replaceAll("_", " ");
    if (query.includes(name)) score += 12;
    return score;
  }

  function selectTools(prompt, options = {}) {
    const limit = Math.max(1, Math.min(12, Number(options.limit || 5)));
    const route = options.route || {};
    const tokens = tokenize(prompt);
    const screenPrompt = /\b(screen|desktop|what'?s on my laptop|what is on my laptop|look at my laptop|laptop screen|current screen|visible screen|what'?s on my screen|what is on my screen)\b/i.test(prompt);
    const screenActionPrompt = screenPrompt
      || /\b(current laptop screen|visible laptop screen|screen_act|screen_inspect)\b/i.test(prompt)
      || (/\b(click|tap|open|play|watch|select|choose|type|write|press|hit|search|perform the search|submit the search|full ?screen|scroll)\b/i.test(prompt)
        && /\b(it|this|that|there|screen|laptop|youtube|you tube|video|search bar|results?)\b/i.test(prompt));
    const scored = capabilityEngine.definitions
      .map((definition) => ({ definition, score: scoreTool(definition, tokens) }))
      .sort((a, b) => b.score - a.score);
    const selected = scored.filter((item) => item.score > 0).slice(0, limit).map((item) => item.definition.name);
    const alwaysUseful = [];
    if (/\b(remember|memory|preference|about me|earlier|previous|life graph|know about me|my classes|my projects|my routines|my goals)\b/i.test(prompt)) {
      alwaysUseful.push("neural_vault_context", "neural_vault_resolve", "memory_search", "life_graph");
    }
    if (/\b(neural vault|memory mesh|continuity|context pack|what does (?:it|this|that) refer|what did i mean|last thing|previous conversation)\b/i.test(prompt)) {
      alwaysUseful.push("neural_vault_context", "neural_vault_resolve", "neural_vault_status", "memory_os_v4_status", "memory_os_v4_query");
    }
    if (/\b(memoryos|memory os|filedb|file db|memory agents?|file inspector|source code mapper|retrieval evaluator|memory manager)\b/i.test(prompt)) {
      alwaysUseful.push("memory_os_v4_status", "memory_os_v4_query", "memory_os_v4_scan_files", "memory_os_v4_run_agent");
    }
    if (/\b(what can you do|capabilities|tools|modules|features|api keys?|integrations?|provider health|connected services?|why can'?t you|what is broken|what works)\b/i.test(prompt)) {
      alwaysUseful.push("neural_vault_status", "neural_vault_integrations", "jarvis_self_inspect");
    }
    if (/\b(action macros?|macros?|workflow memory|saved actions?|repeatable actions?|learned procedures?|common actions?)\b/i.test(prompt)) {
      alwaysUseful.push("neural_vault_actions", "skill_list", "skill_inspect");
    }
    if (/\b(co-?op|symbiote|shared workspace|pair build|patch court|ghost sandbox|ask both jarvis|friend'?s jarvis|jarvis bridge|shared file tree|skill transfer dock|co-op replay|coop replay)\b/i.test(prompt)) {
      alwaysUseful.push(
        "coop_symbiote_status",
        "coop_symbiote_create_session",
        "coop_symbiote_manifest",
        "coop_symbiote_chat",
        "coop_symbiote_patch",
        "coop_symbiote_ghost_test",
        "coop_symbiote_debate",
        "coop_symbiote_memory",
      );
    }
    if (/\b(maintenance|clean memory|dedupe|deduplicate|memory report|vault report)\b/i.test(prompt)) {
      alwaysUseful.push("neural_vault_maintenance", "neural_vault_status");
    }
    if (screenPrompt) {
      alwaysUseful.push("screen_capture", "screen_inspect");
    }
    if (!screenPrompt && /\b(pc graph|knowledge graph|reality graph|my laptop|my computer|downloads?|documents?|desktop|screenshots?|recent files?|file from yesterday|last night|what was i working|find .* file|find .* project|where is .* pdf|where is .* doc|class files?|project dna|time machine)\b/i.test(prompt)) {
      alwaysUseful.push("pc_graph_search", "pc_graph_timeline", "pc_graph_explain", "pc_graph_inspect", "pc_graph_rebuild");
    }
    if (/\b(deploy|start|run|send)\b.*\b(agent|agents|browser agent|kalshi agent|canvas agent|pc agent|research agent|verifier)\b/i.test(prompt)
      || /\b(agent swarm|war room)\b/i.test(prompt)) {
      alwaysUseful.push("agent_deploy", "skill_inspect");
    }
    if (/\b(compile|save|learn|record|turn .* into|make .* reusable|autopilot|procedure|routine|skill)\b/i.test(prompt)
      && /\b(skill|routine|procedure|workflow|autopilot|when i say|repeatable|again)\b/i.test(prompt)) {
      alwaysUseful.push("skill_compile", "skill_list", "skill_inspect");
    }
    if (/\b(run|start|execute|use)\b.*\b(skill|routine|autopilot|workflow)\b/i.test(prompt)) {
      alwaysUseful.push("skill_run", "skill_list", "agent_deploy");
    }
    if (/\b(system|cpu|memory usage|uptime|network status|computer status)\b/i.test(prompt)) alwaysUseful.push("system_status");
    // The owner's own day — reading it (tasks/reminders/schedule/what's forgotten) AND adding to it
    // (add/remind/schedule/jot/note/book, or an event noun with a time). atlas_today is the READ tool
    // (never let the model claim it lacks access); atlas_capture creates. Both are exposed together so
    // the model can read-then-write; it still decides which to call.
    const atlasRead = /\b(task|tasks|to-?do|to-?dos|reminder|reminders|schedule|agenda|calendar|my day|plan (?:my|the) day|organize my day|what'?s (?:next|on|due)|what am i (?:forgetting|doing|supposed)|what do i (?:have|need)|due (?:today|tomorrow|this)|appointments?|events?|meetings?|waiting on|follow ?ups?|errands?|on my plate)\b/i.test(prompt);
    const atlasWrite = /\b(add|remind|schedule|book|jot|note|log|pencil in|set ?up|reschedule|cancel|move)\b/i.test(prompt)
      && /\b(task|todo|to-?do|reminder|note|event|meeting|appointment|call|lunch|dinner|breakfast|coffee|drinks?|gym|class|flight|interview|standup|sync|at\s*\d|\d{1,2}\s*(?:am|pm|:)|tomorrow|tonight|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|morning|afternoon|evening|noon)\b/i.test(prompt);
    // Mutating an EXISTING local item — "mark X done", "finish X", "move/reschedule X", "cancel/delete X".
    // Without these exposed, the model claimed "marked done"/"moved" with no tool (a lie) because it only
    // had atlas_add_*. These give it the real complete / reschedule / cancel handlers.
    const atlasMutate = /\b(mark|complete|completed|finish|finished|check off|tick off|cross off|done with|reschedule|move|cancel|delete|remove)\b/i.test(prompt);
    if (atlasRead) alwaysUseful.push("atlas_today");
    if (atlasWrite) alwaysUseful.push("atlas_add_task", "atlas_add_event", "atlas_add_reminder", "atlas_capture");
    if (atlasMutate) alwaysUseful.push("atlas_today", "atlas_complete_task", "atlas_reschedule_event", "atlas_cancel_item");
    // Retroactive log — past-tense "I had/met/finished/did X at <time>" records what already happened.
    if (/\bi (?:had|met|did|finished|wrapped|attended|went to|got|took|spoke|talked|called)\b/i.test(prompt) || /\blog (?:that|it|this)\b/i.test(prompt) || /\bjust (?:had|finished|wrapped|got out of|met)\b/i.test(prompt)) {
      alwaysUseful.push("atlas_log_past", "atlas_add_event");
    }
    // W0/W3 — the Stage. Expose BOTH stage tools together whenever a stage/panel/dashboard/
    // breakdown surface is wanted, so the BRAIN (not a keyword) decides whether to write prose,
    // render typed blocks, or MIX both in one surface. Keeping them symmetric avoids the trap of
    // having text available but not blocks (or vice-versa) purely because of phrasing.
    // (W4's presentation router will remove the keyword gate entirely.)
    if (/\b(panel|stage|surface|window|card|dashboard|breakdown|rundown|scorecard|at a glance)\b/i.test(prompt)
      && /\b(open|show|write|put|display|make|bring up|pop up|create|render|give|build|generate)\b/i.test(prompt)) {
      alwaysUseful.push("stage_render", "stage_show");
    }
    // Undo — reverse the last Today/calendar change. Exposed on undo/revert/nevermind so a bare "undo
    // that" reliably reaches the tool (it carries no other noun).
    if (/\b(undo|revert|nevermind|never mind|take that back|take it back|oops|scratch that|reverse that|undo that)\b/i.test(prompt)) alwaysUseful.push("atlas_undo", "atlas_today");
    // Bulk window clear — "clear my afternoon", "cancel everything tomorrow morning", "wipe my evening".
    if (/\b(clear|wipe|cancel everything|cancel all|clear out|free up|empty)\b/i.test(prompt) && /\b(morning|afternoon|evening|night|today|tomorrow|rest of|monday|tuesday|wednesday|thursday|friday|saturday|sunday|schedule|calendar|day)\b/i.test(prompt)) {
      alwaysUseful.push("atlas_clear_window", "atlas_today");
    }
    // Bulk MOVE a window to another day — "push my afternoon to tomorrow", "move everything after 3pm to friday".
    if (/\b(push|move|shift|bump|reschedule)\b.*\bto\b/i.test(prompt) && /\b(everything|all|my (morning|afternoon|evening|day)|after \d|before \d|rest of)\b/i.test(prompt)) {
      alwaysUseful.push("atlas_move_window", "atlas_today");
    }
    // The owner's REAL Google Calendar (read + write). Any mention of "calendar" exposes the Google
    // calendar tools so the model can actually check it / write it — never fall back to a web search.
    if (/\bcalendar\b/i.test(prompt)) {
      alwaysUseful.push("calendar_list_events", "calendar_create_event", "calendar_move_event", "calendar_cancel_event");
    }
    // Email — "email <person>", "e-mail/gmail", "send/reply/draft … a note/message", or a raw address.
    // There was NO email rule here, so the gmail tools were only pulled by fuzzy keyword scoring: "draft
    // an email" caught them but "email X that I'll be late" missed them → "Gmail tools not exposed" and a
    // hallucinated browser fallback. Expose the prepare→send pair (approval-bound) + the one-step sender
    // + a plain draft on ANY email intent so a send is always possible. gmail_read/inbox stay out (those
    // are inbound reads with their own trust rules); this is send/compose only.
    if (/\b(e-?mail|gmail)\b/i.test(prompt)
      || /\b(send|write|draft|shoot|compose|reply|forward|fire off|drop)\b[^.?!]{0,30}\b(mail|note|message|line|memo|email)\b/i.test(prompt)
      || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(prompt)) {
      alwaysUseful.push("gmail_prepare_email", "gmail_send_prepared", "email_smart", "draft_email", "resolve_contact");
    }
    if (/\b(latest|recent|most recent|today|tomorrow|current|right now|live|online|news|score|schedule|price|weather|research|look up|google|web|internet|who is|when is|where is|who won|finals|championship|world cup|fifa|things to do|events?)\b/i.test(prompt)) {
      alwaysUseful.push("research_v2", "web_research");
    }
    if (/\b(deep research|research report|investigate|source-backed|source backed|citations?|evidence|read sources?|compare sources?|summarize (?:this )?(?:url|link|page|article)|read (?:this )?(?:url|link|page|article))\b/i.test(prompt)
      || /https?:\/\/[^\s)]+/i.test(prompt)) {
      alwaysUseful.push("research_v2", "web_research_deep", "url_read", "web_research");
    }
    if (/\b(open|show|focus|expand|close|populate|render|display)\b.*\b(widgets?|panels?|cards?|hud|modules?)\b/i.test(prompt)) {
      alwaysUseful.push("ui_open_widget", "ui_focus_widget", "ui_close_widget", "ui_populate", "ui_render_card");
    }
    // W1: widget command & control — move / resize / arrange open windows.
    if (/\b(move|drag|put|place|shift|resize|shrink|grow|enlarge|expand|collapse|maximi[sz]e|minimi[sz]e|bigger|smaller|full ?screen|fullscreen|focus)\b.*\b(widgets?|panels?|windows?|cards?|modules?|it|this|that)\b/i.test(prompt)
      || /\b(widgets?|panels?|windows?|modules?)\b.*\b(top[- ]?(?:left|right)|bottom[- ]?(?:left|right)|left|right|center|corner|smaller|bigger|full ?screen)\b/i.test(prompt)
      // A move/place verb + a screen position implies a widget move even with no noun
      // ("move to top right", "put it bottom left", "shift to the corner") — resolve to the focused widget.
      || /\b(move|drag|put|place|shift|send|nudge|snap)\b.{0,20}\b(top[- ]?(?:left|right)|bottom[- ]?(?:left|right)|corner|(?:the )?(?:left|right|centre|center|middle|top|bottom))\b/i.test(prompt)) {
      alwaysUseful.push("ui_move_widget", "ui_resize_widget", "ui_open_widget", "ui_focus_widget");
    }
    if (/\b(arrange|tidy|organi[sz]e|tile|cascade|clean ?up|declutter|lay ?out|line up|stack|neaten)\b.*\b(widgets?|panels?|windows?|screen|workspace|everything|them|all)\b/i.test(prompt)
      || /\b(tidy|arrange|organi[sz]e|clean ?up|declutter)\b.*\b(up|my)\b/i.test(prompt)) {
      alwaysUseful.push("ui_arrange_widgets", "ui_open_widget", "ui_move_widget", "ui_resize_widget");
    }
    // "close everything / close all / clear the screen" and "what's open?"
    if (/\b(close|clear|dismiss|hide|shut)\b.*\b(everything|all|widgets?|panels?|windows?|screen|workspace|them)\b/i.test(prompt)
      || /\bwhat(?:'s| is| are)\b.*\b(open|on (?:my |the )?screen|up)\b/i.test(prompt)
      || /\b(which|list)\b.*\b(widgets?|panels?|windows?)\b.*\b(open)\b/i.test(prompt)) {
      alwaysUseful.push("ui_close_widget", "ui_arrange_widgets", "ui_focus_widget");
    }
    // W2: drive widget CONTENT — switch a tab / segment / filter inside a widget.
    if (/\b(switch|show|go to|jump to|pull up|display|view|filter|change|flip|take me to)\b.*\b(tab|positions?|orderbook|order book|fills?|markets?|alerts?|portfolio|missions?|specialists?|connected|disconnected|needs? action|explore|continuity|architecture)\b/i.test(prompt)
      || /\b(kalshi|connections?|agents?|memory|widget|panel)\b.*\b(tab|positions?|orderbook|order book|fills?|markets?|alerts?|portfolio|missions?|specialists?|filter|segment|view|explore|continuity|architecture)\b/i.test(prompt)) {
      alwaysUseful.push("ui_set_widget_view", "ui_open_widget", "ui_focus_widget");
    }
    if (/\b(make|create|generate|write|build|compose|draft|turn .* into)\b/i.test(prompt)
      && /\b(report|brief|briefing|document|doc|pdf|deck|slides?|presentation|study sheet|one[- ]pager|artifact|write[- ]up|summary sheet|trading brief|research brief)\b/i.test(prompt)) {
      alwaysUseful.push("compose_artifact", "artifact_status", "web_research_deep", "url_read");
    }
    if (/\b(code|source code|implementation|file|route|function|architecture|bug|server)\b/i.test(prompt)) {
      alwaysUseful.push("codebase_search", "jarvis_self_inspect");
    }
    const canvasPrompt = /\b(canvas|assignment|assignments|homework|course|courses|due|submit)\b/i.test(prompt);
    if (canvasPrompt) {
      alwaysUseful.push("canvas_assignments", "canvas_courses", "canvas_browser_assignments");
    }
    const kalshiAccountPrompt = /\b(portfolio|positions?|orders?|fills?|balance|latest bet|best position|exposure|p&l|profit|loss)\b/i.test(prompt)
      || /\bmy\s+(kalshi|bets?|orders?|fills?|portfolio|positions?|balance)\b/i.test(prompt);
    const kalshiDiscoveryPrompt = /\bkalshi\b/i.test(prompt)
      || /\b(get|check|find|show)\s+(odds|markets?|contracts?|prices?)\s+(from|on)\s+kalshi\b/i.test(prompt);
    const publicSportsSchedulePrompt = !kalshiDiscoveryPrompt
      && /\b(fifa|world cup|club world cup|soccer|football|game|games|match|matches|schedule|fixtures?)\b/i.test(prompt)
      && /\b(today|tomorrow|next|upcoming|current|live|right now|what .* games?|are there|when|schedule|fixtures?)\b/i.test(prompt);
    if (kalshiAccountPrompt) {
      alwaysUseful.push("kalshi_portfolio", "kalshi_positions", "kalshi_fills", "kalshi_balance");
    }
    if (!kalshiAccountPrompt && kalshiDiscoveryPrompt && /\b(game|match|world cup|fifa|soccer|football|mexico|mex|club world cup)\b/i.test(prompt)) {
      alwaysUseful.push("kalshi_market_discovery", "kalshi_markets", "screen_inspect", "screen_capture");
    }
    if (/\b(uploaded photo|photo i uploaded|phone photo|uploaded image|latest image|latest photo|picture i uploaded|device inbox|files? from my phone)\b/i.test(prompt)) {
      alwaysUseful.push("device_latest_image", "device_files", "mesh_objects", "mesh_status");
    }
    if (/\b(phone|ipad|tablet|device mesh|omnipresence|mesh|object portal|send .* (?:phone|ipad|device)|push card|command card|pair(?:ing)? link|laptop screen from phone|file from phone|photo from phone)\b/i.test(prompt)) {
      alwaysUseful.push("mesh_status", "mesh_objects", "mesh_send_command", "device_files", "device_latest_image");
    }
    if (/\b(pair(?:ing)?|connect|link|login|sign in|set up|setup)\b.*\b(phone|ipad|tablet|device)\b/i.test(prompt)
      || /\b(phone|ipad|tablet|device)\b.*\b(pair(?:ing)?|connect|link|login|sign in|set up|setup)\b/i.test(prompt)) {
      alwaysUseful.push("mesh_pair_link", "mesh_status", "mesh_self_test");
    }
    if (/\b(mesh diagnostics?|mesh self[- ]?test|qr|phone link|connection guide|why.*phone.*connect|why.*qr)\b/i.test(prompt)) {
      alwaysUseful.push("mesh_self_test", "mesh_pair_link", "mesh_status");
    }
    if (/\b(run|execute|powershell|command|cmd|terminal|shell|script)\b/i.test(prompt)) {
      alwaysUseful.push("run_command");
    }
    if (/\b(write|save|create|make)\b.*\b(file|txt|text file|document|note)\b/i.test(prompt)
      || /\b(file|txt|text file|note)\b.*\b(write|save|create|make)\b/i.test(prompt)) {
      alwaysUseful.push("write_file");
    }
    if (/\b(delete|remove|trash)\b.*\b(file|folder|directory)\b/i.test(prompt)) {
      alwaysUseful.push("delete_file");
    }
    if (/\b(clipboard|copy|paste|what(?:'s| is) in (?:my )?clipboard|read clipboard)\b/i.test(prompt)) {
      alwaysUseful.push("read_clipboard", "write_clipboard");
    }
    if (/\b(notification|notify|toast|alert|remind me|send me a? (?:reminder|notification|alert))\b/i.test(prompt)) {
      alwaysUseful.push("toast_notification");
    }
    if (/\b(analyze|analyse|what(?:'s| is) on (?:my )?screen|describe (?:my )?screen|look at (?:my )?screen|screen analysis)\b/i.test(prompt)) {
      alwaysUseful.push("screen_analyze");
    }
    if (/\b(youtube|you tube)\b/i.test(prompt) && /\b(video|watch|play|title|titled|called|open|full ?screen)\b/i.test(prompt)) {
      alwaysUseful.push("screen_act", "screen_inspect", "screen_capture", "desktop_control");
    }
    if (/\b(youtube|you tube)\b/i.test(prompt) && /\b(search|search bar|perform the search|submit the search)\b/i.test(prompt)) {
      alwaysUseful.push("screen_act", "screen_inspect", "screen_capture", "desktop_control", "open_url");
    }
    if (screenActionPrompt || /\b(do this on my screen|on (?:my )?(?:laptop|computer|screen)|visible screen|current screen|click on|click the|click .+ screen|type on screen|press|hotkey|full ?screen)\b/i.test(prompt)) {
      alwaysUseful.push("screen_act", "screen_inspect", "screen_capture", "desktop_control");
    } else if (/\b(switch tabs?|change tabs?|next tab|previous tab)\b/i.test(prompt)) {
      alwaysUseful.push("desktop_control", "screen_capture");
    }
    // Instagram gets dedicated read/send tools that use the proven human-coordinate-click path.
    // Surface them for however the request is phrased so the model reaches for the right tool
    // instead of the generic browser_act path (which the list overlay defeats).
    const instagramPrompt = /\binsta(gram)?\b|\bdms?\b|direct message/i.test(prompt)
      || /\b(follow requests?|who follows me|who followed me|my followers|who i'?m following|who am i following)\b/i.test(prompt);
    if (instagramPrompt) {
      if (/\b(inbox|dms?|messages?|conversations?|chats?|unread|who (?:messaged|texted|dm'?d|pinged) me)\b/i.test(prompt)) {
        alwaysUseful.push("instagram_read_inbox");
      }
      if (/\b(read|open|show|see|check|pull up)\b[^.?!]*\b(chat|convo|conversation|messages?|thread|dm)\b/i.test(prompt)
        || /\bwhat did .+ (?:say|send|write|text)\b/i.test(prompt)) {
        alwaysUseful.push("instagram_read_conversation");
      }
      if (/\b(notifications?|activity|follow requests?|requests?|who (?:followed|liked)|new followers?|what'?s new)\b/i.test(prompt)) {
        alwaysUseful.push("instagram_read_notifications");
      }
      if (/\b(followers?|following)\b/i.test(prompt)) {
        alwaysUseful.push("instagram_read_people");
      }
      if (/\b(dm|message|text|send|reply|tell|write|say|ask)\b/i.test(prompt)) {
        alwaysUseful.push("instagram_prepare_dm", "instagram_send_current");
      }
      // If nothing specific matched but Instagram is clearly the subject, offer the inbox read as
      // the safe default so the turn still has an Instagram-native tool rather than only browser_act.
      if (!alwaysUseful.some((n) => n.startsWith("instagram_"))) alwaysUseful.push("instagram_read_inbox");
    }
    if (/\b(browser|website|web page|chrome|canvas|instagram|gmail|youtube|you tube|github|reddit|google|kalshi|amazon|form|upload|download|submit|click|open .*site|open .*on (?:my )?(?:laptop|computer)|go to|log in)\b/i.test(prompt)) {
      alwaysUseful.push(
        "computer_use",
        "desktop_control",
        "open_url",
        "browser_status",
        "browser_login_handoff",
        "browser_login_complete",
        "browser_page_brief",
        "browser_navigate",
        "browser_snapshot",
        "browser_act",
        "browser_commit",
        "browser_tabs",
        "browser_file_search",
        "browser_screenshot",
        ...(canvasPrompt ? [] : ["browser_verify"]),
      );
    }
    if (screenPrompt) {
      alwaysUseful.push("screen_capture");
    }
    const pureBrowserOperationPrompt = /\b(browser|website|web page|chrome|open .*site|open .*on (?:my )?(?:laptop|computer)|go to|click|type|inspect it|snapshot|form|upload|download|submit)\b/i.test(prompt)
      && !/\b(latest|recent|most recent|today|current|right now|live|online|news|score|schedule|price|research|look up|who is|when is|where is|who won|finals|championship|world cup|fifa)\b/i.test(prompt);
    const filteredAlwaysUseful = pureBrowserOperationPrompt
      ? alwaysUseful.filter((name) => !["research_v2", "web_research", "web_research_deep", "url_read"].includes(name))
      : alwaysUseful;
    const filteredSelected = kalshiAccountPrompt || publicSportsSchedulePrompt
      ? selected.filter((name) => !["kalshi_market_discovery", "kalshi_markets"].includes(name))
      : pureBrowserOperationPrompt
        ? selected.filter((name) => !["research_v2", "web_research", "web_research_deep", "url_read"].includes(name))
      : selected;
    // T4c: skip tools entirely for pure conversation turns with no enrichment signals
    const isPureConversation = (route.intent === "conversation" || route.intent === "conversation-follow-up")
      && !route.action && !route.fresh && !route.personal && !route.code
      && filteredAlwaysUseful.length === 0;
    if (isPureConversation) return [];

    // `alwaysUseful` entries were matched against this specific prompt — "save this to a file"
    // put `write_file` here deliberately. Truncating the merged list meant that once enough
    // earlier blocks matched (pc-graph, artifact, codebase), the explicitly-requested tool fell
    // off the end and the model was told it had no way to write a file. Prompt-matched tools are
    // now kept in full and the scored suggestions fill whatever room is left; a request never
    // loses the tool it explicitly asked for.
    const declarationFor = (name) => capabilityEngine.declarations.find((item) => item.name === name);
    const required = [...new Set(filteredAlwaysUseful)].map(declarationFor).filter(Boolean);
    const requiredNames = new Set(required.map((item) => item.name));
    const suggested = [...new Set(filteredSelected)]
      .filter((name) => !requiredNames.has(name))
      .map(declarationFor)
      .filter(Boolean);
    return [...required, ...suggested.slice(0, Math.max(0, limit - required.length))];
  }

  function catalog() {
    return {
      protocol: "MCP",
      server: { name: "jarvis-local-tools", version: "1.0.0" },
      tools: capabilityEngine.definitions,
      resources: [
        { uri: "jarvis://capabilities", name: "JARVIS capabilities" },
        { uri: "jarvis://modules", name: "JARVIS modules" },
        { uri: "jarvis://codebase", name: "JARVIS codebase knowledge", stats: codeKnowledge?.stats() },
      ],
    };
  }

  function declarationsFor(names = []) {
    const allowed = new Set(names);
    return capabilityEngine.declarations.filter((item) => allowed.has(item.name));
  }

  return { mcp, selectTools, declarationsFor, catalog };
}

module.exports = { createToolGateway };
