# Chatgpt research

# 

# OpenRouter First Blueprint for a Success Driven AI Coding IDE

## Bottom line

The highest-probability path is **not** “pick the best default model.” It is **build the best harness**. My estimate is that roughly **65%** of the gap between an average AI IDE and a top-tier one comes from harness design, **25%** from repository and tool ergonomics, and only **10%** from raw model choice. That is an inference from OpenAI’s own description of “harness engineering” as the core problem in agenHere is the document formatted for improved readability. No content has been altered.-----OpenRouter First Blueprint for a Success-Driven AI Coding IDEBottom Line

The highest-probability path is **not** “pick the best default model.” It is **build the best harness**. My estimate is that roughly:

* **65%** of the gap between an average AI IDE and a top-tier one comes from harness design.  
* **25%** from repository and tool ergonomics.  
* **10%** from raw model choice.

That is an inference from OpenAI’s own description of “harness engineering” as the core problem in agentic software work, from SWE-agent’s finding that the agent-computer interface itself significantly changes performance, and from the fact that Codex, Claude Code, and Antigravity all enforce planning, task tracking, verification, and reusable repository guidance rather than acting like simple chat panes.

The blunt recommendation is this: **build a success harness, not a model picker**. Your IDE should automatically turn a user request into a durable contract with:

* A goal, context, and constraints.  
* Explicit “done when” criteria.  
* A task graph, checkpointed execution, and verification evidence.  
* A loop that keeps going until the stopping condition is met or a real blocker is found.

That is exactly the pattern Codex formalizes with `/goal`, plan-first workflows, `AGENTS.md`, review, and validation loops; Claude Code formalizes with plan mode, task tools, subagents, and memory; and Antigravity formalizes with Artifacts such as task lists, implementation plans, and walkthroughs.

You should also be realistic about the ceiling. A strong harness can make weaker models **materially more successful**, especially on bounded repository tasks, but it will not make “mostly any model” perform like a frontier planner on hard long-horizon work. The better design is to use stronger models for planning and completion judgment, and cheaper or weaker models as narrow workers for search, summarization, log triage, and repetitive subtasks. OpenRouter’s own routing and server-tool stack now supports this kind of role specialization with coding routers, advisors, subagents, and multi-model deliberation.-----What the Strongest Products Are Actually Enforcing

* **Codex** is enforcing a durable objective, not just a turn-by-turn chat. Its `/goal` workflow is specifically for long-running work with a **verifiable stopping condition**; OpenAI recommends that Codex know what “done” means, keep a progress log, run tests after checkpoints, and continue independently toward that end state.  
* **Claude Code** is enforcing structure around exploration, planning, progress tracking, memory, and concurrency. Anthropic documents plan mode as a read-only planning phase where Claude proposes a plan before editing; built-in Explore and Plan subagents keep repository exploration out of the main context window; task tracking is built into the Agent SDK through structured Task tools; and auto memory stores useful project knowledge such as build commands, debugging insights, architecture notes, and workflow habits across sessions.  
* **Google Antigravity** is enforcing artifact-first visibility. Google describes it as an agentic development platform where agents autonomously **plan, execute, and verify** work across the editor, terminal, and browser. Google’s own Antigravity materials emphasize **Artifacts** as the unit of trust and legibility: task lists, implementation plans, walkthroughs, screenshots, and browser recordings.

\-----The Core Agent Loop You Should Build

At the centre of your IDE should be a persistent **goal loop**. The simplest correct mental model is: **contract → research → plan → execute → verify → reflect → continue or stop**.

A practical version of that loop should persist six objects for every run:

1. **Goal contract:** Includes goal, context, constraints, `done_when`, non-goals, and budget.  
2. **Task graph:** Includes statuses, dependencies, blockers, and ownership.  
3. **Plan artifact:** Editable by the user before execution begins.  
4. **Evidence ledger:** Records the command, observation, diff, test result, and confidence for each checkpoint.  
5. **Repository knowledge layer:** Durable instructions, conventions, commands, and architecture notes (e.g., `AGENTS.md`).  
6. **Skill registry:** Reusable workflows for recurring jobs.

The OpenRouter First Runtime

OpenRouter is a good default **provider layer** because it already gives you a unified, OpenAI-compatible surface. However, because it is **stateless**, your IDE must own the orchestration state, artifacts, memory, and run history.

**Recommended Policy:**

* Use `openrouter/pareto-code` for primary coding turns.  
* Use `openrouter/auto` for non-coding or mixed tasks.  
* Use `session_id` to maximize cache hits and reduce model churn.  
* Use **model fallbacks** to prevent rate limits or downtime.  
* Use **structured outputs** for deterministic, type-safe artifacts.

\-----Claude Research: Technical BlueprintKey Findings

* **The "agent loop" is a simple while-loop:** Complexity lives in the layers *around* the loop.  
* **The "enforced success" layer:** Leading tools ship specific mechanisms the user never requests, such as persistent objectives, auto-generated task lists, sub-agent isolation, and scratchpad memory.  
* **Verification is the carrier:** Weak models succeed when harnessed to deterministic oracles (test runners, type checkers, linters).  
* **Context engineering is non-optional:** Use compaction, structured note-taking (e.g., `NOTES.md`), and sub-agent isolation.  
* **Edit-format mechanics:** Using context-anchored edits significantly improves reliability for weaker models.

The Five Layers

1. **IDE Shell:** Code-OSS fork.  
2. **Agent Harness:** The loop, firewall, and verification gates.  
3. **Provider Layer:** OpenRouter-default, capability-detecting.  
4. **Tool Layer:** MCP \+ native file/shell/edit tools.  
5. **Verification Layer:** Tests, type-check, lint, build as deterministic oracles.

\-----Gemini Research: Systems Architecture Blueprint

The design of a software development environment designed to run natively on the OpenRouter gateway requires a departure from standard, reactive chat interfaces.Core Requirements

* **Autonomous Command Center:** Orchestrates complex, multi-turn software modifications.  
* **Verification:** Verifies code changes against local system signals.  
* **State Management:** Maintains execution state without depending on heavy external drivers.  
* **Background Managers:** Spawns, tracks, and aligns multiple parallel actions (as seen in Google Antigravity).

\-----Blueprint: OpenRouter Agent Harness — VS Code Extension0. Build Directive

This is a **goal-driven build directive**. The project is decomposed into ordered phases. Each phase has a **DONE-WHEN** block containing only machine-verifiable gates.

**The Design Law (The Firewall):**

`PROPOSE → VALIDATE → COMMIT → NARRATE`

1. **Propose:** The LLM only ever proposes a structured action.  
2. **Validate:** A deterministic validator owns the decision to accept or reject.  
3. **Commit:** Applies the validated change to disk/state.  
4. **Narrate:** Explains what happened. It cannot change state.

Phase BreakdownPhase 0: Extension skeleton \+ provider layer

**Goal:** A loadable extension that can call an OpenRouter model and stream a reply into a webview.Phase 1: Tool surface \+ the firewall

**Goal:** The model can propose actions; the harness validates and commits them. No direct mutation.Phase 2: Verification oracles

**Goal:** Wire real success signals the loop can check against (test, build, lint, typecheck).Phase 3: The goal loop (run-until-green)

**Goal:** The Codex-style autonomous loop. Iterate until the oracle is green or a budget cap hits.Phase 4: Auto-plan \+ todos \+ scratchpad (enforced)

**Goal:** Generate `PLAN.md`, `todos.json`, and `SCRATCHPAD.md` without the user asking.Phase 5: Reflection / self-critique loop

**Goal:** Harness-injected reflection so weak models recover from their own errors.Phase 6: Sub-agents (orchestrator → workers)

**Goal:** Isolated specialist agents (planner, implementer, reviewer, escalation) with partitioned context.Phase 7: Weak-model enablement

**Goal:** Structured-output enforcement, tool-call repair, and forced decomposition.Phase 8: Context engineering

**Goal:** Automatic compaction/summarization at a token threshold and file-system-as-memory.Phase 9: Eval harness \+ UX polish

**Goal:** Convert "carries weak models like Antigravity" into a number, and polish the surface.-----Global Acceptance Criteria

* All phase **DONE-WHEN** gates green, logged in `BUILD_LOG.md`.  
* `npm run eval` on a cheap OpenRouter model clears a target solve-rate.  
* Harness solve-rate strictly beats bare-model solve-rate on the same suite.  
* Every state mutation traces through propose→validate→commit.

tic software work, from SWE-agent’s finding that the agent-computer interface itself significantly changes performance, and from the fact that Codex, Claude Code, and Antigravity all enforce planning, task tracking, verification, and reusable repository guidance rather than acting like simple chat panes. 

The blunt recommendation is this: **build a success harness, not a model picker**. Your IDE should automatically turn a user request into a durable contract with a goal, context, constraints, explicit “done when” criteria, a task graph, checkpointed execution, verification evidence, and a loop that keeps going until the stopping condition is met or a real blocker is found. That is exactly the pattern Codex formalizes with /goal, plan-first workflows, AGENTS.md, review, and validation loops; Claude Code formalizes with plan mode, task tools, subagents, and memory; and Antigravity formalizes with Artifacts such as task lists, implementation plans, and walkthroughs. 

You should also be realistic about the ceiling. A strong harness can make weaker models **materially more successful**, especially on bounded repository tasks, but it will not make “mostly any model” perform like a frontier planner on hard long-horizon work. The better design is to use stronger models for planning and completion judgment, and cheaper or weaker models as narrow workers for search, summarization, log triage, and repetitive subtasks. OpenRouter’s own routing and server-tool stack now supports this kind of role specialization with coding routers, advisors, subagents, and multi-model deliberation. 

## What the strongest products are actually enforcing

**Codex** is enforcing a durable objective, not just a turn-by-turn chat. Its /goal workflow is specifically for long-running work with a **verifiable stopping condition**; OpenAI recommends that Codex know what “done” means, keep a progress log, run tests after checkpoints, and continue independently toward that end state. OpenAI’s best-practices guide pushes the same structure: give the agent a goal, relevant context, constraints, and a clear “done when,” then have it plan first, use repository-local guidance in AGENTS.md, run tests, review diffs, and use isolated worktrees for parallel work. OpenAI’s own engineering write-up goes even further: the hard part is designing environments, feedback loops, and control systems that let agents build reliable software at scale. 

**Claude Code** is enforcing structure around exploration, planning, progress tracking, memory, and concurrency. Anthropic documents plan mode as a read-only planning phase where Claude proposes a plan before editing; built-in Explore and Plan subagents keep repository exploration out of the main context window; task tracking is built into the Agent SDK through structured Task tools; and auto memory stores useful project knowledge such as build commands, debugging insights, architecture notes, and workflow habits across sessions. Claude Code also supports worktrees and parallel sessions so multiple runs do not collide. **Claude Cowork**, while broader than coding, is relevant because it extends the same design principle into autonomy: you give it a goal and it works across the computer, local files, and applications to return a finished deliverable. 

**Google Antigravity** is enforcing artifact-first visibility. Google describes it as an agentic development platform where agents autonomously **plan, execute, and verify** work across the editor, terminal, and browser. Google’s own Antigravity materials emphasize **Artifacts** as the unit of trust and legibility: task lists, implementation plans, walkthroughs, screenshots, and browser recordings. Antigravity also exposes **skills**, **rules**, and **workflows**, which means it treats repeatable behavior as reusable system structure rather than as one-off prompting. 

The common pattern across all three is the real lesson: **the software is enforcing cognition outside the model**. Plans are explicit. Tasks are explicit. Verification is explicit. Durable repo instructions are explicit. Progress is explicit. The best products are not trusting the model to spontaneously organize itself every time; they are giving it a scaffold that raises the floor. 

## The core agent loop you should build

At the centre of your IDE should be a persistent **goal loop**. The simplest correct mental model is: **contract → research → plan → execute → verify → reflect → continue or stop**. That structure is strongly aligned with Codex’s goal workflow and validation loop, Claude Code’s plan-first and subagent patterns, Antigravity’s artifact sequence, and the research literature on ReAct, Plan-and-Solve, Reflexion, Self-Refine, and tree-search-style test-time improvement. ReAct showed the value of interleaving reasoning and action; Plan-and-Solve showed gains from decomposing work into subtasks before execution; Reflexion and Self-Refine showed that iterative feedback can improve a model without retraining; and LATS demonstrated that extra test-time exploration can meaningfully raise agent performance. 

A practical version of that loop should persist six objects for every run:

* A **goal contract** with goal, context, constraints, done\_when, non\_goals, and budget. That mirrors Codex’s own recommended prompt structure and is the minimum viable contract for long-running work.   
* A **task graph** with statuses, dependencies, blockers, and ownership. Claude Code’s built-in Task tools and Antigravity’s task-list artifacts both point in this direction.   
* A **plan artifact** that is editable by the user before execution begins, like Claude Code’s plan mode and Antigravity’s implementation plan.   
* An **evidence ledger** that records the command, observation, diff, test result, and confidence for each checkpoint. Codex explicitly emphasizes citations, terminal logs, and test results as the basis for trust.   
* A **repository knowledge layer** with durable instructions, conventions, commands, and architecture notes. OpenAI’s AGENTS.md, Claude’s CLAUDE.md plus auto memory, and Antigravity’s rules and skills all converge on this.   
* A **skill registry** of reusable workflows for recurring jobs. Voyager’s skill library is the research analogue here, while Codex, Claude Code, and Antigravity all ship skills as reusable instruction packages. 

The most important design detail is your **agent-computer interface**. SWE-agent’s core claim is that interface design is not a side issue; a custom ACI materially improves the agent’s ability to search, navigate, edit, and execute within repositories. So your primary tools should be **repo-native and lossless**: semantic search, symbol search, file viewer, structured patch editor, shell command runner, test runner, diff inspector, task updater, and plan updater. Do not rely on generic browser-style automation for ordinary coding tasks if the same work can be done through clean repository tools. 

Your loop should also have **bounded self-repair**, not blind retries. When a checkpoint fails, the agent should write a concise failure summary, classify the error, update the relevant task, refine the plan if needed, and try again with a changed approach. That is the operational form of Reflexion and Self-Refine: learn from feedback at inference time instead of treating each attempt like a fresh start. 

A minimal state machine looks like this:

text  
Copy  
User request  
  → Build goal contract  
  → Research codebase  
  → Draft plan  
  → Create task graph  
  → Pick next unblocked task  
  → Execute in isolated worktree  
  → Run verification  
      → if pass: mark task complete  
      → if fail: write reflection, revise plan/task, retry within budget  
  → Stop only when done\_when is satisfied or a real blocker is raised  
  → Produce walkthrough and evidence bundle

That is much closer to how the strongest products operate than a chat loop that only reacts one turn at a time. 

## The OpenRouter first runtime

OpenRouter is a good default **provider layer** for this product because it already gives you a unified, OpenAI-compatible surface across many models, plus routing, fallbacks, tool calling, structured outputs, caching, and observability. Its Responses API is a drop-in replacement for OpenAI’s Responses API, but it is **stateless**, which means your IDE should own orchestration state, artifacts, memory, and run history in your own backend rather than expecting the provider to persist them for you. 

For the default coding path, I would not use a single fixed model slug. I would use an **OpenRouter policy**:

* Use openrouter/pareto-code for primary coding turns so the system always routes to a strong coding model without you hard-coding one vendor forever. Its design is explicitly tuned for coding and lets you set a minimum coding-quality bar.   
* Use openrouter/auto for non-coding or mixed tasks where prompt complexity varies more, because it selects among curated models based on prompt complexity, task type, and capabilities.   
* Use session\_id on every run so the same conversation or workflow sticks to the same provider and chosen route, maximising cache hits and reducing model churn across turns. On OpenRouter, sticky routing and prompt caching are explicitly designed for multi-turn agentic workflows.   
* Use **model fallbacks** so rate limits, downtime, or moderation edge cases do not kill long-running tasks.   
* Use **structured outputs** for your plan, task graph, evidence bundle, and final walkthrough schemas so the app gets deterministic, type-safe artifacts rather than fragile free text.   
* Opt into **router metadata** so you can see which provider was chosen, whether compression or retries happened, and how routing decisions affected outcomes. That data is operationally valuable when you tune success rates. 

Tool reliability matters even more than raw model IQ in a coding agent, so exploit OpenRouter’s routing features for tool use. OpenRouter standardizes tool calling across models, and Auto Exacto reorders providers for tool-using requests based on throughput, tool-calling success rates, and benchmark signals. That is directly relevant for an IDE because nearly every meaningful coding action is tool-mediated. 

You should still keep the **core tools app-owned**, not provider-owned. In other words, let OpenRouter normalize model access, but keep your essential coding tools under your own control. A good initial tool surface is: repo\_search, symbol\_search, read\_file, read\_range, write\_file, apply\_patch, run\_command, run\_tests, get\_diff, update\_tasks, update\_plan, and record\_evidence. OpenRouter’s tool-calling standard makes this portable across models, and its server tools can be layered on top when they add value. 

Then add OpenRouter’s **server tools** selectively:

* **Advisor** when the executor is stuck, before it commits to an approach, or before it declares completion. This is an elegant way to give cheaper workers controlled access to stronger judgment.   
* **Subagent** for bounded chores such as “summarize these logs” or “inspect likely files for auth flow.” This lets you keep the main context clean and inexpensive.   
* **Fusion** for high-stakes planning or review turns where multiple-model deliberation is worth the extra cost.   
* **Apply Patch** if you want the provider-side diff to follow a validated patch format before your app applies it.   
* **Web Search** only when the task genuinely needs current external documentation or package information. 

A strong default request shape looks like this:

json  
Copy  
{  
  "model": "openrouter/pareto-code",  
  "session\_id": "run\_7f2c4",  
  "models": \[  
    "openrouter/pareto-code",  
    "openrouter/auto"  
  \],  
  "tools": \[  
    {"type": "function", "function": {"name": "repo\_search", "parameters": {}}},  
    {"type": "function", "function": {"name": "read\_file", "parameters": {}}},  
    {"type": "function", "function": {"name": "apply\_patch", "parameters": {}}},  
    {"type": "function", "function": {"name": "run\_tests", "parameters": {}}},  
    {"type": "function", "function": {"name": "update\_tasks", "parameters": {}}},  
    {"type": "function", "function": {"name": "update\_plan", "parameters": {}}},  
    {"type": "openrouter:advisor", "name": "senior\_reviewer"}  
  \],  
  "response\_format": {  
    "type": "json\_schema",  
    "json\_schema": { "name": "agent\_turn", "strict": true, "schema": {} }  
  }  
}

The important part is not the exact JSON. The important part is that OpenRouter becomes your **model and routing substrate**, while your IDE remains the owner of goals, plans, tasks, evidence, and stop conditions. 

## The user experience contract

If you want a triple-A experience, the plan and task system should **appear automatically**, not only when a power user asks for it. Codex, Claude Code, and Antigravity all point the same way: the strongest agentic products reduce hidden chaos by surfacing just enough structure for trust. Your IDE should therefore auto-generate a goal contract, task list, implementation plan, and final walkthrough for any non-trivial request. The user should be able to ignore the mechanics when everything is going well, but the structure should always be there. 

The core surfaces should be very opinionated. Show the user: the current goal, the active checkpoint, the task graph, the latest diff, the latest test status, the blocker if one exists, and the evidence bundle that justifies completion. Codex explicitly leans on citations, terminal logs, and test results; Claude Code opens plans for review before changes touch disk and lets users review and comment on diffs; Antigravity turns plans and walkthroughs into first-class artifacts. That suggests a product rule: **artifacts matter more than transcript volume**. 

You should also support **inline steering without context collapse**. That means user comments on a plan or diff should update the task graph and next checkpoint, not restart the whole run in an unstructured way. Codex recommends keeping one thread per coherent unit of work, using AGENTS.md for durable guidance, and forking only when work truly branches. Claude Code similarly separates exploration into subagents and supports isolated worktrees for concurrent sessions. 

Parallelism should be built around **worktrees plus subagents**, not multiple agents editing the same checkout. OpenAI’s Codex app uses isolated worktrees and reviewable diffs for parallel agents, and Claude Code’s worktree guidance says the same thing: each session should have its own branch and working directory so edits do not collide. If you want the illusion of many agents, give them separate workspaces and make the lead agent merge results through review rather than concurrent shared editing. 

Finally, make repository-local knowledge the **system of record**. OpenAI’s internal Codex team says that from the agent’s point of view, what is not accessible in context effectively does not exist, and they moved more and more knowledge into the repository as versioned artifacts. So your IDE should unify the cross-vendor pattern into one convention: one repo-local rules file, one commands file, one architecture file, and one skills directory. You can support imports from AGENTS.md, CLAUDE.md, and Antigravity-style rules, but your product should normalize them into a single internal knowledge graph. 

## Evaluation and shipping plan

Do **not** evaluate this product only by subjective “it feels smart” demos. Use a layered eval stack. Public benchmarks are useful, but your own repository-realistic evals will matter more because OpenAI’s own experience says success is highly dependent on repository structure, tools, and feedback loops. 

For public evaluation, the obvious starting points are **SWE-bench**, **SWE-bench Verified**, and **SWE-bench Multimodal** if you care about UI-heavy work. SWE-bench is designed around real GitHub issues and patch generation; Verified is a human-filtered subset built to more reliably evaluate real-world software issue resolution; and the Multimodal extension adds issues with screenshots, design mockups, and other visual elements. If you later expand into browser or desktop control, add **WebArena** and **OSWorld** style tests, because they measure longer-horizon interactive execution rather than repository-only reasoning. 

For product evaluation, track at least these metrics on your own repos: task success rate, time to first correct diff, time to green tests, number of retries, number of human interventions, rework after merge, cost per resolved task, and the fraction of completions backed by evidence that actually withstands human review. Claude Code exposes task and cost observability; OpenRouter supports session\_id, user, metadata, and router metadata; and Codex’s own practice is to fold testing and review into the default loop. 

If I were sequencing the build, I would do it in three releases.

* **Founding release.** Ship the repo-native harness: goal contract, plan mode, task graph, structured artifacts, worktrees, checkpoints, tests, and diff review. Use OpenRouter as the provider layer, but keep the tool surface small and deterministic. This is the release that raises the floor.   
* **Quality release.** Add reflection loops, repo memory, skills, advisor escalation, model routing policies, and detailed telemetry. This is where weaker models start feeling much better because the system is doing more of the organisational work.   
* **Triple-A release.** Add multi-agent composition, automatic cleanup and refactoring jobs, multimodal verification for UI tasks, and richer artifact review. This is where you begin to rival the trust and throughput of the current leaders rather than merely matching their basic chat UX. 

The single biggest design decision is this one: **treat every coding run as a controlled process with explicit state and evidence, not as a sequence of clever completions**. Codex, Claude Code, and Antigravity all converge on that. OpenRouter is already capable of being the default model and routing substrate for such a system. Your job is to build the harness that makes success repeatable. 

# Claude research

Technical Blueprint: A AAA-Quality AI Coding IDE Forked from Code-OSS with an Enforced-Success Agent Harness  
TL;DR  
The thesis is correct and the architecture should be built around it: leading agentic coding tools win because the software harness enforces success-driving structures (autonomous verify-iterate loops, auto-generated plans/todos, scratchpad memory, sub-agent isolation, structured-edit formats) that the model never has to be asked for. The cleanest proof point: an unchanged GPT-4o went from 16% to 33.2% on SWE-bench Verified purely by swapping in the Agentless scaffold, and Aider's unified-diff edit format made GPT-4 Turbo "3X less lazy" (20% → 61%) with no model change.  
Build it as five layers — IDE shell (Code-OSS fork) / agent harness (the loop \+ firewall \+ verification gates) / provider layer (OpenRouter-default, capability-detecting) / tool layer (MCP \+ native file/shell/edit tools) / verification layer (tests, type-check, lint, build as deterministic oracles). The harness — not the model — owns correctness via a propose→validate→commit→narrate firewall that maps directly to your "deterministic rules engine owns state, LLM is a bounded proposal layer" philosophy.  
Make weak models succeed with three enforced mechanisms: (1) grammar-constrained / schema-validated tool calls with a repair loop (per the XGrammar-2 paper, constrained decoding took Llama-3.2-3B's JSON-schema validity from 40.70% to 100.00% and let it beat an unconstrained Llama-3.1-70B on BFCL); (2) context-anchored V4A-style diff edits instead of line-numbered diffs; (3) forced decomposition so the model only ever faces one small, machine-verifiable step, carried to completion by a Codex-style "run until green" loop with hard step/budget caps.  
Key Findings  
1\. The "agent loop" is universally a simple while-loop, and that simplicity is a feature. Claude Code's master loop (internally codenamed "nO") is a single-threaded while(tool\_use) loop: the model produces a message; if it contains a tool call, execute it and feed the result back; if not, stop and return to the user. OpenAI's Codex harness is the same shape — inference → tool call → execute → append observation → repeat until the model emits an assistant message with no tool calls (one "turn"). Every production coding agent (Claude Code, Codex, Cline, Roo, Aider, OpenHands) converges on this ReAct-style think→act→observe cycle. Complexity lives in the layers around the loop, not the loop.  
2\. The "enforced success" layer is real and catalogable. Each leading tool ships specific mechanisms the user never requests:  
Codex /goal — a persistent objective that makes the agent auto-continue across turns until the goal is met or a budget cap hits, with a safety mechanism that suppresses continuation turns producing no tool calls (anti-spinning).  
Antigravity Artifacts — agents auto-generate Task Lists, Implementation Plans, Walkthroughs, screenshots, and browser recordings, plus a persistent Knowledge Base, without the user asking. The model decides when an artifact is warranted (simple typo → skip plan; refactor auth → generate full implementation plan).  
Claude Code TodoWrite — structured JSON task lists auto-created for multi-step work, re-injected into context after tool calls as system reminders so the model can't lose the thread.  
Kimi Code sub-agents — built-in coder, explore, and plan sub-agent types (plus configurable custom ones like a reviewer) launched via an Agent tool, each in isolated context, prohibited from nesting (only the root agent can spawn).  
3\. Verification is what carries weak models to success. Codex's codex-1 was explicitly trained to "run tests and iterate until they pass." Reflexion (Shinn et al., NeurIPS 2023\) formalizes this: an Actor produces a trajectory, an Evaluator (which "may be...an external execution environment such as code unit tests") judges pass/fail, and a Self-Reflector turns failures into verbal guidance for the next attempt. The harness must wire test runners, type checkers, linters, and compilers as automatic oracles — the loop checks against them, not against the model's self-assessment.  
4\. Context engineering is non-optional for long tasks. Anthropic's three primitives: compaction (summarize near the window limit, e.g. Claude Code's auto-compact at \~92–98%), structured note-taking (write to a claude-progress.txt/NOTES.md outside the window, read back after reset), and sub-agent isolation (each sub-agent gets its own window; only a summary returns to the lead). Per Anthropic's "How we built our multi-agent research system," agents "typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats," and "token usage alone explains 80% of the performance variance" — so isolation is a deliberate cost/quality tradeoff, not a free win. That same system's Opus-4-lead/Sonnet-4-subagent design "outperformed single-agent Claude Opus 4 by 90.2%."  
5\. Edit-format mechanics matter more than model size for reliability. Codex uses a V4A "apply\_patch" format that locates edits by surrounding context rather than line numbers. Aider's data shows edit format alone swings the same model by 10–40 points, and that the right format must be matched to model capability.  
Details  
1\. Architecture Overview — The Five Layers  
Code  
The design principle that ties this to your philosophy: the harness and verification layers are deterministic and own all state mutations; the LLM is confined to the proposal step. The model proposes a tool call or an edit; the harness validates it (schema-valid? in-scope? does the patch apply? do tests still pass?); only validated proposals mutate state; the model then narrates what happened. The model is a bounded narrative/proposal layer wrapped in a deterministic rules engine — exactly the firewall you favor.  
2\. The Agent Harness Deep-Dive (the meatiest section)  
2.1 The Master Loop  
Implement a single-threaded while(tool\_use) loop, following Claude Code's "nO" pattern and Codex's turn model. Per turn: assemble prompt (system \+ tools \+ history \+ injected state) → inference → if response contains tool calls, execute and append observations, repeat; if response is text-only, the turn ends. Keep one flat message history for the main agent for debuggability; isolate noise into sub-agents. Add an async steering queue (Claude Code's "h2A" dual-buffer) so the user can inject instructions mid-loop without restarting.  
Termination and anti-spinning. Borrow from both Claude Code (cap with max\_turns counting tool-use turns and max\_budget\_usd) and Codex /goal (auto-continue until goal met or budget-limited, with a safety mechanism that suppresses repeated continuations when turns produce no tool calls). Concretely:  
Hard caps: max tool-use turns, max wall-clock, max USD spend (read from OpenRouter usage accounting per response).  
Progress detector: if N consecutive turns produce no state mutation (no successful edit, no new passing test), break and escalate to the user or a reflection step.  
Goal object: a persistent {objective, status, tokens\_used, budget} that survives compaction; the plan is the "how" and can be rewritten, the goal is the durable "what."  
2.2 The Propose → Validate → Commit → Narrate Firewall  
This is the core of "the harness owns correctness." Every model action passes four deterministic gates:  
Propose — the model emits a structured tool call (edit, command, plan update). This is the only place the LLM has agency.  
Validate — deterministic checks run before any mutation:  
Schema validation of the tool call (JSON-schema / grammar; reject+repair if malformed).  
Scope validation (is this file/path in the allowed working set? Claude Code routes proposed bash commands to a cheap fast model — Haiku — to extract which paths a command reads/modifies and decide whether approval is needed; replicate with a deterministic parser plus optional cheap-model classifier).  
Edit applicability (does the patch's context actually match the file? if not, reject before writing).  
Commit — only validated proposals mutate state. Wrap every commit in a checkpoint (git commit or VS Code checkpoint) so it's reversible. Aider's model — auto-commit every AI edit with a generated message, /undo to revert  (Ggprompts) — is the reference.  
Narrate — the model describes what it did after the deterministic layer has already recorded the truth. The narration is for the human; it is never the source of truth about state.  
This inverts the usual trust model: the model never directly writes to disk or declares success. The verification layer declares success; the model narrates it.  
2.3 Verification-Driven Development  
Wire deterministic oracles as first-class tools the loop calls automatically (not only when asked):  
Test runner (pytest/jest/go test/cargo test — detect from project files).  
Type checker (tsc, mypy, pyright).  
Linter / formatter (eslint, ruff, gofmt).  
Compiler / build (the ultimate oracle for compiled languages).  
After every edit-commit, the harness automatically runs the relevant subset (Cline already "monitors linter and compiler errors as it works, fixing issues like missing imports, type mismatches, and syntax errors"). A failing oracle is not a stop condition — it's a new observation fed back into the loop (Reflexion's "failure becomes part of the reasoning loop"). This is precisely how a weaker model is carried to success: it never has to be right, only to converge under deterministic feedback. The machine-verifiable signals (tests pass, build succeeds, type-check clean, lint clean) are the loop's success oracle; the loop runs until they're green or a budget cap trips.  
For tasks lacking a test suite, generate one first (Reflexion's programming variant uses Chain-of-Thought to produce a unit-test suite, filters for syntactically valid tests via AST construction, then iterates against it). Antigravity's browser-recording verification is the analog for UI work — the harness verifies by driving the app, not by trusting the model.  
2.4 Context Engineering  
Implement Anthropic's three primitives plus file-system-as-memory:  
Compaction: at \~90–92% window usage, summarize the trajectory with a cheap model (Claude Code uses Haiku for summarization), preserving architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs; reinitialize with summary \+ the most-recently-accessed files. Tune the compaction prompt for recall first, then precision.  
Structured note-taking / scratchpad: a progress.txt / NOTES.md written to disk outside the window. Anthropic's long-running-agent harness uses an initializer agent (first context window sets up the environment and writes the durable context) plus a coding agent (every later session makes incremental progress and leaves structured updates)  (Anthropic) — this plus git history lets a fresh window understand state instantly. This directly maps to Antigravity's auto-generated Knowledge Base / Knowledge Items.  
Tool-result clearing: clear large historical tool outputs once they're stale (Anthropic's cookbook clear\_at\_least / trigger/keep parameters), but be aware clearing invalidates cached prompt prefixes.  
Sub-agent isolation: spawn sub-agents with their own windows; only a compact summary returns to the lead. This is the highest-leverage lever for keeping the main context lean.  
Note Anthropic's caution: harnesses "encode assumptions about what the model can't do," and those go stale — context resets that helped Sonnet 4.5's "context anxiety" became "dead weight" on Opus 4.5. Make these mechanisms configurable/toggleable per model tier.  
2.5 Multi-Agent Orchestration  
Use the orchestrator-worker pattern, bounded:  
Roles: planner/architect, implementer/coder, reviewer, explorer (read-only codebase search), and an escalation/"elevated-response" agent that re-runs a failed subtask on a stronger model. This mirrors Kimi's built-in coder/explore/plan sub-agents plus configurable reviewers,  (Kimi) and Roo Code's mode system (Architect/Code/Debug/Ask, each with its own prompt and tool allowlist).  
Depth limit: enforce that sub-agents cannot spawn sub-agents (Kimi prohibits nesting the Agent tool;  (Kimi) Claude Code's I2A/Task agents have strict depth limits to prevent recursive proliferation). Only the root orchestrates.  
Context partitioning: each sub-agent gets a narrow task and its own window; results merge as summaries into the orchestrator (Anthropic's multi-agent researcher: subagents explore in parallel with isolated windows, lead synthesizes — a design that beat single-agent Opus 4 by 90.2% on their research eval).  
When NOT to: for tightly-coupled sequential work, a single agent is cheaper and better (each sub-agent re-pays for its own context, and multi-agent runs cost \~15× chat-level tokens). Reserve parallelism for independent subtasks.  
A cost-effective default borrowed from Aider's "architect mode": a strong/expensive model plans (architect), a cheap/fast model executes the edits (editor). You pay frontier rates only for the reasoning step. This is a natural fit for an OpenRouter backend where you can route the two roles to different models.  
2.6 Tool-Use Design  
Surface: keep it small and orthogonal (Claude Code ships \~14 tools; the open-source claw-code rewrite, 18). Core set: read\_file, edit\_file (context-diff), write\_file, grep, glob, ls, bash, plus control-flow tools todo\_write and spawn\_agent, plus web\_search/web\_fetch. Split tools by permission (bash needs approval; glob/grep/ls don't).  
Schema as contract: pass JSON-schema to the model; decouple the LLM from implementation via a registry → dispatcher → implementation three-layer structure.  
Tool-call repair/retry for weak models — see §4.  
2.7 Plan & Todo Generation (enforced, not requested)  
The harness injects planning. On receiving a multi-step task, force a planning step that produces a structured plan artifact before any edits (Antigravity auto-generates an Implementation Plan for complex tasks; Claude Code's first move on multi-step work is often TodoWrite). Persist plans/todos to disk and re-inject the current todo state as a system reminder after each tool call so the model can't drift (Claude Code's exact mechanism). Render them in the IDE as interactive checklists / review panes (Antigravity's Manager surface \+ auxiliary pane).  
3\. The "Enforced Success" Mechanisms Catalog  
Mechanism  
Source exemplar  
How to implement in the harness  
Goal/run-until-success loop  
Codex /goal  
Persistent goal object; auto-continue turns until verification oracle is green or budget cap; suppress no-tool-call continuations to prevent spinning.  
Auto-generated implementation plan  
Antigravity Implementation Plan  
Force a planning sub-step on complex tasks (heuristic: \>N files or \>N estimated steps); emit a structured plan artifact to disk \+ review pane.  
Task list / todos  
Claude Code TodoWrite  
todo\_write tool producing JSON {id, content, status, priority}; re-inject state after each tool call; render as checklist.  
Scratchpad / knowledge artifacts  
Antigravity Knowledge Base; Anthropic progress.txt  
Disk-persisted NOTES.md \+ Knowledge Items; initializer agent writes durable context; coding agent appends incremental updates.  
Reflection / self-critique  
Reflexion; self-refine  
On oracle failure, inject a forced reflection turn: "given this failure, diagnose and propose the next attempt." Cap reflection rounds (e.g. 5).  
Decomposition  
Plan-execute; Agentless  
Break the task into units each verifiable by a single oracle run; the model only ever faces one small step.  
Sub-agents (reviewer, explorer, escalation)  
Kimi sub-agents; Roo modes  
Orchestrator spawns role-scoped, context-isolated, non-nesting sub-agents; results merge as summaries; escalation agent retries on a stronger model.  
Deterministic edit application  
Codex apply\_patch; Aider  
Context-anchored diff application with fuzzy matching; reject-before-write if context doesn't match.  
4\. Making Weak Models Succeed  
This is where the harness earns its keep. The evidence that scaffolding (not model size) drives success:  
Scaffold doubled an unchanged model: GPT-4o went from 16% to 33.2% on SWE-bench Verified by switching to the Agentless scaffold (OpenAI, "Introducing SWE-bench Verified," Aug 2024).  
Edit format made GPT-4 Turbo "3X less lazy": per Aider's "Unified diffs make GPT-4 Turbo 3X less lazy," GPT-4 Turbo scored only 20% baseline with SEARCH/REPLACE blocks; the unified-diff format raised it to 61%, cutting lazy-comment tasks from 12 to 4\. Older gpt-4-0613 rose 26%→59%.  
Constrained decoding rescued small models: per the XGrammar-2 paper (arXiv:2601.04426, Table 5), grammar constraints took Llama-3.2-3B's JSON-schema validity from 40.70% to 100.00% and its BFCL-v3 correct-call rate from 33.12% to 77.75%, "enabl\[ing\] Llama-3.2-3B to outperform an unconstrained Llama-3.1-70B baseline on BFCL" (the unconstrained 70B scored 45.60%). Separately, the SLOT work (arXiv:2505.04016) reports a fine-tuned Mistral-7B \+ XGrammar reaching "99.5% schema accuracy and 94.0% content similarity... outperforming Claude-3.5-Sonnet by \+25 and \+20 percentage points," with Llama-3.2-1B \+ SLOT \+ XGrammar hitting 96.2% schema accuracy.  
Implement, in priority order:  
Structured-output enforcement with repair loop. Use OpenRouter's response\_format: {type: 'json\_schema'} and tool\_choice: 'required' where supported. For models/providers that lack native structured output, fall back to: (a) prompt-level schema \+ (b) a deterministic validator \+ (c) a repair loop ("your last tool call was invalid JSON / violated schema X; re-emit only the corrected call"). For local models, run grammar-constrained decoding directly (XGrammar/llguidance/Outlines as logit processors; XGrammar caches compiled grammars to amortize cost).  (Let's Data Science) Critical caveat from Aider's data: forcing a hard structured format on a weak model can backfire — GPT-3.5 produced worse code via the function-calling API and "frequently mangled" it. So: match format strictness to capability, and prefer constrained decoding (token-level guarantee) over function-API coercion for the weakest models.  
Context-anchored edit format. Adopt Codex's V4A apply\_patch format. Its literal envelope is \*\*\* Begin Patch … \*\*\* End Patch, with \*\*\* Add File:, \*\*\* Delete File:, \*\*\* Update File: (optionally \*\*\* Move to:) headers, @@ context headers carrying an optional label (e.g. @@ def greet():) rather than line numbers, and \+/-/  (space) hunk lines, terminated optionally by \*\*\* End of File. It shows 3 lines of context above/below each change and uses only relative paths. (Note: the \*\*\_ Begin Patch rendering some docs show is a OpenRouter First Blueprint for a Success Driven AI Coding IDEBottom Line

The highest-probability path is **not** “pick the best default model.” It is **build the best harness**. My estimate is that roughly **65%** of the gap between an average AI IDE and a top-tier one comes from harness design, **25%** from repository and tool ergonomics, and only **10%** from raw model choice.

This is inferred from:

* OpenAI’s description of “harness engineering” as the core problem in agentic software work.  
* SWE-agent’s finding that the agent-computer interface significantly changes performance.  
* The fact that Codex, Claude Code, and Antigravity all enforce planning, task tracking, verification, and reusable repository guidance rather than acting like simple chat panes.

The recommendation is to **build a success harness, not a model picker**. Your IDE should automatically turn a user request into a durable contract with:

* A goal, context, and constraints.  
* Explicit “done when” criteria.  
* A task graph, checkpointed execution, and verification evidence.  
* A loop that continues until the stopping condition is met or a blocker is found.

\-----What the Strongest Products Are Actually EnforcingCodex

Codex enforces a durable objective, not just a turn-by-turn chat. Its `/goal` workflow is specifically for long-running work with a **verifiable stopping condition**. OpenAI recommends that Codex keep a progress log, run tests after checkpoints, and continue independently toward that end state.Claude Code

Claude Code enforces structure around exploration, planning, progress tracking, memory, and concurrency:

* **Plan mode:** A read-only phase where Claude proposes a plan before editing.  
* **Explore and Plan subagents:** Keeps repository exploration out of the main context window.  
* **Structured Task tools:** Task tracking built into the Agent SDK.  
* **Auto memory:** Stores useful project knowledge (build commands, debugging insights, architecture notes) across sessions.  
* **Worktrees:** Supports parallel sessions so runs do not collide.

Google Antigravity

Google Antigravity enforces artifact-first visibility. It treats repeatable behavior as reusable system structure rather than one-off prompting:

* **Artifacts as unit of trust:** Task lists, implementation plans, walkthroughs, screenshots, and browser recordings.  
* **Skills, rules, and workflows:** Explicitly exposes these as reusable components.

\-----The Core Agent Loop

At the center of your IDE should be a persistent **goal loop**. The simplest mental model is: **contract → research → plan → execute → verify → reflect → continue or stop**.

A practical version of that loop should persist six objects for every run:

1. **Goal contract:** Includes goal, context, constraints, `done_when`, non-goals, and budget.  
2. **Task graph:** Includes statuses, dependencies, blockers, and ownership.  
3. **Plan artifact:** Editable by the user before execution begins.  
4. **Evidence ledger:** Records the command, observation, diff, test result, and confidence for each checkpoint.  
5. **Repository knowledge layer:** Durable instructions, conventions, commands, and architecture notes (e.g., `AGENTS.md`).  
6. **Skill registry:** Reusable workflows for recurring jobs.

\-----The OpenRouter First Runtime

OpenRouter is an ideal provider layer due to its unified, OpenAI-compatible surface. However, because it is **stateless**, your IDE must own the orchestration state, artifacts, memory, and run history.

**Recommended Policy:**

* Use `openrouter/pareto-code` for primary coding turns.  
* Use `openrouter/auto` for non-coding or mixed tasks.  
* Use `session_id` to maximize cache hits and reduce model churn.  
* Use **model fallbacks** to prevent rate limits or downtime from killing tasks.  
* Use **structured outputs** for deterministic, type-safe artifacts.

\-----Claude Research: Technical BlueprintKey Findings

* **The "agent loop" is a simple while-loop:** Claude Code's "nO" pattern and OpenAI's Codex harness are both single-threaded `while(tool_use)` loops. Complexity lives in the layers *around* the loop.  
* **The "enforced success" layer:** Leading tools ship specific mechanisms the user never requests, such as persistent objectives, auto-generated task lists, sub-agent isolation, and scratchpad memory.  
* **Verification is the carrier:** Weak models succeed when harnessed to deterministic oracles (test runners, type checkers, linters). The loop checks against these, not the model's self-assessment.  
* **Context engineering is non-optional:** Use compaction, structured note-taking (e.g., `NOTES.md`), and sub-agent isolation.  
* **Edit-format mechanics:** Using context-anchored edits (rather than line numbers) significantly improves reliability for weaker models.

The Five Layers

1. **IDE Shell:** Code-OSS fork.  
2. **Agent Harness:** The loop, firewall, and verification gates.  
3. **Provider Layer:** OpenRouter-default, capability-detecting.  
4. **Tool Layer:** MCP \+ native file/shell/edit tools.  
5. **Verification Layer:** Tests, type-check, lint, build as deterministic oracles.

\-----Gemini Research: Systems Architecture Blueprint

The design requires a departure from reactive chat interfaces. To achieve high operational efficiency, the system must act as an autonomous command center.

**Core Requirements:**

* **Autonomous Command Center:** Orchestrates complex, multi-turn software modifications.  
* **Verification:** Verifies code changes against local system signals.  
* **State Management:** Maintains execution state without depending on heavy external drivers.  
* **Background Managers:** Spawns, tracks, and aligns multiple parallel actions (as seen in Google Antigravity).

\-----Blueprint: OpenRouter Agent Harness — VS Code Extension0. Build Directive

This is a **goal-driven build directive**. The project is decomposed into ordered phases. Each phase has a **DONE-WHEN** block containing only machine-verifiable gates.

**The Design Law (The Firewall):**`PROPOSE → VALIDATE → COMMIT → NARRATE`

1. **Propose:** The LLM only ever proposes a structured action.  
2. **Validate:** A deterministic validator owns the decision to accept or reject.  
3. **Commit:** Applies the validated change to disk/state.  
4. **Narrate:** Explains what happened. It cannot change state.

Phase Breakdown

* **Phase 0: Extension skeleton \+ provider layer**  
  * **Goal:** A loadable extension that can call an OpenRouter model and stream a reply into a webview.  
* **Phase 1: Tool surface \+ the firewall**  
  * **Goal:** The model can propose actions; the harness validates and commits them. No direct mutation.  
* **Phase 2: Verification oracles**  
  * **Goal:** Wire real success signals the loop can check against (test, build, lint, typecheck).  
* **Phase 3: The goal loop (run-until-green)**  
  * **Goal:** The Codex-style autonomous loop. Iterate until the oracle is green or a budget cap hits.  
* **Phase 4: Auto-plan \+ todos \+ scratchpad (enforced)**  
  * **Goal:** Generate `PLAN.md`, `todos.json`, and `SCRATCHPAD.md` without the user asking.  
* **Phase 5: Reflection / self-critique loop**  
  * **Goal:** Harness-injected reflection so weak models recover from their own errors.  
* **Phase 6: Sub-agents (orchestrator → workers)**  
  * **Goal:** Isolated specialist agents (planner, implementer, reviewer, escalation) with partitioned context.  
* **Phase 7: Weak-model enablement**  
  * **Goal:** Structured-output enforcement, tool-call repair, and forced decomposition.  
* **Phase 8: Context engineering**  
  * **Goal:** Automatic compaction/summarization at a token threshold and file-system-as-memory.  
* **Phase 9: Eval harness \+ UX polish**  
  * **Goal:** Convert "carries weak models like Antigravity" into a number, and polish the surface.

Global Acceptance Criteria

* All phase **DONE-WHEN** gates green, logged in `BUILD_LOG.md`.  
* `npm run eval` on a cheap OpenRouter model clears a target solve-rate.  
* Harness solve-rate strictly beats bare-model solve-rate on the same suite.  
* Every state mutation traces through propose→validate→commit.

Markdown-italics artifact of the three asterisks; the true token is \*\*\*.) Why this beats unified diffs and line-number edits for weak models: location is determined by matching surrounding context, not by arithmetic the model gets wrong — eliminating off-by-one hunk-header errors, the single most common patch failure. Make application lenient (tolerate whitespace drift). For the weakest models, fall back to whole-file rewrite (Aider auto-selects whole-file for lesser-known models because it's the easiest format to emit). Optionally implement a Cursor-style two-stage edit: a planning model emits the change sketch, a fast "apply" model merges it deterministically into the file. Per Cursor's "Editing Files at 1000 Tokens per Second," their Llama-3-70b fine-tune achieves "\>1000 tokens/s (just under 4000 char/s)... a \~13x speedup over vanilla inference using Llama-3-70b and a \~9x speedup over our previous GPT-4 speculative edits deployment" via a deterministic-draft "speculative edits" algorithm (deployed on Fireworks) — but the reliability comes from the deterministic merge, not the speed.  
Forced decomposition. The harness breaks any non-trivial task into units each verifiable by one oracle run, so the weak model only ever faces a small, checkable step. This is the Agentless insight and the plan-execute pattern.  
Forced reflection on failure. On

# Gemini research

Systems Architecture Blueprint for an Autonomously Verifying AI-Native IDE  
Orchestration Archetypes and the Autonomous IDE Core  
The design of a software development environment designed to run natively on the OpenRouter gateway requires a departure from standard, reactive chat interfaces. To achieve a high level of operational efficiency that matches or exceeds contemporary development solutions like Google Antigravity, Claude Code, and Codex Desktop, the system must act as an autonomous command center. This environment must orchestrate complex, multi-turn software modifications, verify code changes against local system signals, OpenRouter First Blueprint for a Success Driven AI Coding IDEBottom Line

The highest-probability path is **not** “pick the best default model.” It is **build the best harness**. My estimate is that roughly **65%** of the gap between an average AI IDE and a top-tier one comes from harness design, **25%** from repository and tool ergonomics, and only **10%** from raw model choice.

This is inferred from:

* OpenAI’s description of “harness engineering” as the core problem in agentic software work.  
* SWE-agent’s finding that the agent-computer interface significantly changes performance.  
* The fact that Codex, Claude Code, and Antigravity all enforce planning, task tracking, verification, and reusable repository guidance rather than acting like simple chat panes.

The recommendation is to **build a success harness, not a model picker**. Your IDE should automatically turn a user request into a durable contract with:

* A goal, context, and constraints.  
* Explicit “done when” criteria.  
* A task graph, checkpointed execution, and verification evidence.  
* A loop that continues until the stopping condition is met or a blocker is found.

What the Strongest Products Are Actually EnforcingCodex

Codex enforces a durable objective, not just a turn-by-turn chat. Its `/goal` workflow is specifically for long-running work with a **verifiable stopping condition**. OpenAI recommends that Codex keep a progress log, run tests after checkpoints, and continue independently toward that end state.Claude Code

Claude Code enforces structure around exploration, planning, progress tracking, memory, and concurrency:

* **Plan mode:** A read-only phase where Claude proposes a plan before editing.  
* **Explore and Plan subagents:** Keeps repository exploration out of the main context window.  
* **Structured Task tools:** Task tracking built into the Agent SDK.  
* **Auto memory:** Stores useful project knowledge (build commands, debugging insights, architecture notes) across sessions.  
* **Worktrees:** Supports parallel sessions so runs do not collide.

Google Antigravity

Google Antigravity enforces artifact-first visibility. It treats repeatable behavior as reusable system structure rather than one-off prompting:

* **Artifacts as unit of trust:** Task lists, implementation plans, walkthroughs, screenshots, and browser recordings.  
* **Skills, rules, and workflows:** Explicitly exposes these as reusable components.

\-----The Core Agent Loop

At the center of your IDE should be a persistent **goal loop**. The simplest mental model is: **contract → research → plan → execute → verify → reflect → continue or stop**.

A practical version of that loop should persist six objects for every run:

1. **Goal contract:** Includes goal, context, constraints, `done_when`, non-goals, and budget.  
2. **Task graph:** Includes statuses, dependencies, blockers, and ownership.  
3. **Plan artifact:** Editable by the user before execution begins.  
4. **Evidence ledger:** Records the command, observation, diff, test result, and confidence for each checkpoint.  
5. **Repository knowledge layer:** Durable instructions, conventions, commands, and architecture notes (e.g., `AGENTS.md`).  
6. **Skill registry:** Reusable workflows for recurring jobs.

The OpenRouter First Runtime

OpenRouter is an ideal provider layer due to its unified, OpenAI-compatible surface. However, because it is **stateless**, your IDE must own the orchestration state, artifacts, memory, and run history.

**Recommended Policy:**

* Use `openrouter/pareto-code` for primary coding turns.  
* Use `openrouter/auto` for non-coding or mixed tasks.  
* Use `session_id` to maximize cache hits and reduce model churn.  
* Use **model fallbacks** to prevent rate limits or downtime from killing tasks.  
* Use **structured outputs** for deterministic, type-safe artifacts.

\-----Claude Research: Technical BlueprintKey Findings

* **The "agent loop" is a simple while-loop:** Claude Code's "nO" pattern and OpenAI's Codex harness are both single-threaded `while(tool_use)` loops. Complexity lives in the layers *around* the loop.  
* **The "enforced success" layer:** Leading tools ship specific mechanisms the user never requests, such as persistent objectives, auto-generated task lists, sub-agent isolation, and scratchpad memory.  
* **Verification is the carrier:** Weak models succeed when harnessed to deterministic oracles (test runners, type checkers, linters). The loop checks against these, not the model's self-assessment.  
* **Context engineering is non-optional:** Use compaction, structured note-taking (e.g., `NOTES.md`), and sub-agent isolation.  
* **Edit-format mechanics:** Using context-anchored edits (rather than line numbers) significantly improves reliability for weaker models.

The Five Layers

1. **IDE Shell:** Code-OSS fork.  
2. **Agent Harness:** The loop, firewall, and verification gates.  
3. **Provider Layer:** OpenRouter-default, capability-detecting.  
4. **Tool Layer:** MCP \+ native file/shell/edit tools.  
5. **Verification Layer:** Tests, type-check, lint, build as deterministic oracles.

\-----Gemini Research: Systems Architecture Blueprint

The design requires a departure from reactive chat interfaces. To achieve high operational efficiency, the system must act as an autonomous command center.

**Core Requirements:**

* **Autonomous Command Center:** Orchestrates complex, multi-turn software modifications.  
* **Verification:** Verifies code changes against local system signals.  
* **State Management:** Maintains execution state without depending on heavy external drivers.  
* **Background Managers:** Spawns, tracks, and aligns multiple parallel actions (as seen in Google Antigravity).

and maintain execution state without depending on heavy external drivers.   
Contemporary agentic coding platforms demonstrate that the key to developer adoption is minimizing manual context management and automating repetitive implementation pipelines. Google Antigravity implements this by structuring its platform as an agent-first environment where background managers spawn, track, and align multiple parallel actions. Rather than forcing the developer to request system assets, the platform generates task lists, technical plans, and test walkthroughs as standard workspace artifacts.   
Claude Code focuses on terminal-based efficiency, combining persistent CLI tools with a local task manager and customizable hooks to create automated workflow guardrails. Codex Desktop uses a persistent goal-execution loop that runs continuously across sessions and screensaver states. This loop allows less capable underlying models to complete complex, multi-step tasks by continually verifying outcomes against runtime tests.   
To synthesize these distinct paradigms into a unified, high-performance platform, the proposed IDE must implement an integrated systems layer. This layer coordinates a local terminal execution environment, an incremental repository analyzer, a persistent goal-state engine, and a dynamic model gateway. 

# Blueprint

\# OpenRouter Agent Harness — VS Code Extension  
\#\# Build Directive for Codex (goal-driven, verifiable) — v2

\> Working title: \*\*Forge Agent\*\*. Rename freely.  
\> v2 changes: north-star reframed (harness amplifies \*every\* tier), verified OpenRouter provider layer, six persistent state objects, agent-computer-interface tool design, V4A edit format, architect/editor split, context-engineering specifics, worktrees. Drawn from four converging research passes (Codex, Claude, Gemini, \+ this directive).

\---

\#\# 0\. How to read this document (Codex: this is for you)

A \*\*goal-driven build directive\*\*, not a suggestion. Ordered phases; each has a \*\*DONE-WHEN\*\* block of only machine-verifiable gates (a command exits 0, a test passes, a file exists with a schema, an eval score clears a threshold).

Execution rules:  
1\. \*\*Do not advance to phase N+1 until every DONE-WHEN gate in phase N passes.\*\* Run the gate, read the real output, do not self-certify.  
2\. \*\*The loop terminates per phase on green, not on "I think it's done."\*\* Gate fails → iterate that phase only.  
3\. \*\*Never claim a gate passed without running it and pasting the real exit code / output.\*\* Confident assertion without a captured signal is a failure.  
4\. End each phase with a line in \`BUILD\_LOG.md\`: \`Phase N — \<gate\> — PASS/FAIL — \<commit sha\>\`.

The design law governs all code. A phase that would violate it: stop and flag, don't build around it.

\---

\#\# 1\. North star \+ the one design law

\*\*North star:\*\* a VS Code extension where the \*harness\* — not the model — owns correctness. The goal is \*\*amplification across every model tier\*\*: the same scaffolding that drags a cheap model to a passing result lets a frontier model operate at the top of its range. Weak-model solve-rate (Phase 9\) is the \*\*instrument that measures harness strength\*\*, not the product's purpose. If the harness lifts a weak model, it lifts a strong one further.

\*\*The one design law (the firewall):\*\*

\`\`\`  
PROPOSE  →  VALIDATE  →  COMMIT  →  NARRATE  
(LLM)       (deterministic)  (deterministic)  (LLM)  
\`\`\`

\- The LLM only \*\*proposes\*\* a structured action (edit, command, plan item). Its only point of agency.  
\- A \*\*deterministic validator\*\* owns accept/reject. The model never mutates state directly.  
\- \*\*Commit\*\* applies the validated change. Deterministic. Wrapped in a reversible checkpoint.  
\- \*\*Narrate\*\* is the model's only other turn — explaining what happened. It cannot change state. The verification layer declares success; the model narrates it.

If the model's output can't be validated, it's rejected and repaired, never trusted.

\---

\#\# 2\. Architecture layers

\`\`\`  
┌─ IDE SHELL ──────────── VS Code extension host \+ webview (chat / plan / todo / evidence panes)  
├─ AGENT HARNESS ──────── loop · firewall · state objects · sub-agents  
├─ VERIFICATION LAYER ─── test / build / lint / typecheck runners as oracles  
├─ TOOL LAYER ─────────── repo-native, lossless tools (each firewalled)  
└─ PROVIDER LAYER ─────── OpenRouter default; Ollama / OpenAI-compatible fallbacks  
\`\`\`

\*\*Agent-Computer Interface (ACI) principle\*\* (SWE-agent): interface design is not a side issue — repo-native, lossless tools materially outperform generic browser automation for coding. Prefer semantic search, symbol search, structured patch editor, and a clean shell over screen-driving. Build order front-loads the layers that produce \*\*verifiable signals\*\* (verification \+ tools \+ provider), then the loop, then the scaffolds, then sub-agents, then polish.

\---

\#\# 2a. The six persistent state objects (the harness owns these, not the model)

Every non-trivial run persists, to disk, six objects that survive compaction and context resets:

1\. \*\*Goal contract\*\* — \`{ goal, context, constraints, done\_when, non\_goals, budget }\`. The durable "what." The plan is the "how" and may be rewritten; the contract is not.  
2\. \*\*Task graph\*\* — tasks with \`{ status, dependencies, blockers, owner }\`.  
3\. \*\*Plan artifact\*\* — user-editable \*before\* execution begins (Claude Code plan mode / Antigravity implementation plan).  
4\. \*\*Evidence ledger\*\* — per checkpoint: \`{ command, observation, diff, test\_result, confidence }\`. This is the unit of trust; completion is justified by evidence, not by narration.  
5\. \*\*Repository knowledge layer\*\* — durable conventions, build/test commands, architecture notes. Normalize imports from \`AGENTS.md\` / \`CLAUDE.md\` into one internal store.  
6\. \*\*Skill registry\*\* — reusable workflows for recurring jobs.

\---

\#\# 3\. Phases

\#\#\# Phase 0 — Extension skeleton \+ provider layer  
\*\*Goal:\*\* a loadable extension that calls an OpenRouter model and streams into a webview, with a model-agnostic provider behind a capability probe.

Deliverables: VS Code extension scaffold; a \`Provider\` interface; an \`OpenRouterProvider\`; webview chat panel; a \*\*capability probe\*\* (\`provider.capabilities(modelId)\` → does it support tool calls / structured output / vision?).

\*\*Verified OpenRouter policy to implement:\*\*  
\- Default coding path: \`openrouter/pareto-code\` (coding-tuned router; \`min\_coding\_score\` dial picks the cheapest model clearing a quality bar).  
\- Mixed / non-coding: \`openrouter/auto\`.  
\- Pass a \*\*\`session\_id\`\*\* on every run → pins model \+ provider across the run (cache hits, no mid-run style drift).  
\- Pass a \*\*\`models\`\*\* fallback array → rate-limit / downtime resilience.  
\- Use \*\*structured outputs\*\* (\`response\_format: json\_schema\`) for plan, task graph, evidence, walkthrough schemas.  
\- Optional server tools (real, verified): \`openrouter:advisor\` (escalate when stuck), \`openrouter:subagent\` (bounded chores), \`openrouter:fusion\` (multi-model deliberation for high-stakes review). Keep \*core\* coding tools app-owned, not provider-owned.

\*\*DONE-WHEN:\*\*  
\- \`npm run compile\` exits 0; extension activates in the Extension Dev Host (activation log line).  
\- "say PONG" to the configured model streams \`PONG\` into the webview (integration test).  
\- \`provider.capabilities()\` returns a populated struct for one frontier and one cheap model.  
\- Switching \`provider.default\` to an Ollama / OpenAI-compatible endpoint passes the same PONG test.

\---

\#\#\# Phase 1 — Tool surface (ACI) \+ the firewall  
\*\*Goal:\*\* the model proposes; the harness validates and commits. No direct mutation.

Deliverables — a small, orthogonal, repo-native tool set:  
\`repo\_search\`, \`symbol\_search\`, \`read\_file\`, \`read\_range\`, \`write\_file\`, \`apply\_patch\`, \`run\_command\`, \`run\_tests\`, \`get\_diff\`, \`update\_tasks\`, \`update\_plan\`, \`record\_evidence\`. Split by permission (shell needs approval; read/search/ls don't). Each tool's schema is the contract; decouple via registry → dispatcher → implementation.

The firewall's \*\*validate\*\* step runs deterministic checks before any mutation:  
\- Schema validation of the tool call (reject \+ repair if malformed).  
\- Scope validation (path in working set? parse the shell command for read/write paths; optional cheap-model classifier for approval routing).  
\- Edit applicability (does the patch context actually match the file? reject-before-write if not).  
All edits surface as VS Code diffs with accept/reject; every commit is a reversible checkpoint (git commit \+ \`/undo\`).

\*\*DONE-WHEN:\*\*  
\- Out-of-workspace edit path is \*\*rejected\*\* by \`validate\` (unit test asserts rejection \+ reason).  
\- Malformed patch is \*\*rejected\*\*, not partially applied (unit test).  
\- Valid patch applies, shows in the diff view, is revertible (integration test).  
\- \`commit\` is never reached on a rejected action (spy assertion).

\---

\#\#\# Phase 2 — Verification oracles  
\*\*Goal:\*\* wire real success signals the loop checks against.

Deliverables: runners for test / build / lint / typecheck, each returning \`{ pass: bool, output: string }\`. Auto-detect which a workspace supports (project files). For repos lacking tests, generate a unit-test suite first (CoT → filter syntactically valid via AST → iterate).

\*\*DONE-WHEN:\*\*  
\- Passing-suite fixture → \`runners.test()\` returns \`pass: true\` with real output captured.  
\- Broken-test fixture → \`pass: false\`, failing test name in \`output\`.  
\- Same pass/fail behavior verified for lint and typecheck on fixtures.

\---

\#\#\# Phase 3 — The goal loop (run-until-green)  
\*\*Goal:\*\* the Codex-style autonomous loop. Given the goal contract \+ a verification oracle, iterate propose→validate→commit→narrate until the oracle is green or a cap trips.

Deliverables: a single-threaded \`while(tool\_use)\` loop. \*\*Machine-verifiable termination\*\* (chosen oracle passes). \*\*Hard caps\*\*: max tool-use turns, max wall-clock, max USD (read from OpenRouter usage accounting). \*\*Anti-spin\*\*: suppress continuation turns that produce no tool call. \*\*No-progress detector\*\*: N turns with no state mutation (no successful edit, no new passing test) → halt \+ escalate. The \*\*goal contract\*\* survives compaction; a failing oracle is a new \*observation\*, not a stop.

\*\*DONE-WHEN:\*\*  
\- Failing-test fixture \+ goal "make tests pass" → loop reaches \`runners.test().pass \=== true\` and halts; transcript shows it stopped \*because\* the oracle went green.  
\- Loop \*\*never\*\* terminates \`success\` while the oracle is red (assert: terminal \`success\` ⇒ last oracle call \`pass: true\`).  
\- Step cap / no-progress on an unsolvable fixture → halts with \`gave\_up\` \+ reason, no infinite spin.  
\- Same fixture on a \*\*weak\*\* model: halts correctly (success or honest give-up), never false-success.

\---

\#\#\# Phase 4 — Auto-plan \+ todos \+ scratchpad \+ evidence (enforced)  
\*\*Goal:\*\* the Antigravity / Claude-Code scaffolds, produced \*\*without the user asking\*\*.

Deliverables: on any non-trivial goal (heuristic: \> N files or \> N steps), the harness auto-generates and persists \`PLAN.md\`, \`todos.json\` (pending/in-progress/done), \`SCRATCHPAD.md\` (knowledge artifact), and the \*\*evidence ledger\*\*. Todo state is re-injected as a system reminder after each tool call so the model can't drift. Webview renders all live. The harness — not the model — enforces creation and update.

\*\*DONE-WHEN:\*\*  
\- Multi-step goal writes \`PLAN.md\` \+ \`todos.json\` \*\*before\*\* the first edit (mtime ordering).  
\- Each completed step flips exactly one todo to \`done\` (state-transition assertion).  
\- Harness refuses to mark the goal complete while any todo is \`pending\`/\`in-progress\` (unit test).  
\- Completion is backed by a non-empty evidence ledger entry (assert: terminal \`success\` ⇒ ledger has the green oracle result).

\---

\#\#\# Phase 5 — Reflection / self-critique loop  
\*\*Goal:\*\* harness-injected reflection so any model recovers from its own errors (Reflexion: actor → evaluator → reflector).

Deliverables: after a failed validate or red oracle, inject a forced reflection step ("here is what failed and why; classify the error; propose a corrected action") before the next attempt. This is \*bounded self-repair\*, not blind retry. Capped (max reflections per step).

\*\*DONE-WHEN:\*\*  
\- Typecheck-failing fixture → transcript shows an injected reflection preceding a corrected, passing edit.  
\- Reflection is capped (cannot exceed configured max on a pathological fixture).  
\- A/B: solve-rate \*\*higher with reflection on than off\*\* (number, logged).

\---

\#\#\# Phase 6 — Sub-agents (orchestrator → workers)  
\*\*Goal:\*\* the Kimi/Kilo/Roo pattern — isolated specialist agents with partitioned context.

Deliverables: an orchestrator spawning workers with \*\*isolated context\*\*: \`planner\` (architect), \`implementer\` (editor), \`reviewer\` (reads the diff; approve or block), \`explorer\` (read-only search), \`escalation\` (re-runs a failed step on a stronger model). \*\*Non-nesting\*\*: only the root orchestrates (depth limit). Context partitions via a \*\*handoff artifact\*\*, not full transcripts. Results merge through the firewall.

\*\*Architect/editor cost split\*\*: route planning to a strong model, edits to a cheap one — you pay frontier rates only for reasoning. Natural fit for OpenRouter dual-routing; optionally map to \`openrouter:advisor\` / \`openrouter:subagent\` / \`openrouter:fusion\`.

\*\*DONE-WHEN:\*\*  
\- \`reviewer\` runs on every diff pre-commit; a planted-bug fixture is \*\*caught\*\* (reviewer blocks, commit withheld) — unit test.  
\- \`escalation\` triggers only after the primary fails the oracle N times, and routes to the configured stronger model (forced-fail fixture).  
\- Worker contexts are isolated (assert implementer's context contains the handoff artifact, not the planner's full transcript).

\---

\#\#\# Phase 7 — Model-agnostic enablement (the amplifier)  
\*\*Goal:\*\* make \*any\* model — weak or frontier — emit reliable actions. The weakest models prove the mechanism works; the strongest benefit from the same guarantees.

Deliverables:  
\- \*\*Structured-output enforcement\*\* with repair loop: native \`json\_schema\` / \`tool\_choice: required\` where supported; schema-validate \+ repair ("your last call was invalid: \<error\>; re-emit only the corrected call") where not; grammar-constrained decoding for local models. \*Caveat:\* match strictness to capability — hard function-API coercion can degrade the weakest models; prefer token-level constrained decoding for those.  
\- \*\*Context-anchored edit format (V4A \`apply\_patch\`)\*\*: locate edits by surrounding context (\`@@\` label headers), not line numbers — eliminates off-by-one hunk errors, the most common patch failure. Lenient application (tolerate whitespace drift). \*\*Whole-file rewrite\*\* fallback for the weakest models. Optional \*\*two-stage apply\*\*: planning model sketches the change, a fast apply-model merges deterministically.  
\- \*\*Forced decomposition\*\*: auto-split any oversized step so the model only ever faces one small, single-oracle-verifiable unit.

\*\*DONE-WHEN:\*\*  
\- Malformed tool call (stubbed) → repair loop yields a valid one within the cap (unit test).  
\- Schema-invalid output is \*\*never\*\* passed to \`commit\` (assert).  
\- On the eval set (Phase 9), a cheap model's autonomous solve-rate with enablement on \*\*exceeds\*\* its rate with enablement off (number, logged).

\---

\#\#\# Phase 8 — Context engineering  
\*\*Goal:\*\* survive limited context on long tasks (mechanisms configurable per model tier — they encode assumptions that go stale on stronger models).

Deliverables: \*\*compaction\*\* at \~90–92% window (summarize with a cheap model; preserve architecture decisions, open bugs, recent files; discard redundant tool output); \*\*file-system-as-memory\*\* (offload detail to \`SCRATCHPAD.md\` / ledger, keep pointers in context); \*\*tool-result clearing\*\* of stale outputs (note: invalidates cached prefixes); \*\*retrieval\*\* of only relevant files. Pattern: an initializer pass writes durable context; later passes append incremental updates.

\*\*DONE-WHEN:\*\*  
\- A long fixture crosses the compaction threshold and runs to completion without context-overflow (integration test).  
\- After compaction, the loop still has the goal contract and open todos (assert post-compaction context contains them).

\---

\#\#\# Phase 9 — Eval harness (the meta-oracle) \+ UX polish  
\*\*Goal:\*\* turn "harness strength" into a \*\*number\*\*, and polish the surface.

Deliverables: a fixed suite of \~15–25 real coding tasks (bug fixes, small features, refactors), each with its own automated pass check. A runner that executes the suite unattended and reports \*\*% solved, mean steps, mean cost\*\*.

\*\*Critical:\*\* the eval pins a \*\*deliberately weak, fixed model slug\*\* — \*\*not\*\* \`openrouter/pareto-code\` (which routes to \*strong\* coders and would mask the signal). The weak model is the \*instrument\*; proving the harness lifts it is what proves harness strength. Optionally add a SWE-bench Verified subset as a public-benchmark cross-check. Product metrics to track: time-to-first-correct-diff, time-to-green, retries, human interventions, cost per resolved task, fraction of completions whose evidence withstands review.

UX: streaming diffs, accept/reject, plan/todo/scratchpad/evidence panes, cost meter.

\*\*DONE-WHEN:\*\*  
\- \`npm run eval \-- \--model \<fixed-weak-slug\>\` runs the full suite unattended, emits a scorecard (captured artifact).  
\- Baseline recorded: same suite, \*\*bare model, no harness\*\*, scores \*\*lower\*\* (the number that proves the thesis).  
\- Eval is deterministic enough to track regressions across commits (score logged to \`BUILD\_LOG.md\`).

\---

\#\# 4\. Global acceptance (project is "done" when)

\- All phase DONE-WHEN gates green, logged in \`BUILD\_LOG.md\` with shas.  
\- \`npm run eval\` on the fixed weak slug clears a target solve-rate \*\*you set\*\* (start where the first real run lands, then ratchet — the ratchet \*is\* the roadmap).  
\- Harness solve-rate strictly beats bare-model solve-rate on the same suite (thesis, by number).  
\- Every state mutation traces through propose→validate→commit. No exceptions (grep/audit gate).

\---

\#\# 5\. Non-negotiables (do not let these drift)

1\. The model never mutates state directly. Ever.  
2\. No phase advances on an unverified claim. Gates are run, outputs captured.  
3\. "Success" terminal states must be backed by a green oracle in the same run.  
4\. The harness lifts \*\*every\*\* tier; the weak-model eval is the instrument, not the goal.  
5\. The eval number, not vibes, decides whether the harness is good.

\---

\#\# 6\. Suggested release sequencing (not gates — sequencing)

\- \*\*Founding:\*\* repo-native harness — goal contract, plan mode, task graph, structured artifacts, checkpoints, tests, diff review. OpenRouter provider, small deterministic tool surface. Raises the floor.  
\- \*\*Quality:\*\* reflection loops, repo memory, skills, escalation, model-routing policies, telemetry. Every tier feels better.  
\- \*\*Triple-A:\*\* multi-agent composition, auto cleanup/refactor jobs, multimodal verification for UI work, richer artifact review. Where you rival the leaders' trust and throughput.  
