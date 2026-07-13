# Phase 90 Context And Model Optimization Design

## Goal

Reduce weak-worker token waste and improve task grounding without weakening Forge authority, while making plan-big/execute-small savings measurable against a rigor-matched solo control.

## Reconciliation

Forge already has deterministic prompt sections and a 96,000-character cap, optional OpenRouter embeddings with deterministic fallback, `@file`/`@folder`, host-captured editor context, Architect-to-Editor handoffs, persistent role workers, and per-role usage. Phase 90 must extend those systems rather than create a second context store, router, or agent loop.

The missing product capabilities are:

- `@symbol` task entry backed by the validated workspace index.
- image attachments delivered only to a model whose host-known capability includes vision.
- deterministic semantic-neighbor context around a selected symbol, with bounded source and provenance.
- prompt budgets derived from the exact selected model and role instead of one global constant.
- opt-in worker pools ranked by host-known capability, context, cost, and task terrain; explicit user role bindings remain authoritative when no pool is configured.
- immutable context/routing reports and a same-rigor plan-big/execute-small versus solo-frontier product A/B.

## Design Laws

1. The webview sends candidate IDs/paths and metadata only. The host revalidates index, realpath, file type, bytes, and model capability.
2. Images never enter ordinary string prompts or persistent logs as raw bytes. A bounded data URL is supplied as a provider message part only for the selected call and the persisted attachment stores a digest plus host-owned source path.
3. Symbol neighbors are deterministic extracts, not model summaries: declaration window plus bounded exact-name reference windows from validated indexed files.
4. Model-aware budgets reserve output/tool headroom, have hard min/max limits, and persist the exact model/context/source used to choose the budget.
5. Cost-aware routing can choose only from an explicit configured pool and only before a worker's first call. It cannot alter role/tool authority, bypass user-selected mandatory models, or route to a model lacking structured output/tool capability.
6. Plan-big/execute-small and solo-frontier lanes use the same fixture, oracle, firewall, reviewer, evidence, step limits, and fallback accounting. Savings without equal rigor do not count.

## Product Surface

- Extend the existing `@` picker with symbol rows. No permanent context panel.
- Add one Image action to the existing temporary attachment menu.
- Keep routing/pool controls in collapsed Settings/native configuration.
- Add native commands for context optimization and model-routing reports; the conversation footer receives only compact `context` and `route` summaries.

## Acceptance

- Forged/stale/outside symbol and image inputs reject before provider use.
- Non-vision routes reject image transmission before a paid call.
- Symbol references are bounded, contained, reproducible, and source-provenanced.
- Small-context models receive smaller prompts with reserved response capacity; larger models do not exceed hard host caps.
- Configured cheap capable workers are preferred for simple terrain; typed repeated failures escalate to the stronger configured route without mutating an existing worker identity.
- The A/B report separates provider calls/failures, fallback, actually-model-driven solves, role tokens/cost/latency, oracle/evidence, and no-uplift outcomes.

## Non-Goals

- Automatic workspace-wide image ingestion, OCR, remote-image URLs, hidden user-data transmission, or multimodal success evidence.
- Unconfigured model substitution, benchmark-derived vendor rankings presented as objective truth, or using price alone as capability proof.
- Model-written compaction replacing required source. The first A/B may compare deterministic extracts against a bounded model summary, but deterministic required sections remain authoritative.

