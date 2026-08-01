# ADR-011: Bitemporal and Epistemic Truth

- Status: Accepted for Wave 12
- Date: 2026-07-24

Assertion identity and assertion versions are separate. A version records both the real-world interval in which a claim is valid and the database interval in which JARVIS held that version as current. Correction and conflict resolution close recorded intervals and append new versions; they do not rewrite history.

Epistemic status is stored explicitly. Observation, owner assertion, source assertion, inference, hypothesis, dispute, supersession, and retraction are never flattened into one confidence score. Confidence retains its individual components and policy version. Source assertions require supporting evidence, and conflict sets preserve competing independent claims until an owner-authorized resolution.

