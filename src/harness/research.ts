import * as fs from 'fs';
import * as path from 'path';
import { Provider } from './provider';

/**
 * Deep research mode (Phase 56.1) — ChatGPT-deep-research shaped, firewalled:
 * one planning call decomposes the question into sub-questions; one WEB-GROUNDED
 * worker call per sub-question (OpenRouter ':online' web-search plugin — any
 * model slug, live internet, citations); one synthesis call composes a cited
 * report. The artifact persists under .forge/research/ and attaches to the
 * session's chat context. Research is read-only by construction: it produces
 * a document, never mutations, and its claims carry their sources.
 */

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subQuestions'],
  properties: {
    subQuestions: { type: 'array', items: { type: 'string' } }
  }
};

export interface ResearchResult {
  artifactPath: string;
  markdown: string;
  question: string;
  subQuestions: string[];
  workerCalls: number;
  webGrounded: boolean;
}

function onlineSlug(modelId: string): string {
  // OpenRouter web-search plugin: any model slug + ':online' gets live search results.
  return modelId.includes(':online') ? modelId : `${modelId}:online`;
}

export async function runDeepResearch(question: string, provider: Provider, workspaceRoot: string, modelId?: string, maxWorkers = 5): Promise<ResearchResult> {
  const baseModel = modelId || 'openrouter/auto';
  let workerCalls = 0;

  // 1) Plan: decompose into sub-questions (no web needed for planning).
  let subQuestions: string[] = [];
  try {
    workerCalls += 1;
    const response = await provider.generateChat({
      modelId: baseModel,
      sessionId: `forge-research-plan-${Date.now()}`,
      responseFormatSchema: PLAN_SCHEMA,
      messages: [
        { role: 'system', content: 'RESEARCH_PLANNER: Decompose the research question into 3-5 independent, concrete sub-questions that together answer it. Return JSON {subQuestions: string[]}. Prefer sub-questions with verifiable, current answers.' },
        { role: 'user', content: question }
      ]
    } as any);
    subQuestions = (JSON.parse(response.text).subQuestions || []).map((s: any) => String(s)).filter(Boolean).slice(0, maxWorkers);
  } catch {
    subQuestions = [];
  }
  if (!subQuestions.length) {
    subQuestions = [question];
  }

  // 2) Web-grounded workers: one per sub-question, fresh context, cited findings.
  let webGrounded = true;
  const findings: Array<{ sub: string; report: string }> = [];
  for (const sub of subQuestions) {
    try {
      workerCalls += 1;
      const response = await provider.generateChat({
        modelId: onlineSlug(baseModel),
        sessionId: `forge-research-web-${Date.now()}-${workerCalls}`,
        messages: [
          { role: 'system', content: 'WEB_RESEARCH_WORKER: Research ONE sub-question using live web results. Cross-check across sources. Report: the specific answer, the evidence, and source URLs for every claim. If uncertain or sources conflict, say exactly what you found and what remains open. Never answer from memory alone.' },
          { role: 'user', content: sub }
        ]
      } as any);
      findings.push({ sub, report: String(response.text || '').slice(0, 4000) });
    } catch (e: any) {
      webGrounded = false;
      findings.push({ sub, report: `worker failed (${String(e.message).slice(0, 160)}) — this sub-question is UNANSWERED, not answered from memory.` });
    }
  }

  // 3) Synthesis: cited report; claims must trace to worker sources.
  let synthesis = '';
  try {
    workerCalls += 1;
    const response = await provider.generateChat({
      modelId: baseModel,
      sessionId: `forge-research-synth-${Date.now()}`,
      messages: [
        { role: 'system', content: 'RESEARCH_SYNTHESIZER: Compose a markdown research report from the web workers\' findings. Structure: ## Answer, ## Key findings (every claim with its source URL from the findings), ## Conflicts & uncertainty, ## Sources (deduplicated URL list). Only claim what the findings support; failed/unanswered sub-questions must appear under uncertainty, never papered over.' },
        { role: 'user', content: `Question: ${question}\n\n${findings.map(finding => `### Sub-question: ${finding.sub}\n${finding.report}`).join('\n\n')}` }
      ]
    } as any);
    synthesis = response.text;
  } catch (e: any) {
    synthesis = `## Answer\nSynthesis failed (${String(e.message).slice(0, 120)}); raw worker findings below carry the sources.\n`;
  }

  const markdown = [
    `# Deep Research: ${question}`,
    `_Generated ${new Date().toISOString()} · ${subQuestions.length} sub-questions · web-grounded: ${webGrounded} · read-only_`,
    '',
    synthesis,
    '',
    '## Raw worker findings',
    ...findings.map(finding => `### ${finding.sub}\n${finding.report}`)
  ].join('\n');

  const researchDir = path.join(workspaceRoot, '.forge', 'research');
  fs.mkdirSync(researchDir, { recursive: true });
  const slug = question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'research';
  const artifactPath = path.join(researchDir, `${Date.now()}-${slug}.md`);
  fs.writeFileSync(artifactPath, markdown, 'utf8');
  return { artifactPath, markdown, question, subQuestions, workerCalls, webGrounded };
}
