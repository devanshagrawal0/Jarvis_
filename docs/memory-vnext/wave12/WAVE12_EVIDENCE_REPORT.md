# Wave 12 Evidence Report - Bitemporal and Epistemic Assertion Truth

Date: 2026-07-24  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Stable assertion identities separated from append-only recorded versions.
- Independent valid-time and recorded-time intervals.
- Explicit epistemic states: observed, owner asserted, source asserted, inferred, hypothetical, disputed, superseded, and retracted.
- Encrypted assertion objects and provenance.
- Confidence vectors retaining extraction, source reliability, corroboration, freshness, user confirmation, contradiction penalty, computed confidence, and policy version.
- Evidence membership with stance, entailment, and independent-source grouping.
- Conflict sets that preserve competing claims until explicit resolution.
- Owner-authorized conflict decisions with recorded-history versions for winners and losers.
- Temporal queries that can answer both what was valid and what JARVIS believed at an earlier recording time.

## Verified

- Revising epistemic state does not overwrite prior recorded belief.
- A historical recorded-time query returns the earlier belief while a current query returns the new disputed state.
- Two independent external claims remain visible together while a conflict is open.
- Resolution creates new recorded versions; it does not rewrite the losing claim's history.
- Current queries exclude retracted/superseded versions while historical queries can still recover prior belief.
- Source-asserted versions require supporting evidence and preserve that evidence through revision.
- Owner-asserted truth cannot be created by a non-owner actor.
- Confidence components and policy versions remain independently inspectable.

