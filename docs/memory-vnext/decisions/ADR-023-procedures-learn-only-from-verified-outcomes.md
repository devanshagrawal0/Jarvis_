# ADR-023: Procedures Learn Only From Verified Outcomes

- Status: Accepted for Wave 24
- Date: 2026-07-26

JARVIS may retain compact experience cases, but it must not treat a trajectory, model confidence, raw chain of thought, or an unverified user reaction as evidence that a method works. An outcome becomes learnable only after a scope-bound verification records explicit criteria, versioned evidence references, environment/version context, evaluator identity, independent group, and a signed receipt. The declared success bit must equal the result of every criterion.

Cases are clustered by keyed task signature and environment family. A lesson candidate requires a success, a failure, and a counterexample from the same cluster; higher-risk lessons require more independently verified successes. Candidate blueprints, selectors, and contracts remain encrypted. Promotion requires exact lesson-test coverage, passing environment and permission checks, a ready test result, and direct owner authority for protected, side-effecting, high-risk, or critical procedures.

An active procedure is selected only when its task signature, environment selector, allowed tools, and granted permissions match. Environment-mismatched outcomes are recorded but do not alter reliability. Scope-matched verified regressions update reliability and automatically suspend a procedure below its declared floor. Generated skill, LangGraph, or checklist adapters remain declarative: side effects still require approval when executed.

Retrieval utility is governed by the same rule. At schema version 22 or later, a positive `verified` retrieval outcome is rejected unless it cites a scope-matched outcome-verification receipt. This closes the prior path where a caller could label its own result verified.
