# Instagram Automation — Build Plan (browser lane, recipe engine)

Status: **PLAN ONLY — nothing built yet, nothing has touched the real account under this plan.**
Owner: Dev. Last updated: 2026-08-09.

---

## RULE ZERO — the one that cannot be broken

**Jarvis never performs ANY action or read on the real Instagram account without Dev explicitly approving that specific run, in the moment.**

- No automated test, script, or wave may hit the real account on its own.
- The very first time we touch the real account — even a *read* — Dev is asked first, watches it, and confirms.
- Every write (send, comment, follow, like, post, delete) always pauses at an approval card and waits for a yes. This is the existing gate; it stays, for every action, forever.
- Tests run against **fake local pages** (fixtures), never the real account. A test that logs into or reads the real account is a bug in the test.

If any step is unclear on whether it touches the real account: it does not run. Ask.

---

## RULE ONE — anti-fuck-up discipline (why the last month hurt)

Every wave obeys these, no exceptions:

1. **Verify before claiming.** "It works" requires shown evidence (a passing test, a captured result). "The code exists" is not "it works." Say plainly what was NOT tested.
2. **A test that cannot fail is a bug.** Every test is mutation-checked: break the code on purpose, confirm the test goes red. If it stays green, the test is worthless and gets rewritten.
3. **Measure, don't guess.** No "I think it's slow because X." Instrument, get the number, then fix. (This is how the 95-second read was finally solved.)
4. **Fixtures first, real account last.** Build and prove every recipe against a local fake Instagram page. Only after green + Dev's go does it ever meet the real site.
5. **One wave at a time. Gate before proceeding.** A wave is not "done" until its tests pass, its mutations are caught, and Dev signs off. No starting the next wave early.
6. **No silent scope creep.** If something turns out harder/riskier than planned, stop and say so — don't quietly build a fragile version.

---

## What we're building, in plain words

Teach Jarvis each Instagram action once as a fixed **recipe** (the exact steps). After that it *replays* the recipe — no re-reading the whole page, no AI thinking per run — so it's fast and repeatable. When Instagram changes its layout and a recipe breaks, Jarvis re-finds the pieces once (AI), patches the recipe, and moves on. After every action it **checks the result actually happened**.

Three reusable pieces sit under all of it:
- **Recipe runner** — record steps → replay with no AI → self-heal on break → verify the effect.
- **Pacing layer** — human-speed timing + daily limits, so the account stays safe.
- **List reader** — scrolls big lists (followers, likers, story viewers) and harvests them.

Everything finds elements by **meaning** (the button's accessible label, its role, its text, the username in the link) — never by Instagram's class names, which change weekly and killed every old bot.

---

## The waves

Each wave lists: **Goal · What gets built · Tests (all on fixtures) · Gate to pass before the next wave.**

### Wave 0 — The engine (no Instagram at all yet)
- **Goal:** the reusable core, provable without ever touching Instagram.
- **Build:**
  - Recipe format + runner: record a sequence of steps, replay them, detect when a step fails.
  - Self-heal hook: when replay fails, an AI re-find pass produces a new step; recipe updates.
  - Verify step: after an action, confirm the expected change is present.
  - Pacing layer: warm-up, think-pauses, per-character typing, jitter, cooldowns, per-day budgets — all configurable, all tested.
  - List reader: scroll a virtualized list, harvest items keyed by a stable id, dedupe, stop when it stops growing.
  - Element finder: try accessible-label → role+name → text → structural, in order; require exactly one match; fail loud on zero or many.
- **Tests (fixtures only):**
  - Recipe replays a recorded flow on a fake page with zero AI calls.
  - When the fake page's layout is mutated, replay fails and the heal path fires.
  - Verify catches a "soft fail" (action didn't take) and reports it, not a false success.
  - Pacing: timings fall in the configured human ranges; budget refuses the 51st action of a 50-cap day.
  - List reader harvests all N items from a fake infinite-scroll list of 500, deduped, none missed.
  - Element finder returns exactly one for a labelled control, and refuses (not guesses) when ambiguous.
  - **Mutation pass:** every test above is proven able to fail.
- **Gate:** all green + mutations caught. **Zero** real-account contact. Dev sign-off.

### Wave 1 — Reads (safest half; first real-account contact, supervised)
- **Goal:** answer questions — inbox, a conversation, followers/following, who-liked, story viewers, notifications.
- **Build:** one read-recipe per item, on top of Wave 0's list reader.
- **Tests (fixtures):** each read parses a fake Instagram page correctly (right people, right handles from the link hrefs, right unread flags); scroll-harvest reads a fake followers modal fully.
- **First real-account contact happens here — and ONLY like this:**
  1. All fixture tests green + mutation-caught.
  2. Dev explicitly says "do the live read now."
  3. One read runs, Dev watching, result shown. Reads mutate nothing, so this is the low-risk place to first meet the real site.
  4. Note: viewing a story / opening a DM / scrolling a huge list are treated as *actions* (they leave a trace), not free reads.
- **Gate:** fixtures green, one supervised live read confirmed correct, Dev sign-off.

### Wave 2 — Easy actions
- **Goal:** like/unlike, save, follow/unfollow, comment, reply.
- **Build:** a recipe each (starting from the socialcrabs flows as reference), each ending in a verify.
- **Tests (fixtures):** each recipe performs the right click/type on a fake page; verify confirms the state flip (Like→Unlike, Follow→Following); the wrong-target guard refuses when the element is ambiguous.
- **Real account:** only per-action, only with the approval card, only when Dev says go. Never in tests.
- **Gate:** fixtures green + mutations caught; one supervised live action per type, approved live; Dev sign-off.

### Wave 3 — Medium actions
- **Goal:** story view + reply + emoji react, block/mute/restrict, accept/deny follow requests, share to DM.
- **Build + Tests:** as Wave 2. Extra care: menus render as pop-ups at the end of the page (search the whole page for them, not next to the button). Follow-request/notification panels are unstable — recipes here carry a clear "re-find if the panel moved" note.
- **Gate:** same as Wave 2, plus an honest note on which of these are fragile.

### Wave 4 — Hard actions (last, honestly badged)
- **Goal:** post a photo/reel; story stickers (poll/quiz/slider) if feasible.
- **Reality up front:** posting uses a hidden file field + a multi-step upload; story stickers are drag-on-canvas overlays and may not be reliably automatable. These get built last and are **labelled "experimental" if they aren't rock-solid.** We do not pretend a flaky version works.
- **Gate:** whatever we ship here is either solid-and-tested or clearly marked experimental. No dishonest "done."

### Wave 5 — Safety proof before trusting it at any volume
- **Goal:** confirm the setup doesn't leak a bot fingerprint.
- **Build:** run the browser setup through the open-source bot-detector; fix any leak.
- **Gate:** clean detector result; the pacing/budget defaults reviewed with Dev.

---

## Testing strategy (the whole point)

- **Fixtures = fake local HTML** that mimic Instagram's *structure* (roles, aria-labels, virtualized lists, portal menus) — not its exact classes. Recipes are proven against these.
- **Every test mutation-checked.** Break the code, confirm red.
- **No live account in any automated test, ever.**
- **Live contact is manual, supervised, and approved** — first a read (Wave 1), then per-action (Wave 2+).
- **Speed is a tested property**, not a hope: recipe replays must run with zero AI calls (assert the call count is 0), so "fast" is measured, not claimed.

---

## Safety model (baked in, not optional)

- Real Chrome, one long-lived manual login (Dev logs in; Jarvis never types the password).
- Human pacing + daily budgets on by default; back off hard and stop an action type for 24–48h on any "action blocked" warning.
- Reads are safer than actions; story-view / DM-open / big-list-scroll count as actions.
- Every write pauses at the approval card. Every write. Always.
- The card names WHO the action affects (built already), so Dev sees the target before approving.

---

## Honest risk register

- Instagram changes its layout ~weekly → recipes will break; the self-heal + "fail loud, don't guess" design is how we survive it without silent wrong actions.
- Follow-requests / notifications panels: no stable address, redesigned often → treat as fragile.
- DM unread state: no clean marker → best-effort, flagged.
- Story stickers / decorated story posting: hardest surface → last, experimental.
- Account safety is never zero. Low volume + human pacing + real browser is the mitigation, not a guarantee.

---

## Out of scope (so we don't build junk)

- The private API / instagrapi (blocked on this account — proven, removed).
- The Graph API (needs a public business account — off the table).
- Bulk growth automation (mass follow/like) — not the goal, and the fastest way to get banned.
- Anything that touches the real account outside the approval flow.

---

## Definition of done (per wave)

A wave is done when, and only when:
1. All fixture tests pass.
2. Every test is proven able to fail (mutation).
3. Speed properties are asserted where relevant (zero-AI replay).
4. Any real-account step was supervised, approved, and shown correct.
5. Dev has signed off.

Until all five are true, the wave is not done and the next wave does not start.
