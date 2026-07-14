# Phase 96 Proof Graph And Signed Attestation Design

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Objective

Turn Forge's existing persisted run facts into one deterministic, navigable proof DAG and add independently verifiable, privacy-preserving Ed25519 attestations. The graph and signer report facts; neither may create evidence, approve a proposal, select oracle truth, merge changes or convert a non-success terminal state into success.

## Reconciled Foundations

- `persistStateToDisk` is the shared state/materialization choke point for goal, contract, tasks, progress, approvals, transactions, reviews, oracles, evidence and terminal state.
- `ExecutionContractV1` already provides canonical authority identity.
- `progressEvents`, approvals, checkpoints, transaction ledgers, reviews and evidence carry stable IDs/timestamps but are scattered across files.
- Extension `SecretStorage` already protects OpenRouter and MCP credentials. Harness workers cannot access it.
- Audited assurance currently fails closed because signed attestation and oracle calibration are unavailable.

## Proof Graph Contract

`ProofGraphV1` is a canonical DAG persisted to `.forge/proof-graph.json` and session archives.

- Nodes: run, execution contract, requirements, tasks, proposals, validations, approvals, changes, diffs, oracles, reviews, evidence and terminal state.
- Edges: `requires`, `addresses`, `validated_by`, `approved_by`, `committed_as`, `verified_by`, `reviewed_by`, `evidenced_by`, and `terminates_as`.
- Every node has a deterministic ID, kind, status, timestamp where applicable, privacy-safe summary, source artifact and SHA-256 payload digest.
- The graph digest covers the canonical graph excluding `generatedAt` and its own digest. Ordering is deterministic.
- Goal/source/command/diff bodies are not copied into graph summaries. Sensitive values are represented only by bounded type/status/count metadata and content digests.
- A terminal-success graph is complete only when it links confirmed contract requirements to green composite oracle evidence and required reviews. Graph completeness reports missing links but never changes harness success truth.

## Attestation Contract

`RunAttestationV1` signs a canonical statement containing graph digest, contract digest/revision, terminal state, assurance, model-driven/fallback counts, oracle/review/evidence summary, extension version, workspace identity hash, key ID and issuance time.

- Ed25519 private PKCS8 material lives only in `ExtensionContext.secrets`; public SPKI material is stored in the attestation and `.forge/attestation-public-key.json`.
- Keys are generated lazily in the extension host and may be explicitly rotated. Workers, providers, webviews and workspace files never receive private material.
- Signing is allowed for any terminal status but `claimsSuccess` is true only when the source state is terminal success and the proof graph completeness gate is green.
- Verification recomputes the graph digest, attestation payload digest, key ID and Ed25519 signature using public data only.
- Any graph, payload, signature, key or contract tamper fails verification. A valid signature proves local key possession and payload integrity, not third-party identity or remote timestamp authority.

## UX

- No dashboard and no second composer.
- Add native commands to open the proof graph, sign/verify the latest terminal run and rotate the attestation key.
- Add one collapsed Proof/settings summary with graph node/edge/completeness and latest verification status.
- Detailed graph and attestation remain native JSON artifacts.

## Risks And Recovery

- Canonicalization drift: use one exported canonical serializer and JSON-round-trip tests.
- Stale graph signing: signer reloads state and graph, recomputes both digests and refuses mismatches.
- Privacy leak: adversarial fixture seeds credentials, paths, source and prompts; graph/attestation output must omit them.
- Key loss/rotation: old attestations remain verifiable from embedded public keys; rotation never rewrites history.
- Rollback: graph/attestation are derived artifacts. Removing them cannot restore or alter workspace bytes, evidence or terminal state.

## Non-Goals

- No certificate authority, cloud identity, transparency log, remote timestamp or organization policy signature.
- No claim that signing alone makes Audited assurance executable; Phase 97 calibration and proven runtime isolation remain independent gates.
- No model-authored graph edges or attestation claims.
