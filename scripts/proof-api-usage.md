# Forge Agent Proof API

Command API exposed by the extension:

- `forge-agent.runBlueprintProof`
  - Argument: `{ models?: string[], goal?: string, keepFixtures?: boolean }`
  - Returns: blueprint proof report.
- `forge-agent.runBlueprintProofMatrix`
  - Argument: either `string[]` model IDs or `{ models, goal, keepFixtures }`
  - Returns: one proof result per model.
- `forge-agent.getProofReport`
  - Returns the latest report from this extension host session.
- `forge-agent.runWeakModelEval`
  - Argument: `{ model?: string, live?: boolean, taskLimit?: number, keepFixtures?: boolean }`
  - Returns: bare-vs-harness weak model scorecard.
- `forge-agent.getWeakModelEvalReport`
  - Returns the latest weak-model eval report from this extension host session.

Example model matrix payload:

```json
{
  "models": [
    "openrouter/pareto-code",
    "openrouter/auto",
    "anthropic/claude-opus-4.8",
    "meta-llama/llama-3.3-70b-instruct",
    "cohere/north-mini-code:free"
  ],
  "goal": "Run the same blueprint proof fixture across cheap and frontier models.",
  "keepFixtures": true
}
```

Important proof fields:

- `passed`: the full model run passed the blueprint fixture.
- `actuallyModelDriven`: true only when provider calls succeeded without deterministic fallback.
- `providerCalls`, `providerFailures`, `fallbackProposals`: distinguishes model ability from harness fallback.
- `firewall.rejectedMalformedPatch`, `firewall.rejectedOutOfWorkspacePath`, `firewall.rejectedBlockedCommand`: deterministic safety checks.
- `testsPass` and `greenEvidence`: success proof.
- `artifacts`: state, plan, todos, and evidence ledger paths.

Weak-model eval CLI:

```powershell
npm run eval -- --model qwen/qwen2.5-coder-7b-instruct
```

Live OpenRouter spending is opt-in:

```powershell
$env:OPENROUTER_API_KEY="..."
npm run eval -- --model qwen/qwen2.5-coder-7b-instruct --live
```

Weak-model scorecard fields:

- `bareSolved`, `harnessSolved`, `solveRateDelta`: direct uplift measurement.
- `actuallyModelDriven`: harness solves caused by model proposals that passed validation.
- `fallbackSolved`: deterministic fallback successes reported separately and not counted as model-driven.
- `greenEvidence`: per-task proof that tests passed and the evidence ledger recorded the result.
- `modelSelection`: records why the selected model is cheap/weak and which stronger routes were excluded.
