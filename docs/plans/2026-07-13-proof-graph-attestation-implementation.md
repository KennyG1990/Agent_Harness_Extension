# Phase 96 Proof Graph And Signed Attestation Implementation Plan

Lifecycle: `PLAN -> RECONCILE -> DOCUMENT -> IMPLEMENT -> VALIDATE -> REVIEW -> DOCUMENT CLOSE -> AAR`

## Implementation Order

1. Add canonical graph types, privacy-safe node projection, deterministic edges, graph digest and completeness checks.
2. Generate/persist the graph at the existing state persistence choke point and archive it per session.
3. Add Ed25519 key management through an injected SecretStorage adapter; implement canonical signing and pure independent verification.
4. Add stale-state/graph refusal, key rotation and tamper-safe native commands/artifact access.
5. Expose only a compact collapsed proof summary; keep detailed graph/attestation in native editors.
6. Add causal success/failure fixtures, privacy/tamper/key-rotation negatives, extension-host SecretStorage proof, static/worker/visual/package/install and actual Antigravity gates.
7. Review authority and false-success paths, close documents and record AAR.

## Acceptance Evidence

- Identical JSON-round-tripped state produces the same graph digest and acyclic node/edge set.
- Successful fixture links requirement -> proposal -> validation -> change -> oracle -> review -> evidence -> success.
- Red/missing evidence graphs report incomplete and cannot produce a success claim.
- Mutating any graph node, contract digest, attestation payload, signature or public key fails verification.
- SecretStorage fake proves private material never reaches workspace artifacts; key rotation leaves old attestations verifiable.
- Credential/source/path canaries do not occur in graph or attestation JSON.
- Native open/sign/verify commands and compact summary work in extension-host and installed Antigravity.

## Document Close

Status: **PASS in 0.96.0**.

- `npm run test:attestation` proves an 18-node/40-edge requirement-to-terminal path, stable JSON-round-trip digest, privacy canaries, six tamper cases, forged-but-self-consistent graph refusal, SecretStorage-only private keys, rotation and false-success denial.
- `npm run test:execution-contract`, `npm run test:customizations`, final `npm run test:background`, `npm test`, `npm run test:workers`, `npm run test:e2e`, `npm run test:visual` and `git diff --check` pass. Worker stress is 100/100; no provider call ran.
- The signer independently rebuilds the graph from terminal state. Public verification checks graph, payload, contract, terminal, completeness, key identity and Ed25519 signature.
- VS Code and Antigravity list `kennyg.forge-agent@0.96.0`. Actual Antigravity after reload exposes one compact collapsed Proof integrity disclosure and correctly disables signing/verification without a terminal run.
- Final document-closed artifact: `forge-agent-0.96.0.vsix`, 4,722,098 bytes, SHA-256 `05DFC7C87444235C15FAA9C54F90C11C76291737E0FB0EFD78297B05D5B6F0F5`.

## AAR

- Sustain: derived proof only, SecretStorage-only private keys, independent public verification, explicit rotation, native artifacts and one collapsed control.
- Improve: the first signer draft trusted a self-consistent graph instead of rebuilding it; the final signer now binds graph derivation to terminal state. A Windows `EPERM` exposed missing bounded manifest replacement retries; the background session writer now retries only transient lock codes and preserves the original failure otherwise.
- Boundary: this is local integrity provenance, not CA identity, remote trusted time, oracle calibration or proven socket isolation.
- Suggested commit title: `Phase 96: add proof graph and signed run attestations`.
