import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execFile } from 'child_process';
import { AgentHarnessLoop } from './harness/loop';
import { HarnessState, HumanApprovalPolicy, ModePolicy } from './harness/types';
import { BlueprintProofRunner } from './harness/proof';
import { createConfiguredProvider, OpenRouterProvider, setRuntimeOpenRouterApiKey } from './harness/provider';
import { migrateLegacyCredential, probeProviderReadiness, ProviderReadiness } from './harness/providerReadiness';
import { AgentMode, ModeRegistry } from './harness/modeRegistry';
import { writeSupportReport } from './harness/supportBundle';
import { SessionStore } from './harness/sessionStore';
import { normalizeDifficultLiveProofRequest, runDifficultLiveProof } from './harness/difficultLiveProof';
import { WeakModelEvalRunner } from './harness/weakEval';
import { runVerificationFixtureMatrix } from './harness/verificationMatrix';
import { runIsolatedAgentGoal } from './harness/isolation';
import { runReflectionAbEval } from './harness/reflectionAb';
import { directiveToGoalOverrides, parseGoalDirective } from './harness/goalContract';
import { runDeepResearch } from './harness/research';
import { BrowserValidationRunner } from './harness/browserValidation';
import { WorkspaceIndexService, WorkspaceIndexStatus, WorkspaceMentionSearchResult } from './harness/workspaceIndex';
import { ComposerContextAttachment, ComposerContextService } from './harness/composerContext';
import { ConversationController } from './harness/conversationController';
import { McpServerConfig, McpToolGateway, removeMcpServerConfig, upsertMcpServerConfig } from './harness/mcpGateway';
import { runScriptedPlanBigExecuteSmallEval } from './harness/topologyEval';
import { normalizeProductionBenchmarkRequest, runProductionBenchmark } from './harness/productionBenchmark';
import { enhancePrompt, PromptEnhancementResult } from './harness/promptEnhancer';
import { AssuranceLevel, normalizeAssuranceLevel } from './harness/executionContract';

/** Research artifacts attached to the live chat context this extension-host session. */
const attachedResearch: string[] = [];

let activeProvider: ForgeStudioWebviewProvider | undefined;
const proofRunner = new BlueprintProofRunner();
const weakEvalRunner = new WeakModelEvalRunner();

const OPENROUTER_SECRET_KEY = 'forge.openRouterApiKey';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Forge Agent Extension is now active.');

  await migrateLegacyOpenRouterCredential(context);
  const modeRegistry = new ModeRegistry(context.globalState);

  const provider = new ForgeStudioWebviewProvider(context.extensionUri, context, modeRegistry);
  activeProvider = provider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('forge-agent.studio', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openStudio', () => {
      vscode.commands.executeCommand('workbench.view.extension.forge-agent-container');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.diagnostics', () => {
      return activeProvider?.diagnostics() || { hasState: false };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runBlueprintProof', async (options?: any) => {
      const report = await proofRunner.run(options || {});
      await persistLatestProofReport(report);
      return report;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runBlueprintProofMatrix', async (models?: string[] | { models?: string[]; goal?: string; keepFixtures?: boolean }) => {
      const options = Array.isArray(models) ? { models } : (models || {});
      const report = await proofRunner.run(options);
      await persistLatestProofReport(report);
      return report;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.getProofReport', () => {
      return proofRunner.getLatestReport() || null;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runWeakModelEval', async (options?: any) => {
      const report = await weakEvalRunner.run({
        ...(options || {}),
        reportRoot: options?.reportRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
      });
      return report;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runVerificationFixtureMatrix', async (options?: any) => {
      return runVerificationFixtureMatrix(options?.reportRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.getWeakModelEvalReport', () => {
      return weakEvalRunner.getLatestReport() || null;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openArtifact', async (artifact: string) => {
      return openArtifact(artifact, proofRunner);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.getProviderReadiness', async () => provider.refreshReadiness(false))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.listMcpTools', async () => provider.refreshMcpCatalog())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.testMcpServer', async (serverId?: string) => {
      const id = String(serverId || '').trim();
      if (!id) throw new Error('MCP server id is required.');
      return provider.refreshMcpCatalog(id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.addMcpServer', async (config?: McpServerConfig) => provider.addMcpServer(config)),
    vscode.commands.registerCommand('forge-agent.removeMcpServer', async (serverId?: string) => provider.removeMcpServer(serverId)),
    vscode.commands.registerCommand('forge-agent.enhancePrompt', async (draft?: string, modeId?: string) => {
      const value = String(draft || await vscode.window.showInputBox({ prompt: 'Prompt to enhance', placeHolder: 'Describe the coding task' }) || '').trim();
      return provider.enhanceDraft(value, modeId || 'code');
    }),
    vscode.commands.registerCommand('forge-agent.setPromptEnhancementModel', async (modelId?: string) => {
      const value = String(modelId || await vscode.window.showInputBox({ prompt: 'Exact prompt enhancement model slug', value: 'google/gemini-2.5-flash-lite' }) || '').trim();
      return provider.setPromptEnhancementModel(value);
    }),
    vscode.commands.registerCommand('forge-agent.getPromptEnhancementSettings', () => ({
      modelId: vscode.workspace.getConfiguration('forge').get<string>('promptEnhancementModel', 'google/gemini-2.5-flash-lite')
    }))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.setMcpCredential', async (serverId?: string, secretName?: string, value?: string) => {
      const id = String(serverId || '').trim();
      const name = String(secretName || '').trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) throw new Error('MCP server id and secret name must be bounded identifiers.');
      const secretValue = String(value || '').trim();
      if (!secretValue) throw new Error('MCP credential cannot be empty.');
      await context.secrets.store(`forge.mcp.${id}.${name}`, secretValue);
      return { stored: true, serverId: id, secretName: name };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.clearMcpCredential', async (serverId?: string, secretName?: string) => {
      const id = String(serverId || '').trim();
      const name = String(secretName || '').trim();
      if (!id || !name) throw new Error('MCP server id and secret name are required.');
      await context.secrets.delete(`forge.mcp.${id}.${name}`);
      return { cleared: true, serverId: id, secretName: name };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openMcpCatalog', async () => openArtifact('mcp-catalog', proofRunner))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openSubAgentTopology', async () => openArtifact('subAgentTopology', proofRunner)),
    vscode.commands.registerCommand('forge-agent.openSubAgentHandoffs', async () => openArtifact('subAgentHandoffs', proofRunner)),
    vscode.commands.registerCommand('forge-agent.openSubAgentMerges', async () => openArtifact('subAgentMerges', proofRunner)),
    vscode.commands.registerCommand('forge-agent.openSubAgentMetrics', async () => openArtifact('subAgentMetrics', proofRunner))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openRuntimeIsolationReport', async () => openArtifact('runtimeIsolation', proofRunner)),
    vscode.commands.registerCommand('forge-agent.openContextOptimizationReport', async () => openArtifact('contextOptimization', proofRunner)),
    vscode.commands.registerCommand('forge-agent.openModelRoutingReport', async () => openArtifact('modelRouting', proofRunner))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runPlanBigExecuteSmallEval', async () => runScriptedPlanBigExecuteSmallEval(getWorkspaceRoot())),
    vscode.commands.registerCommand('forge-agent.openPlanBigExecuteSmallReport', async () => openArtifact('topologyEval', proofRunner))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.setOpenRouterApiKey', async (apiKey?: string) => {
      const value = String(apiKey || '').trim();
      if (!value) throw new Error('OpenRouter API key cannot be empty.');
      await context.secrets.store(OPENROUTER_SECRET_KEY, value);
      setRuntimeOpenRouterApiKey(value);
      return provider.refreshReadiness(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.clearOpenRouterApiKey', async () => {
      await context.secrets.delete(OPENROUTER_SECRET_KEY);
      setRuntimeOpenRouterApiKey('');
      return provider.refreshReadiness(true);
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.listModes', () => modeRegistry.list()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.upsertMode', async (mode: Partial<AgentMode>) => modeRegistry.upsert(mode || {})));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.deleteMode', async (modeId: string) => modeRegistry.delete(modeId)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.reportProblem', async (options?: any) => {
    return createSupportReport(context, provider, options);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.listSessions', () => provider.listSessions()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.openSession', (sessionId: string) => provider.openSession(sessionId)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.resumeSession', (sessionId: string, options?: any) => provider.resumeSession(sessionId, options?.modelBindings || {})));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.deleteSession', (sessionId: string) => provider.deleteSession(sessionId)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.setHumanApprovalPolicy', (policy: HumanApprovalPolicy) => provider.setHumanApprovalPolicy(policy)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.resolveHumanApproval', (decision: 'approve' | 'reject', approvalId: string, reason?: string) => provider.resolveHumanApproval(decision, approvalId, reason)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.getAssuranceLevel', () => provider.getAssuranceLevel()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.setAssuranceLevel', (level: AssuranceLevel) => provider.setAssuranceLevel(level)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.decideExecutionContract', (decision: 'confirm' | 'reject', digest: string, modelBindings?: Record<string, string>) => provider.resolveExecutionContract(decision, digest, modelBindings || {})));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.openExecutionContract', () => openArtifact('executionContract', proofRunner)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.buildWorkspaceIndex', () => provider.buildWorkspaceIndex()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.getWorkspaceIndexStatus', () => provider.getWorkspaceIndexStatus()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.openWorkspaceIndex', () => openArtifact('workspaceIndex', proofRunner)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.getComposerContext', () => provider.getComposerContext()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.attachContextFile', (filePath: string) => provider.attachContextFile(filePath)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.clearComposerContext', () => provider.clearComposerContext()));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.searchContextMentions', (query: string) => provider.searchContextMentions(query)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.attachContextMention', (kind: 'file' | 'folder' | 'symbol', relativePath: string, symbolName?: string, line?: number) => provider.attachContextMention(kind, relativePath, symbolName, line)));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.runDifficultWeakModelProof', async (options?: any) => {
    const request = normalizeDifficultLiveProofRequest({ ...(options || {}), reportRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd() });
    const readiness = await provider.refreshReadiness(false);
    if (!readiness.ready) throw new Error(readiness.blockers[0]?.message || 'Provider is not ready for a live proof.');
    return runDifficultLiveProof(request);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.runProductionBenchmark', async (options?: any) => {
    const request = normalizeProductionBenchmarkRequest({ ...(options || {}), reportRoot: getWorkspaceRoot() });
    const readiness = await provider.refreshReadiness(false);
    if (!readiness.ready) throw new Error(readiness.blockers[0]?.message || 'Provider is not ready for the production benchmark.');
    return runProductionBenchmark(request);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('forge-agent.openProductionBenchmarkReport', async () => openArtifact('productionBenchmark', proofRunner)));

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runBrowserValidation', async (options?: any) => {
      const result = await new BrowserValidationRunner(getWorkspaceRoot()).run({
        url: String(options?.url || ''),
        expectedText: options?.expectedText === undefined ? undefined : String(options.expectedText),
        timeoutMs: options?.timeoutMs === undefined ? undefined : Number(options.timeoutMs)
      });
      return result;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openNativeSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kennyg.forge-agent');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openTerminal', () => {
      const terminal = vscode.window.createTerminal({ name: 'Forge Agent' });
      terminal.show();
      return terminal.name;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.openDiff', async () => {
      return openNativeDiff();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.chat', async (options?: any) => {
      const mode = modeRegistry.resolve(options?.modeId || 'ask');
      return runChatCompletion({ ...(options || {}), mode });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.submitMessage', async (options?: any) => provider.submitConversationMessage(options || {}))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runAgentGoal', async (options?: any) => {
      const mode = modeRegistry.resolve(options?.modeId || 'code');
      if (mode.intent !== 'code') throw new Error(`Mode '${mode.name}' is non-mutating. Select a code-capable mode before starting a coding run.`);
      const loop = new AgentHarnessLoop(createConfiguredProvider(), undefined, undefined, createMcpGateway(context));
      const rawGoal = String(options?.goal || 'Validate the workspace with Forge Agent.');
      const directive = parseGoalDirective(rawGoal);
      const goalOverrides = directive.isDirective
        ? { ...directiveToGoalOverrides(directive), ...(options?.goalOverrides || {}) }
        : options?.goalOverrides;
      let state = await loop.initializeHarness(directive.isDirective ? directive.goal : rawGoal, options?.modelBindings || {}, options?.runBudget || {}, { goalOverrides, modePolicy: toModePolicy(mode), humanApprovalPolicy: options?.humanApprovalPolicy === 'ask' ? 'ask' : 'auto', assuranceLevel: normalizeAssuranceLevel(options?.assuranceLevel || vscode.workspace.getConfiguration('forge').get<string>('assuranceLevel', 'standard')) });
      while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
        state = await loop.runStep(state, options?.modelBindings || {});
      }
      return state;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.setGoal', (text?: string) => {
      const directive = parseGoalDirective(String(text || ''));
      return { directive, goalOverrides: directiveToGoalOverrides(directive) };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.pauseGoal', () => {
      writeRunControl({ paused: true, requestedAt: new Date().toISOString() });
      return { paused: true };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.resumeGoal', () => {
      writeRunControl({ paused: false, requestedAt: new Date().toISOString() });
      return { paused: false };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.answerClarification', (answer: string, clarificationId?: string) => {
      const loop = new AgentHarnessLoop(createConfiguredProvider(), undefined, undefined, createMcpGateway(context));
      return loop.answerClarification(answer, clarificationId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.restoreCheckpoint', async (checkpointId: string) => {
      const loop = new AgentHarnessLoop(createConfiguredProvider(), undefined, undefined, createMcpGateway(context));
      return loop.restoreCheckpoint(checkpointId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.steerGoal', (edit?: any) => {
      const current = readRunControl();
      writeRunControl({ ...(current || {}), editedGoal: edit || {}, requestedAt: new Date().toISOString() });
      return { steered: true, edit: edit || {} };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.resumeAgentGoal', async (options?: any) => {
      const loop = new AgentHarnessLoop(createConfiguredProvider(), undefined, undefined, createMcpGateway(context));
      let state = await loop.resumeFromDisk({
        additionalSteps: options?.additionalSteps,
        allowBudgetHaltResume: options?.allowBudgetHaltResume === true
      });
      if (!state) {
        return null;
      }
      while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
        state = await loop.runStep(state, options?.modelBindings || {});
      }
      return state;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runIsolatedAgentGoal', async (options?: any) => {
      return runIsolatedAgentGoal({
        ...(options || {}),
        sourceRoot: options?.sourceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runReflectionAbEval', async (options?: any) => {
      return runReflectionAbEval({
        ...(options || {}),
        reportRoot: options?.reportRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
      });
    })
  );
}

class ForgeStudioWebviewProvider implements vscode.WebviewViewProvider {
  private harnessLoop: AgentHarnessLoop;
  private readonly conversationController = new ConversationController();
  private webview?: vscode.Webview;
  private readinessCache?: ProviderReadiness;
  private readinessProbe?: Promise<ProviderReadiness>;
  private activeChatSessionId?: string;
  private workspaceIndexBuilding = false;
  private workspaceIndexError?: string;
  private runPromise?: Promise<HarnessState>;
  private readonly mcpGateway: McpToolGateway;

  constructor(private readonly extensionUri: vscode.Uri, private readonly extensionContext: vscode.ExtensionContext, private readonly modeRegistry: ModeRegistry) {
    this.mcpGateway = createMcpGateway(extensionContext);
    this.harnessLoop = new AgentHarnessLoop(createConfiguredProvider(), undefined, undefined, this.mcpGateway);
    void this.refreshMcpCatalog().catch(() => undefined);
  }

  public diagnostics(): any {
    return this.harnessLoop.getDiagnostics();
  }

  public async refreshReadiness(force = true): Promise<ProviderReadiness> {
    return this.publishReadiness(force);
  }

  public async refreshMcpCatalog(serverId?: string): Promise<any> {
    const tools = await this.mcpGateway.discover(serverId);
    const catalog = this.mcpGateway.sanitizedCatalog();
    const root = getWorkspaceRoot();
    const target = path.join(root, '.forge', 'mcp-catalog.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), serverCount: new Set(catalog.map(tool => tool.serverId)).size, tools: catalog }, null, 2), 'utf8');
    await this.webview?.postMessage({ command: 'mcp-catalog', serverCount: new Set(catalog.map(tool => tool.serverId)).size, toolCount: catalog.length, tools: catalog });
    return { discovered: tools.length, serverCount: new Set(catalog.map(tool => tool.serverId)).size, tools: catalog, artifactPath: target };
  }

  public async enhanceDraft(draft: string, modeId = 'code'): Promise<PromptEnhancementResult> {
    const mode = this.modeRegistry.resolve(modeId || 'code');
    const configuration = vscode.workspace.getConfiguration('forge');
    const modelId = String(configuration.get<string>('promptEnhancementModel', 'google/gemini-2.5-flash-lite') || '').trim();
    return enhancePrompt(createConfiguredProvider(), {
      draft,
      modelId,
      modeName: mode.name,
      sessionId: `forge-enhance-${Date.now()}`
    });
  }

  public async setPromptEnhancementModel(modelId: string): Promise<string> {
    const normalized = String(modelId || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,199}$/.test(normalized)) throw new Error('Prompt enhancement model must be an exact bounded model slug.');
    await vscode.workspace.getConfiguration('forge').update('promptEnhancementModel', normalized, vscode.ConfigurationTarget.Global);
    await this.publishPromptEnhancementSettings();
    return normalized;
  }

  public async addMcpServer(config?: McpServerConfig): Promise<{ added: true; server: McpServerConfig }> {
    const candidate = config || await promptForMcpServerConfig();
    const configuration = vscode.workspace.getConfiguration('forge');
    const existing = configuration.get<McpServerConfig[]>('mcpServers', []);
    const next = upsertMcpServerConfig(existing, candidate);
    const server = next.find(item => item.id === String(candidate.id).trim())!;
    await configuration.update('mcpServers', next, vscode.ConfigurationTarget.Global);
    await this.webview?.postMessage({ command: 'mcp-config-updated', action: 'added', serverId: server.id });
    return { added: true, server };
  }

  public async removeMcpServer(serverId?: string): Promise<{ removed: true; serverId: string }> {
    const configuration = vscode.workspace.getConfiguration('forge');
    const existing = configuration.get<McpServerConfig[]>('mcpServers', []);
    const id = String(serverId || await vscode.window.showQuickPick(existing.map(server => server.id), { placeHolder: 'Remove a governed MCP server' }) || '').trim();
    const next = removeMcpServerConfig(existing, id);
    await configuration.update('mcpServers', next, vscode.ConfigurationTarget.Global);
    await this.webview?.postMessage({ command: 'mcp-config-updated', action: 'removed', serverId: id });
    return { removed: true, serverId: id };
  }

  public listSessions(): any {
    return this.sessionStore().list();
  }

  public openSession(sessionId: string): any {
    const loaded = this.sessionStore().load(sessionId, true);
    if (loaded.state) {
      this.harnessLoop.loadPersistedSession(sessionId);
      this.activeChatSessionId = undefined;
    } else {
      this.harnessLoop.clearActiveSession();
      this.activeChatSessionId = loaded.meta.sessionId;
    }
    return { ...loaded, context: this.contextService().summaries(loaded.context) };
  }

  public async resumeSession(sessionId: string, modelBindings: Record<string, string> = {}): Promise<any> {
    const loaded = this.openSession(sessionId);
    if (!loaded.meta.resumable) return loaded;
    let state = await this.harnessLoop.resumeFromDisk({ additionalSteps: 30, allowBudgetHaltResume: true });
    while (state && !['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
      state = await this.harnessLoop.runStep(state, modelBindings);
    }
    return { ...loaded, state };
  }

  public deleteSession(sessionId: string): any {
    return this.sessionStore().delete(sessionId, this.harnessLoop.getDiagnostics()?.state?.sessionId || this.activeChatSessionId);
  }

  public async setHumanApprovalPolicy(policy: HumanApprovalPolicy): Promise<HumanApprovalPolicy> {
    const normalized: HumanApprovalPolicy = policy === 'auto' ? 'auto' : 'ask';
    await vscode.workspace.getConfiguration('forge').update('humanApprovalPolicy', normalized, vscode.ConfigurationTarget.Global);
    await this.publishHumanApprovalPolicy();
    return normalized;
  }

  public async resolveHumanApproval(decision: 'approve' | 'reject', approvalId: string, reason = '', modelBindings: Record<string, string> = {}): Promise<HarnessState> {
    return this.harnessLoop.decideHumanApproval(decision, approvalId, reason, modelBindings);
  }

  public getAssuranceLevel(): AssuranceLevel {
    return normalizeAssuranceLevel(vscode.workspace.getConfiguration('forge').get<string>('assuranceLevel', 'standard'));
  }

  public async setAssuranceLevel(level: AssuranceLevel): Promise<AssuranceLevel> {
    const normalized = normalizeAssuranceLevel(level);
    await vscode.workspace.getConfiguration('forge').update('assuranceLevel', normalized, vscode.ConfigurationTarget.Global);
    await this.publishAssuranceLevel();
    return normalized;
  }

  public async resolveExecutionContract(decision: 'confirm' | 'reject', digest: string, modelBindings: Record<string, string> = {}): Promise<HarnessState> {
    let state = await this.harnessLoop.decideExecutionContract(decision, digest);
    await this.publishState(state);
    if (decision === 'confirm') state = await this.runUntilBoundary(state, modelBindings);
    return state;
  }

  public async submitConversationMessage(options: any): Promise<any> {
    const messages = Array.isArray(options.messages) ? options.messages : [];
    const lastUser = String(options.message || messages.slice(-1)[0]?.content || '').trim();
    const mode = this.modeRegistry.resolve(options.modeId || 'code');
    const state = this.harnessLoop.getDiagnostics()?.state as HarnessState | undefined;
    const pendingClarification = state?.clarifications?.find(item => item.status === 'pending');
    const pendingApproval = state?.pendingHumanApproval?.status === 'pending' ? state.pendingHumanApproval : undefined;
    const pendingContract = state?.executionContract?.status === 'pending' ? state.executionContract : undefined;
    const decision = this.conversationController.route({
      message: lastUser,
      modeIntent: mode.intent,
      runStatus: state?.status,
      pendingClarificationId: pendingClarification?.id,
      pendingApprovalId: pendingApproval?.id || pendingContract?.digest
    });
    const sessionId = this.ensureConversationSession(lastUser);
    await this.webview?.postMessage({ command: 'conversation-route', sessionId, decision });

    if (decision.route === 'answer') {
      const result = await runChatCompletion({ messages, modelId: options.modelId, sessionId, mode, userContext: this.currentComposerContext(sessionId) });
      await this.publishConversationText(sessionId, messages, result.text, result.modelId, result.usage);
      return { decision, sessionId, text: result.text, modelId: result.modelId, usage: result.usage };
    }

    if (decision.route === 'clarify_intent') {
      const text = decision.requiresModeChange
        ? `This request appears to require workspace changes, but ${mode.name} mode is non-mutating. Switch to a code-capable mode and send it again.`
        : state && !this.isTerminal(state)
          ? 'Should this change the active run, or are you asking a read-only question?'
          : 'Should Forge change the workspace, or are you asking for a read-only answer?';
      await this.publishConversationText(sessionId, messages, text);
      return { decision, sessionId, text };
    }

    if (decision.route === 'inspect_status') {
      const text = this.authoritativeStatusText(state);
      await this.publishConversationText(sessionId, messages, text);
      return { decision, sessionId, text, state };
    }

    if (decision.route === 'research') {
      const question = lastUser.replace(/^\/research\s+/i, '').trim();
      const research = await runDeepResearch(question, createConfiguredProvider(), getWorkspaceRoot(), options.modelId);
      attachedResearch.push(research.artifactPath);
      const text = `Research artifact attached (${research.subQuestions.length} sub-questions, web-grounded: ${research.webGrounded}, saved to ${path.relative(getWorkspaceRoot(), research.artifactPath)}).\n\n${research.markdown.slice(0, 4000)}`;
      await this.publishConversationText(sessionId, messages, text);
      return { decision, sessionId, text, artifactPath: research.artifactPath };
    }

    if (decision.route === 'pause') {
      writeRunControl({ ...(readRunControl() || {}), paused: true, requestedAt: new Date().toISOString() });
      const next = state && !this.isTerminal(state) && !this.runPromise ? await this.harnessLoop.runStep(state, options.modelBindings || {}) : state;
      if (next) await this.publishState(next);
      const text = 'Run paused at the next governed boundary. No provider calls will be made while paused.';
      await this.publishConversationText(sessionId, messages, text);
      return { decision, sessionId, text, state: next };
    }

    if (decision.route === 'cancel') {
      if (this.runPromise) {
        writeRunControl({ ...(readRunControl() || {}), cancelRequested: true, requestedAt: new Date().toISOString() });
        const text = 'Cancellation requested. Forge will stop at the next governed boundary after the current bounded action.';
        await this.publishConversationText(sessionId, messages, text);
        return { decision, sessionId, text, state };
      }
      const cancelled = this.harnessLoop.cancelRun('Cancelled by the user through the conversation controller.');
      await this.publishState(cancelled);
      const text = 'Run cancelled. Its history and evidence remain available, and this terminal run will not resume.';
      await this.publishConversationText(cancelled.sessionId, messages, text);
      return { decision, sessionId: cancelled.sessionId, text, state: cancelled };
    }

    if (decision.route === 'steer_run') {
      writeRunControl({ ...(readRunControl() || {}), editedGoal: { constraints: [lastUser] }, requestedAt: new Date().toISOString() });
      const text = `Steering recorded for this run: ${lastUser}`;
      await this.publishConversationText(sessionId, messages, text);
      if (!this.runPromise && state && !this.isBoundary(state)) await this.runUntilBoundary(state, options.modelBindings || {});
      return { decision, sessionId, text, state: this.harnessLoop.getDiagnostics()?.state };
    }

    let nextState: HarnessState | undefined = state;
    if (decision.route === 'start_run') {
      const readiness = await this.publishReadiness();
      if (!readiness.ready) throw new Error(readiness.blockers[0]?.message || 'Forge provider is not ready.');
      nextState = await this.initializeConversationRun(lastUser, messages, mode, options);
    } else if (decision.route === 'answer_clarification') {
      if (!pendingClarification) throw new Error('The pending clarification changed before the answer was applied.');
      nextState = this.harnessLoop.answerClarification(lastUser, pendingClarification.id);
      await this.publishState(nextState);
    } else if (decision.route === 'resolve_approval') {
      if (!decision.approvalDecision) throw new Error('The pending approval changed before the decision was applied.');
      if (pendingApproval) {
        nextState = await this.harnessLoop.decideHumanApproval(decision.approvalDecision, pendingApproval.id, lastUser, options.modelBindings || {});
      } else if (pendingContract) {
        nextState = await this.harnessLoop.decideExecutionContract(decision.approvalDecision === 'approve' ? 'confirm' : 'reject', pendingContract.digest);
      } else {
        throw new Error('The pending approval changed before the decision was applied.');
      }
      await this.publishState(nextState);
    } else if (decision.route === 'resume') {
      writeRunControl({ ...(readRunControl() || {}), paused: false, requestedAt: new Date().toISOString() });
      if (nextState?.status === 'paused') {
        nextState = await this.harnessLoop.runStep(nextState, options.modelBindings || {});
        await this.publishState(nextState);
      }
    }

    if (!nextState) throw new Error(`Conversation route '${decision.route}' requires an active run.`);
    nextState = await this.runUntilBoundary(nextState, options.modelBindings || {});
    const text = this.authoritativeStatusText(nextState);
    await this.publishConversationText(nextState.sessionId, messages, text);
    return { decision, sessionId: nextState.sessionId, text, state: nextState };
  }

  private async initializeConversationRun(rawGoal: string, messages: any[], mode: AgentMode, options: any): Promise<HarnessState> {
    if (mode.intent !== 'code') throw new Error(`Mode '${mode.name}' cannot start a governed coding run.`);
    const previousSessionId = this.currentContextSessionId();
    let previousChat: any[] = [];
    let userContext: ComposerContextAttachment[] = [];
    if (previousSessionId) {
      try {
        const previous = this.sessionStore().load(previousSessionId);
        previousChat = previous.chat;
        userContext = previous.context;
      } catch { /* a new run can start without stale session data */ }
    }
    const directive = parseGoalDirective(rawGoal);
    const config = vscode.workspace.getConfiguration('forge');
    const configBudget = {
      maxCostUsd: config.get<number>('maxCostUsd', 1),
      maxWallClockMs: Math.max(1, config.get<number>('maxWallClockMinutes', 30)) * 60 * 1000
    };
    const goalOverrides = directive.isDirective ? directiveToGoalOverrides(directive) : { maxSteps: config.get<number>('maxSteps', 30) };
    const next = await this.harnessLoop.initializeHarness(
      directive.isDirective ? directive.goal : rawGoal,
      options.modelBindings || {},
      { ...configBudget, ...(options.runBudget || {}) },
      { reflectionEnabled: config.get<boolean>('reflectionEnabled', true), goalOverrides, modePolicy: toModePolicy(mode), humanApprovalPolicy: this.humanApprovalPolicy(), assuranceLevel: this.getAssuranceLevel(), userContext }
    );
    const mergedChat = messages.length >= previousChat.length ? messages : [...previousChat, ...messages];
    this.sessionStore().saveChat(next.sessionId, mergedChat);
    this.sessionStore().saveContext(next.sessionId, userContext);
    this.activeChatSessionId = undefined;
    await this.webview?.postMessage({ command: 'composer-context', sessionId: next.sessionId, attachments: this.contextService().summaries(userContext) });
    await this.publishState(next);
    return next;
  }

  private async runUntilBoundary(initial: HarnessState, modelBindings: Record<string, string>): Promise<HarnessState> {
    if (this.runPromise) return this.runPromise;
    const execute = async () => {
      let state = initial;
      while (!this.isBoundary(state) && state.currentStepIndex < state.maxSteps) {
        state = await this.harnessLoop.runStep(state, modelBindings);
        await this.publishState(state);
        const control = readRunControl();
        if (!this.isTerminal(state) && (control?.cancelRequested === true || control?.paused === true)) {
          state = await this.harnessLoop.runStep(state, modelBindings);
          await this.publishState(state);
        }
      }
      return state;
    };
    this.runPromise = execute();
    try { return await this.runPromise; }
    finally { this.runPromise = undefined; }
  }

  private isBoundary(state: HarnessState): boolean {
    return ['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status);
  }

  private isTerminal(state: HarnessState): boolean {
    return ['success', 'failed', 'gave_up'].includes(state.status);
  }

  private async publishState(state: HarnessState): Promise<void> {
    await this.webview?.postMessage({ command: 'state-update', state: this.webviewState(state) });
  }

  private webviewState(state: HarnessState): HarnessState {
    const topology = state.subAgentTopology;
    if (!topology) return state;
    return {
      ...state,
      subAgentTopology: {
        ...topology,
        workers: topology.workers.map(worker => ({
          ...worker,
          staging: worker.staging ? {
            ...worker.staging,
            isolatedRoot: '[host-owned staging root]',
            tempParent: '[host-owned staging root]',
            baselineBackupPath: '[host-owned baseline]',
            baselines: Object.fromEntries(Object.entries(worker.staging.baselines || {}).map(([rel, baseline]) => [rel, {
              ...baseline,
              backupPath: '[host-owned baseline]'
            }]))
          } : undefined
        }))
      }
    };
  }

  private authoritativeStatusText(state?: HarnessState): string {
    if (!state) return 'No governed run is active.';
    const task = state.taskGraph.tasks.find(item => item.status === 'running' || item.status === 'pending');
    const oracle = Object.entries(state.oracleStatuses).map(([name, value]) => `${name}: ${value}`).join(', ');
    const pending = state.executionContract?.status === 'pending'
      ? ` Execution contract confirmation required (${state.executionContract.authority.assurance}, ${state.executionContract.digest.slice(0, 12)}).`
      : state.pendingHumanApproval?.status === 'pending'
      ? ` Approval required for ${state.pendingHumanApproval.proposal.name}.`
      : state.clarifications?.some(item => item.status === 'pending')
        ? ` Waiting for clarification: ${state.clarifications.find(item => item.status === 'pending')?.question}`
        : '';
    return `Run ${state.status}. Phase ${state.firewall.stage}. Task: ${task?.title || 'none'}. Oracles: ${oracle}. Spend: $${Number(state.goalContract.spent || 0).toFixed(4)} of $${Number(state.runBudget.maxCostUsd || state.goalContract.budget || 0).toFixed(2)}.${pending}${state.haltReason ? ` ${state.haltReason}` : ''}`;
  }

  private async publishConversationText(sessionId: string, messages: any, text: string, modelId?: string, usage?: any): Promise<void> {
    await this.publishChatResponse(this.webview, sessionId, messages, text, modelId, usage);
  }

  public getWorkspaceIndexStatus(): WorkspaceIndexStatus {
    if (this.workspaceIndexBuilding) return { status: 'building', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false };
    if (this.workspaceIndexError) return { status: 'error', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false, error: this.workspaceIndexError };
    try { return new WorkspaceIndexService(getWorkspaceRoot()).status(); }
    catch (error: any) { return { status: 'error', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false, error: String(error?.message || error).slice(0, 500) }; }
  }

  public async buildWorkspaceIndex(): Promise<WorkspaceIndexStatus> {
    if (this.workspaceIndexBuilding) return this.getWorkspaceIndexStatus();
    const root = getWorkspaceRoot();
    this.workspaceIndexBuilding = true;
    this.workspaceIndexError = undefined;
    await this.publishWorkspaceIndexStatus();
    try {
      await runWorkspaceIndexWorker(root);
    } catch (error: any) {
      this.workspaceIndexError = String(error?.message || error).slice(0, 500);
    } finally {
      this.workspaceIndexBuilding = false;
    }
    return this.publishWorkspaceIndexStatus();
  }

  public getComposerContext(): ReturnType<ComposerContextService['summaries']> {
    return this.contextService().summaries(this.currentComposerContext());
  }

  public attachContextFile(filePath: string): ReturnType<ComposerContextService['summaries']> {
    this.addComposerContext(this.contextService().captureFile(filePath));
    return this.getComposerContext();
  }

  public clearComposerContext(): ReturnType<ComposerContextService['summaries']> {
    this.saveComposerContext([]);
    return this.getComposerContext();
  }

  public searchContextMentions(query: string): WorkspaceMentionSearchResult {
    return new WorkspaceIndexService(getWorkspaceRoot()).searchMentions(String(query || '').slice(0, 120), 20);
  }

  public attachContextMention(kind: 'file' | 'folder' | 'symbol', relativePath: string, symbolName?: string, line?: number): ReturnType<ComposerContextService['summaries']> {
    const report = new WorkspaceIndexService(getWorkspaceRoot()).load();
    if (!report) throw new Error('Build the Forge workspace index before using @ mentions.');
    const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
    if (kind === 'file') {
      if (!report.files.some(file => file.path === normalizedPath)) throw new Error('The selected file is not present in the validated workspace index.');
      this.addComposerContext(this.contextService().captureFile(normalizedPath));
    } else if (kind === 'folder') {
      if (!report.files.some(file => file.path.startsWith(`${normalizedPath}/`))) throw new Error('The selected folder is not present in the validated workspace index.');
      this.addComposerContext(this.contextService().captureFolder(normalizedPath, report.files.map(file => file.path)));
    } else if (kind === 'symbol') {
      const indexed = report.files.find(file => file.path === normalizedPath)?.symbols.find(symbol => symbol.name === symbolName && symbol.line === Number(line));
      if (!indexed) throw new Error('The selected symbol is not present in the validated workspace index. Rebuild the index if the file changed.');
      this.addComposerContext(this.contextService().captureSymbol(normalizedPath, indexed.name, indexed.line, report.files));
    } else {
      throw new Error('Unsupported context mention kind.');
    }
    return this.getComposerContext();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    this.webview = webviewView.webview;

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    void this.publishReadiness();
    void this.publishModes();
    void this.publishHumanApprovalPolicy();
    void this.publishAssuranceLevel();
    void this.publishWorkspaceIndexStatus();
    void this.publishPromptEnhancementSettings();
    this.harnessLoop.setProgressListener(event => {
      void webviewView.webview.postMessage({ command: 'run-progress', event });
    });
    const indexWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    let staleTimer: NodeJS.Timeout | undefined;
    const markIndexStale = (uri: vscode.Uri) => {
      let relative = '';
      try { relative = path.relative(getWorkspaceRoot(), uri.fsPath).replace(/\\/g, '/'); } catch { return; }
      if (!relative || relative === '.forge' || relative.startsWith('.forge/')) return;
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        try { new WorkspaceIndexService(getWorkspaceRoot()).markStale('workspace_file_changed'); } catch { /* no workspace/index yet */ }
        void this.publishWorkspaceIndexStatus();
      }, 250);
    };
    indexWatcher.onDidCreate(markIndexStale);
    indexWatcher.onDidChange(markIndexStale);
    indexWatcher.onDidDelete(markIndexStale);
    webviewView.onDidDispose(() => {
      this.harnessLoop.setProgressListener(undefined);
      indexWatcher.dispose();
      if (staleTimer) clearTimeout(staleTimer);
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'init': {
          try {
            const mode = this.modeRegistry.resolve(message.modeId || 'code');
            if (mode.intent !== 'code') throw new Error(`Mode '${mode.name}' is non-mutating. Select a code-capable mode before initializing a run.`);
            const userContext = this.currentComposerContext();
            const state = await this.harnessLoop.initializeHarness(message.goal, message.modelBindings, message.runBudget || {}, { modePolicy: toModePolicy(mode), humanApprovalPolicy: this.humanApprovalPolicy(), assuranceLevel: this.getAssuranceLevel(), userContext });
            this.sessionStore().saveContext(state.sessionId, userContext);
            this.activeChatSessionId = undefined;
            webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
          } catch (err: any) {
            vscode.window.showErrorMessage("Harness Initialization failed: " + err.message);
          }
          break;
        }
        case 'run-step': {
          try {
            const trustedState = this.harnessLoop.getDiagnostics()?.state as HarnessState | undefined;
            if (!trustedState) throw new Error('Initialize a Forge run before stepping it.');
            const state = await this.harnessLoop.runStep(trustedState, message.modelBindings);
            webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
          } catch (err: any) {
            vscode.window.showErrorMessage("Harness Run Step failed: " + err.message);
          }
          break;
        }
        case 'run-agent-loop': {
          try {
            await this.submitConversationMessage({ ...message, message: String(message.goal || ''), messages: [{ role: 'user', content: String(message.goal || '') }] });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message || 'Agent run failed.' });
          }
          break;
        }
        case 'load-composer-context': {
          this.publishComposerContext();
          break;
        }
        case 'search-context-mentions': {
          try {
            const result = this.searchContextMentions(String(message.query || ''));
            webviewView.webview.postMessage({ command: 'context-mention-results', requestId: String(message.requestId || ''), ...result });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'context-mention-results', requestId: String(message.requestId || ''), candidates: [], provenance: 'missing', truncated: false, error: err.message });
          }
          break;
        }
        case 'attach-context-mention': {
          try {
            this.attachContextMention(message.kind, String(message.path || ''), String(message.symbolName || ''), Number(message.line || 0));
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not attach @ mention: ${err.message}` });
          }
          break;
        }
        case 'add-active-context': {
          try {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== 'file') throw new Error('Open a workspace file before attaching editor context.');
            const service = this.contextService();
            const selection = editor.selection;
            const attachment = selection && !selection.isEmpty
              ? service.captureSelection(editor.document.uri.fsPath, selection.start.line + 1, selection.end.line + 1, editor.document.getText(selection))
              : service.captureFile(editor.document.uri.fsPath);
            this.addComposerContext(attachment);
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not attach editor context: ${err.message}` });
          }
          break;
        }
        case 'pick-context-file': {
          try {
            const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.forge,out,dist,build,coverage,.cache}/**', 2000);
            const root = getWorkspaceRoot();
            const choices = uris
              .filter(uri => uri.scheme === 'file' && isInsideWorkspace(uri.fsPath))
              .map(uri => ({ label: path.relative(root, uri.fsPath).replace(/\\/g, '/'), uri }))
              .sort((a, b) => a.label.localeCompare(b.label));
            const picked = await vscode.window.showQuickPick(choices, { placeHolder: 'Attach a workspace file to Forge', matchOnDescription: true });
            if (picked) this.addComposerContext(this.contextService().captureFile(picked.uri.fsPath));
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not attach workspace file: ${err.message}` });
          }
          break;
        }
        case 'pick-context-image': {
          try {
            const uris = await vscode.workspace.findFiles('**/*.{png,jpg,jpeg,webp}', '**/{node_modules,.git,.forge,out,dist,build,coverage,.cache}/**', 500);
            const root = getWorkspaceRoot();
            const choices = uris
              .filter(uri => uri.scheme === 'file' && isInsideWorkspace(uri.fsPath))
              .map(uri => ({ label: path.relative(root, uri.fsPath).replace(/\\/g, '/'), uri }))
              .sort((a, b) => a.label.localeCompare(b.label));
            const picked = await vscode.window.showQuickPick(choices, { placeHolder: 'Attach a workspace image to Forge', matchOnDescription: true });
            if (picked) this.addComposerContext(this.contextService().captureImage(picked.uri.fsPath));
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not attach workspace image: ${err.message}` });
          }
          break;
        }
        case 'add-diagnostics-context': {
          try {
            const entries = vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) => diagnostics.map(item => ({
              path: uri.fsPath,
              line: item.range.start.line + 1,
              severity: diagnosticSeverityName(item.severity),
              message: item.message
            })));
            this.addComposerContext(this.contextService().captureDiagnostics(entries));
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not attach diagnostics: ${err.message}` });
          }
          break;
        }
        case 'remove-composer-context': {
          const next = this.currentComposerContext().filter(item => item.id !== String(message.id || ''));
          this.saveComposerContext(next);
          break;
        }
        case 'clear-composer-context': {
          this.saveComposerContext([]);
          break;
        }
        case 'list-models': {
          try {
            const list = await this.harnessLoop.listModels();
            const readiness = await this.publishReadiness();
            webviewView.webview.postMessage({ command: 'models-list', models: list, provenance: readiness.catalog.status, liveCount: readiness.catalog.modelCount });
          } catch {
            webviewView.webview.postMessage({ command: 'models-list', models: [], provenance: 'error', liveCount: 0, error: 'Model catalog refresh failed.' });
          }
          break;
        }
        case 'load-readiness': {
          await this.publishReadiness();
          break;
        }
        case 'load-mcp-catalog':
        case 'refresh-mcp-catalog': {
          try { await this.refreshMcpCatalog(); }
          catch (err: any) { webviewView.webview.postMessage({ command: 'host-error', message: `MCP catalog refresh failed: ${err.message}` }); }
          break;
        }
        case 'add-mcp-server': {
          try { await this.addMcpServer(); }
          catch (err: any) { webviewView.webview.postMessage({ command: 'host-error', message: `MCP server was not added: ${err.message}` }); }
          break;
        }
        case 'remove-mcp-server': {
          try { await this.removeMcpServer(); }
          catch (err: any) { webviewView.webview.postMessage({ command: 'host-error', message: `MCP server was not removed: ${err.message}` }); }
          break;
        }
        case 'set-prompt-enhancement-model': {
          try { await this.setPromptEnhancementModel(String(message.modelId || '')); }
          catch (err: any) { webviewView.webview.postMessage({ command: 'host-error', message: `Prompt model was not updated: ${err.message}` }); }
          break;
        }
        case 'load-prompt-enhancement-settings': {
          await this.publishPromptEnhancementSettings();
          break;
        }
        case 'enhance-prompt': {
          try {
            const result = await this.enhanceDraft(String(message.draft || ''), String(message.modeId || 'code'));
            webviewView.webview.postMessage({ command: 'prompt-enhanced', result });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'prompt-enhancement-error', message: err.message || 'Prompt enhancement failed. The original draft was preserved.' });
          }
          break;
        }
        case 'open-mcp-catalog': {
          try { await openArtifact('mcp-catalog', proofRunner); }
          catch (err: any) { webviewView.webview.postMessage({ command: 'host-error', message: `MCP catalog is unavailable: ${err.message}` }); }
          break;
        }
        case 'load-human-approval-policy': {
          await this.publishHumanApprovalPolicy();
          break;
        }
        case 'load-assurance-level': {
          await this.publishAssuranceLevel();
          break;
        }
        case 'load-workspace-index-status': {
          await this.publishWorkspaceIndexStatus();
          break;
        }
        case 'build-workspace-index': {
          await this.buildWorkspaceIndex();
          break;
        }
        case 'open-workspace-index': {
          try { await openArtifact('workspaceIndex', proofRunner); }
          catch (err: any) { webviewView.webview.postMessage({ command: 'host-error', message: `Workspace index is unavailable: ${err.message}` }); }
          break;
        }
        case 'set-human-approval-policy': {
          await this.setHumanApprovalPolicy(message.policy);
          break;
        }
        case 'set-assurance-level': {
          await this.setAssuranceLevel(message.level);
          break;
        }
        case 'decide-execution-contract': {
          try {
            await this.resolveExecutionContract(message.decision === 'confirm' ? 'confirm' : 'reject', String(message.digest || ''), message.modelBindings || {});
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Execution contract decision failed: ${err.message}` });
          }
          break;
        }
        case 'resolve-human-approval': {
          try {
            let state = await this.resolveHumanApproval(message.decision === 'approve' ? 'approve' : 'reject', String(message.approvalId || ''), String(message.reason || ''), message.modelBindings || {});
            webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
            while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
              state = await this.harnessLoop.runStep(state, message.modelBindings || {});
              webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
            }
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Approval decision failed: ${err.message}` });
          }
          break;
        }
        case 'list-modes': {
          await this.publishModes();
          break;
        }
        case 'save-mode': {
          try {
            await this.modeRegistry.upsert(message.mode || {});
            await this.publishModes();
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'mode-error', message: err.message || 'Could not save mode.' });
          }
          break;
        }
        case 'delete-mode': {
          try {
            await this.modeRegistry.delete(String(message.modeId || ''));
            await this.publishModes();
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'mode-error', message: err.message || 'Could not delete mode.' });
          }
          break;
        }
        case 'report-problem': {
          try {
            const result = await vscode.commands.executeCommand<any>('forge-agent.reportProblem');
            webviewView.webview.postMessage({ command: 'support-report-ready', reportId: result?.report?.reportId });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message || 'Could not create support report.' });
          }
          break;
        }
        case 'save-openrouter-key': {
          try {
            const value = String(message.apiKey || '').trim();
            if (!value) throw new Error('OpenRouter API key cannot be empty.');
            await this.extensionContext.secrets.store(OPENROUTER_SECRET_KEY, value);
            setRuntimeOpenRouterApiKey(value);
            await this.publishReadiness(true);
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message || 'Could not save OpenRouter key.' });
          }
          break;
        }
        case 'clear-openrouter-key': {
          await this.extensionContext.secrets.delete(OPENROUTER_SECRET_KEY);
          setRuntimeOpenRouterApiKey('');
          await this.publishReadiness(true);
          break;
        }
        case 'open-workspace': {
          await vscode.commands.executeCommand('workbench.action.files.openFolder');
          break;
        }
        case 'load-state': {
          try {
            const active = this.sessionStore().loadActive();
            if (active) {
              if (active.state) {
                this.harnessLoop.loadPersistedSession(active.meta.sessionId);
                this.activeChatSessionId = undefined;
              } else {
                this.harnessLoop.clearActiveSession();
                this.activeChatSessionId = active.meta.sessionId;
              }
              webviewView.webview.postMessage({ command: 'session-loaded', ...active, state: active.state ? this.webviewState(active.state) : undefined, resumed: false });
            } else {
              const state = this.harnessLoop.loadPersistedSession();
              if (state) webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
            }
          } catch (err) {}
          break;
        }
        case 'open-artifact': {
          try {
            await openArtifact(String(message.artifact || ''), proofRunner);
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message });
          }
          break;
        }
        case 'run-proof-matrix': {
          try {
            const report = await proofRunner.run(message.options || {});
            await persistLatestProofReport(report);
            webviewView.webview.postMessage({ command: 'proof-report', report });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Proof matrix failed: ${err.message}` });
          }
          break;
        }
        case 'run-weak-model-eval': {
          try {
            const report = await weakEvalRunner.run({
              ...(message.options || {}),
              reportRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
            });
            webviewView.webview.postMessage({ command: 'weak-eval-report', report });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Weak model eval failed: ${err.message}` });
          }
          break;
        }
        case 'run-difficult-live-proof': {
          const progressPath = path.join(getWorkspaceRoot(), '.forge', 'evals', 'latest-weak-model-eval-tier4.json');
          const proofStartedAt = Date.now();
          let lastProgress = '';
          const timer = setInterval(() => {
            try {
              if (fs.statSync(progressPath).mtimeMs < proofStartedAt) return;
              const progress = fs.readFileSync(progressPath, 'utf8');
              if (progress !== lastProgress) {
                lastProgress = progress;
                const parsed = JSON.parse(progress);
                void webviewView.webview.postMessage({ command: 'difficult-proof-progress', progress: {
                  completedTaskCount: parsed.completedTaskCount || 0,
                  taskCount: parsed.taskCount || 0,
                  providerCalls: parsed.providerCalls || 0,
                  providerFailures: parsed.providerFailures || 0,
                  costUsd: parsed.cost || 0,
                  partial: parsed.partial === true
                } });
              }
            } catch { /* report appears after the first completed task */ }
          }, 1500);
          try {
            const report = await vscode.commands.executeCommand<any>('forge-agent.runDifficultWeakModelProof', message.options || {});
            webviewView.webview.postMessage({ command: 'difficult-proof-report', report });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Difficult live proof failed: ${err.message}` });
          } finally {
            clearInterval(timer);
          }
          break;
        }
        case 'run-production-benchmark': {
          try {
            const report = await vscode.commands.executeCommand<any>('forge-agent.runProductionBenchmark', message.options || {});
            webviewView.webview.postMessage({ command: 'production-benchmark-report', report });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Production benchmark failed: ${err.message}` });
          }
          break;
        }
        case 'run-verification-fixture-matrix': {
          try {
            const report = await runVerificationFixtureMatrix(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
            webviewView.webview.postMessage({ command: 'verification-matrix-report', report });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Verification fixture matrix failed: ${err.message}` });
          }
          break;
        }
        case 'run-isolated-agent-goal': {
          try {
            const report = await runIsolatedAgentGoal({
              ...(message.options || {}),
              sourceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
              goal: message.options?.goal || message.goal || 'Run Forge Agent in an isolated workspace copy.',
              modelBindings: message.modelBindings || message.options?.modelBindings || {},
              keepIsolated: true
            });
            webviewView.webview.postMessage({ command: 'isolated-run-report', report });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Isolated run failed: ${err.message}` });
          }
          break;
        }
        case 'open-native-settings': {
          try {
            await vscode.commands.executeCommand('forge-agent.openNativeSettings');
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message });
          }
          break;
        }
        case 'open-terminal': {
          try {
            await vscode.commands.executeCommand('forge-agent.openTerminal');
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message });
          }
          break;
        }
        case 'open-diff': {
          try {
            await vscode.commands.executeCommand('forge-agent.openDiff');
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message });
          }
          break;
        }
        case 'restore-checkpoint': {
          try {
            const state = await this.harnessLoop.restoreCheckpoint(String(message.checkpointId || ''));
            webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
            webviewView.webview.postMessage({ command: 'chat-response', text: `Restored checkpoint ${message.checkpointId}. Later evidence and reviews were invalidated; fresh verification is required.` });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Checkpoint restore failed: ${err.message}` });
          }
          break;
        }
        case 'submit-message':
        case 'chat': {
          try {
            await this.submitConversationMessage(message);
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'chat-response', error: err.message || 'Chat failed.' });
          }
          break;
        }
        case 'list-sessions': {
          try {
            webviewView.webview.postMessage({ command: 'sessions-list', ...this.listSessions() });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'sessions-list', sessions: [], error: err.message });
          }
          break;
        }
        case 'load-session': {
          try {
            const loaded = this.openSession(String(message.sessionId || ''));
            webviewView.webview.postMessage({ command: 'session-loaded', ...loaded, state: loaded.state ? this.webviewState(loaded.state) : undefined, resumed: false });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not load session: ${err.message}` });
          }
          break;
        }
        case 'resume-session': {
          try {
            const loaded = await this.resumeSession(String(message.sessionId || ''), message.modelBindings || {});
            webviewView.webview.postMessage({ command: 'session-loaded', ...loaded, state: loaded.state ? this.webviewState(loaded.state) : undefined, resumed: loaded.meta.resumable === true });
            webviewView.webview.postMessage({ command: 'sessions-list', ...this.listSessions() });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not resume session: ${err.message}` });
          }
          break;
        }
        case 'pin-session': {
          try {
            webviewView.webview.postMessage({ command: 'sessions-list', ...this.sessionStore().pin(String(message.sessionId || ''), message.pinned === true) });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Pin failed: ${err.message}` });
          }
          break;
        }
        case 'save-chat': {
          try {
            this.sessionStore().saveChat(String(message.sessionId || ''), message.messages);
          } catch { /* chat persistence must never break the panel */ }
          break;
        }
        case 'delete-session': {
          try {
            webviewView.webview.postMessage({ command: 'sessions-list', ...this.deleteSession(String(message.sessionId || '')) });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not delete session: ${err.message}` });
          }
          break;
        }
        case 'pause-goal': {
          writeRunControl({ paused: true, requestedAt: new Date().toISOString() });
          webviewView.webview.postMessage({ command: 'control-update', paused: true });
          break;
        }
        case 'resume-goal': {
          try {
            writeRunControl({ paused: false, requestedAt: new Date().toISOString() });
            webviewView.webview.postMessage({ command: 'control-update', paused: false });
            let state = this.harnessLoop.getDiagnostics()?.state;
            if (state && !['success', 'failed', 'gave_up'].includes(state.status)) {
              if (state.status === 'paused') {
                // One step lets applyControl consume the cleared pause flag.
                state = await this.harnessLoop.runStep(state, message.modelBindings || {});
                webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
              }
              while (!['success', 'failed', 'gave_up', 'paused', 'awaiting_input', 'awaiting_approval'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
                state = await this.harnessLoop.runStep(state, message.modelBindings || {});
                webviewView.webview.postMessage({ command: 'state-update', state: this.webviewState(state) });
              }
            }
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: err.message || 'Resume failed.' });
          }
          break;
        }
        case 'open-file': {
          try {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
              const root = fs.realpathSync(folders[0].uri.fsPath);
              const fullPath = path.resolve(root, message.path);
              const realParent = fs.existsSync(fullPath) ? fs.realpathSync(fullPath) : fs.realpathSync(path.dirname(fullPath));
              if ((realParent === root || realParent.startsWith(root + path.sep)) && fs.existsSync(fullPath)) {
                const doc = await vscode.workspace.openTextDocument(fullPath);
                await vscode.window.showTextDocument(doc);
              }
            }
          } catch (err) {}
          break;
        }
      }
    });
  }

  private async publishPromptEnhancementSettings(): Promise<void> {
    const modelId = vscode.workspace.getConfiguration('forge').get<string>('promptEnhancementModel', 'google/gemini-2.5-flash-lite');
    await this.webview?.postMessage({ command: 'prompt-enhancement-settings', modelId });
  }

  private sessionStore(): SessionStore {
    return new SessionStore(getWorkspaceRoot());
  }

  private contextService(): ComposerContextService {
    return new ComposerContextService(getWorkspaceRoot());
  }

  private currentContextSessionId(): string | undefined {
    return this.harnessLoop.getDiagnostics()?.state?.sessionId || this.activeChatSessionId;
  }

  private currentComposerContext(sessionId = this.currentContextSessionId()): ComposerContextAttachment[] {
    if (!sessionId) return [];
    try { return this.sessionStore().load(sessionId).context; } catch { return []; }
  }

  private addComposerContext(attachment: ComposerContextAttachment): void {
    const sessionId = this.currentContextSessionId() || this.ensureConversationSession('Workspace context');
    const next = this.contextService().append(this.currentComposerContext(sessionId), attachment);
    this.sessionStore().saveContext(sessionId, next);
    void this.publishComposerContext(sessionId);
  }

  private saveComposerContext(attachments: ComposerContextAttachment[]): void {
    const sessionId = this.currentContextSessionId();
    if (!sessionId) return;
    const saved = this.sessionStore().saveContext(sessionId, attachments);
    const state = this.harnessLoop.getDiagnostics()?.state as HarnessState | undefined;
    if (state?.sessionId === sessionId && ['idle', 'paused'].includes(state.status)) state.userContext = saved;
    void this.publishComposerContext(sessionId);
  }

  private async publishComposerContext(sessionId = this.currentContextSessionId()): Promise<void> {
    const attachments = this.currentComposerContext(sessionId);
    await this.webview?.postMessage({ command: 'composer-context', sessionId, attachments: this.contextService().summaries(attachments) });
  }

  private ensureConversationSession(firstMessage: string): string {
    const runSessionId = this.harnessLoop.getDiagnostics()?.state?.sessionId;
    if (runSessionId) return runSessionId;
    if (this.activeChatSessionId) {
      try { this.sessionStore().load(this.activeChatSessionId); return this.activeChatSessionId; } catch { this.activeChatSessionId = undefined; }
    }
    const created = this.sessionStore().createChat(firstMessage);
    this.activeChatSessionId = created.meta.sessionId;
    return created.meta.sessionId;
  }

  private async publishChatResponse(webview: vscode.Webview | undefined, sessionId: string, messages: any, text: string, modelId?: string, usage?: any): Promise<void> {
    const history = Array.isArray(messages) ? messages : [];
    this.sessionStore().saveChat(sessionId, [...history, { role: 'assistant', content: text, ...(modelId ? { modelId } : {}) }]);
    await webview?.postMessage({ command: 'chat-response', sessionId, text, modelId, usage });
    await webview?.postMessage({ command: 'sessions-list', ...this.listSessions() });
  }

  private async publishReadiness(force = false): Promise<ProviderReadiness> {
    const fresh = this.readinessCache && Date.now() - Date.parse(this.readinessCache.checkedAt) < 30_000;
    if (!force && fresh) {
      await this.webview?.postMessage({ command: 'provider-readiness', readiness: this.readinessCache });
      return this.readinessCache!;
    }
    if (!this.readinessProbe || force) {
      this.readinessProbe = providerReadiness(this.extensionContext).then(result => {
        this.readinessCache = result;
        return result;
      }).finally(() => { this.readinessProbe = undefined; });
    }
    const readiness = await this.readinessProbe;
    await this.webview?.postMessage({ command: 'provider-readiness', readiness });
    return readiness;
  }

  private async publishModes(): Promise<AgentMode[]> {
    const modes = this.modeRegistry.list();
    await this.webview?.postMessage({ command: 'modes-list', modes });
    return modes;
  }

  private humanApprovalPolicy(): HumanApprovalPolicy {
    return vscode.workspace.getConfiguration('forge').get<HumanApprovalPolicy>('humanApprovalPolicy', 'ask') === 'auto' ? 'auto' : 'ask';
  }

  private async publishHumanApprovalPolicy(): Promise<void> {
    await this.webview?.postMessage({ command: 'human-approval-policy', policy: this.humanApprovalPolicy() });
  }

  private async publishAssuranceLevel(): Promise<void> {
    await this.webview?.postMessage({ command: 'assurance-level', level: this.getAssuranceLevel() });
  }

  private async publishWorkspaceIndexStatus(): Promise<WorkspaceIndexStatus> {
    const status = this.getWorkspaceIndexStatus();
    await this.webview?.postMessage({ command: 'workspace-index-status', status });
    return status;
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'assets', 'index.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'assets', 'index.css')
    );

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${cssUri}" rel="stylesheet" />
        <title>Forge Studio</title>
      </head>
      <body class="bg-[#1e1e1e] text-[#cccccc] font-sans antialiased select-none">
        <div id="root" data-testid="forge-root"></div>
        <script type="module" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function runWorkspaceIndexWorker(root: string): Promise<void> {
  const workerPath = path.join(__dirname, 'harness', 'workspaceIndexWorker.js');
  const allowedEnvironment = ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'PATHEXT', 'COMSPEC'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedEnvironment) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.ELECTRON_RUN_AS_NODE = '1';
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [workerPath, root], { cwd: root, env, timeout: 120_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      try {
        const parsed = JSON.parse(stdout || '{}');
        if (!Number.isFinite(parsed.fileCount) || !String(parsed.fingerprint || '')) throw new Error('Index worker returned an invalid report.');
        resolve();
      } catch (parseError: any) {
        reject(new Error(`Index worker output was invalid: ${parseError.message}`));
      }
    });
  });
}

async function migrateLegacyOpenRouterCredential(context: vscode.ExtensionContext): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('forge');
  const existingSecret = await context.secrets.get(OPENROUTER_SECRET_KEY);
  const legacyValue = String(configuration.get<string>('openRouterApiKey', '') || '');
  await migrateLegacyCredential(
    legacyValue,
    existingSecret,
    async value => { await context.secrets.store(OPENROUTER_SECRET_KEY, value); },
    async () => {
      const inspected = configuration.inspect<string>('openRouterApiKey');
      if (inspected?.globalValue !== undefined) await configuration.update('openRouterApiKey', undefined, vscode.ConfigurationTarget.Global);
      if (inspected?.workspaceValue !== undefined) await configuration.update('openRouterApiKey', undefined, vscode.ConfigurationTarget.Workspace);
      if (inspected?.workspaceFolderValue !== undefined) await configuration.update('openRouterApiKey', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  );
  setRuntimeOpenRouterApiKey((await context.secrets.get(OPENROUTER_SECRET_KEY)) || '');
}

async function providerReadiness(context: vscode.ExtensionContext): Promise<ProviderReadiness> {
  const configuration = vscode.workspace.getConfiguration('forge');
  const provider = configuration.get<'openrouter' | 'openai-compatible'>('providerDefault', 'openrouter');
  const secret = await context.secrets.get(OPENROUTER_SECRET_KEY);
  const environmentKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  return probeProviderReadiness({
    provider,
    workspaceOpen: Boolean(vscode.workspace.workspaceFolders?.length),
    apiKey: secret || environmentKey,
    credentialSource: secret ? 'secret-storage' : environmentKey ? 'environment' : 'none',
    openAiCompatibleBaseUrl: configuration.get<string>('openAiCompatibleBaseUrl', 'http://localhost:11434/v1')
  });
}

async function runChatCompletion(options: {
  messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  modelId?: string;
  sessionId?: string;
  mode?: AgentMode;
  userContext?: ComposerContextAttachment[];
}): Promise<{ text: string; usage?: any; modelId: string }> {
  const provider = createConfiguredProvider();
  const modelId = options.modelId || OpenRouterProvider.mixedModel();
  const sessionId = options.sessionId || `forge-chat-${Date.now()}`;
  // Attached research artifacts ground every subsequent chat turn (capped).
  const researchContext = attachedResearch.slice(-2).map(artifactPath => {
    try {
      return { role: 'system' as const, content: `Attached research artifact (${path.basename(artifactPath)}) — treat as verified workspace context:\n${fs.readFileSync(artifactPath, 'utf8').slice(0, 8000)}` };
    } catch {
      return null;
    }
  }).filter(Boolean) as { role: 'system'; content: string }[];
  const messages = (options.messages || []).filter(message =>
    ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string' && message.content.trim()
  );
  const userContext = new ComposerContextService(getWorkspaceRoot()).renderForPrompt(options.userContext || []);

  const result = await provider.generateChat({
    modelId,
    sessionId,
    fallbackModels: [OpenRouterProvider.mixedModel(), OpenRouterProvider.codingModel(), 'meta-llama/llama-3.3-70b-instruct'],
    messages: [
      {
        role: 'system',
        content: [
          'You are Forge Agent inside the Forge Studio panel (a VS Code/Antigravity extension).',
          'This invocation is the controller-selected read-only answer route. Explain and inspect supplied context, but do not claim to have changed files or run commands.',
          'The same composer accepts implementation requests. The deterministic extension host routes those requests into the governed Forge harness automatically; there is no separate Run button.',
          'Optional explicit syntax is "/goal <objective>" with lines such as "done when:", "constraints:", "budget: $N", and "max steps: N".',
          'The governed harness performs changes through PROPOSE -> VALIDATE -> COMMIT -> NARRATE and reports success only with same-run green oracle evidence.',
          'Pause, resume, approvals, clarifications, progress, and evidence remain in the same conversation. Artifacts open in native IDE surfaces.',
          'There are NO commands named "Forge: Propose" or "PROPOSE run", NO manual commit step, and NO command-palette workflow for this - never instruct the user to paste code into files themselves; that defeats the agent.',
          'The user can also type "/research <question>" in this composer for web-grounded deep research; the resulting artifact attaches to this conversation as context.',
          'If a mutation request reaches this read-only route, state that Forge needs confirmation or a code-capable mode; never pretend the advisory response performed work.',
          'If asked about UI you are not certain exists, say you are not certain instead of inventing steps.'
        ].join('\n')
      },
      ...(options.mode ? [{ role: 'system' as const, content: `Trusted Forge mode: ${options.mode.name} (${options.mode.intent}).\n${options.mode.instructions}\nFor this answer route, remain read-only. Mutation authority belongs only to the host-routed governed harness.` }] : []),
      ...(userContext ? [{ role: 'system' as const, content: `User-attached workspace context captured and validated by the extension host:\n${userContext}` }] : []),
      ...researchContext,
      ...messages.slice(-12)
    ]
  });

  return { text: result.text || '(empty response)', usage: result.usage, modelId };
}

function toModePolicy(mode: AgentMode): ModePolicy {
  if (mode.intent !== 'code') throw new Error(`Mode '${mode.name}' cannot create an agentic coding policy.`);
  return { id: mode.id, name: mode.name, intent: 'code', instructions: mode.instructions, allowedTools: [...mode.allowedTools] };
}

function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    throw new Error('No workspace folder is open.');
  }
  return fs.realpathSync(folders[0].uri.fsPath);
}

function createMcpGateway(context: vscode.ExtensionContext): McpToolGateway {
  return new McpToolGateway({
    workspaceRoot: getWorkspaceRoot,
    resolveWorkspacePath: resolveContainedWorkspacePath,
    servers: () => {
      const configured = vscode.workspace.getConfiguration('forge').get<any[]>('mcpServers', []);
      return Array.isArray(configured) ? configured as McpServerConfig[] : [];
    },
    getSecret: key => context.secrets.get(`forge.mcp.${key}`),
    timeoutMs: Math.max(1_000, Math.min(120_000, vscode.workspace.getConfiguration('forge').get<number>('mcpTimeoutMs', 30_000)))
  });
}

async function promptForMcpServerConfig(): Promise<McpServerConfig> {
  const id = String(await vscode.window.showInputBox({
    prompt: 'MCP server ID',
    placeHolder: 'my-local-server',
    validateInput: value => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.trim()) ? undefined : 'Use 1-64 letters, numbers, dots, underscores, or hyphens.'
  }) || '').trim();
  if (!id) throw new Error('MCP server onboarding was cancelled.');
  const transport = await vscode.window.showQuickPick([
    { label: 'Local stdio', value: 'stdio' as const, description: 'Launch a local command and communicate over stdio.' },
    { label: 'Loopback HTTP', value: 'streamable-http' as const, description: 'Connect only to localhost/127.0.0.1/::1 Streamable HTTP.' }
  ], { placeHolder: 'Choose the governed MCP transport' });
  if (!transport) throw new Error('MCP server onboarding was cancelled.');

  let command: string | undefined;
  let args: string[] | undefined;
  let url: string | undefined;
  if (transport.value === 'stdio') {
    command = String(await vscode.window.showInputBox({ prompt: 'Local MCP command', placeHolder: 'npx' }) || '').trim();
    if (!command) throw new Error('A local stdio MCP server requires a command.');
    const argsInput = await vscode.window.showInputBox({ prompt: 'Command arguments as a JSON array', value: '[]' });
    if (argsInput === undefined) throw new Error('MCP server onboarding was cancelled.');
    const rawArgs = String(argsInput).trim();
    args = parseStringArray(rawArgs, 'MCP command arguments');
  } else {
    url = String(await vscode.window.showInputBox({ prompt: 'Loopback Streamable HTTP URL', placeHolder: 'http://127.0.0.1:3000/mcp' }) || '').trim();
    if (!url) throw new Error('A loopback HTTP MCP server requires a URL.');
  }

  const toolsInput = await vscode.window.showInputBox({
    prompt: 'Explicit tool policies as JSON keyed by exact tool name. Use {} to configure the server with no authorized tools yet.',
    value: '{}',
    ignoreFocusOut: true
  });
  if (toolsInput === undefined) throw new Error('MCP server onboarding was cancelled.');
  const rawTools = String(toolsInput).trim();
  const tools = parseToolPolicies(rawTools);
  return {
    id,
    name: id,
    enabled: true,
    transport: transport.value,
    command,
    args,
    url,
    tools
  };
}

function parseStringArray(raw: string, label: string): string[] {
  let value: unknown;
  try { value = JSON.parse(raw || '[]'); } catch { throw new Error(`${label} must be valid JSON.`); }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string') || value.length > 100) throw new Error(`${label} must be a JSON array of at most 100 strings.`);
  return value.map(String);
}

function parseToolPolicies(raw: string): McpServerConfig['tools'] {
  let value: unknown;
  try { value = JSON.parse(raw || '{}'); } catch { throw new Error('MCP tool policies must be valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP tool policies must be a JSON object keyed by exact tool name.');
  return value as McpServerConfig['tools'];
}

function diagnosticSeverityName(severity: vscode.DiagnosticSeverity): string {
  if (severity === vscode.DiagnosticSeverity.Error) return 'error';
  if (severity === vscode.DiagnosticSeverity.Warning) return 'warning';
  if (severity === vscode.DiagnosticSeverity.Information) return 'information';
  return 'hint';
}

function resolveContainedWorkspacePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Artifact path must be workspace-relative: ${relativePath}`);
  }
  const root = getWorkspaceRoot();
  const fullPath = path.resolve(root, relativePath);
  let parent = path.dirname(fullPath);
  while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
    parent = path.dirname(parent);
  }
  const realParent = fs.existsSync(fullPath) ? fs.realpathSync(fullPath) : fs.realpathSync(parent);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (realParent !== root && !realParent.startsWith(rootPrefix)) {
    throw new Error(`Artifact path escapes the workspace: ${relativePath}`);
  }
  return fullPath;
}

async function openArtifact(artifact: string, runner: BlueprintProofRunner): Promise<string> {
  const artifactPaths: Record<string, string> = {
    plan: 'PLAN.md',
    'mcp-catalog': '.forge/mcp-catalog.json',
    scratchpad: 'SCRATCHPAD.md',
    todos: 'todos.json',
    evidence: 'evidence_ledger.json',
    state: path.join('.forge', 'state.json'),
    executionContract: path.join('.forge', 'execution-contract.json'),
    context: path.join('.forge', 'context-bundle.json'),
    retrieval: path.join('.forge', 'retrieval-index.json'),
    workspaceIndex: path.join('.forge', 'workspace-index.json'),
    handoffs: path.join('.forge', 'role-handoffs.json'),
    workerContexts: path.join('.forge', 'worker-contexts.json'),
    subAgentTopology: path.join('.forge', 'subagent-topology.json'),
    subAgentHandoffs: path.join('.forge', 'subagent-handoffs.json'),
    subAgentMerges: path.join('.forge', 'subagent-merges.json'),
    subAgentMetrics: path.join('.forge', 'subagent-metrics.json'),
    runtimeIsolation: path.join('.forge', 'runtime-isolation.json'),
    contextOptimization: path.join('.forge', 'context-optimization.json'),
    modelRouting: path.join('.forge', 'model-routing.json'),
    topologyEval: path.join('.forge', 'evals', 'latest-plan-big-execute-small.json'),
    blockers: path.join('.forge', 'blockers.json'),
    semanticRetrieval: path.join('.forge', 'semantic-retrieval.json'),
    editTransactions: path.join('.forge', 'worker-edit-transactions.json'),
    commandTransactions: path.join('.forge', 'worker-command-transactions.json'),
    workflow: path.join('.forge', 'workflow-governance.json'),
    workflowRecord: path.join('.forge', 'workflow-task-record.md'),
    projectAdapter: path.join('.forge', 'project-adapter.json'),
    oracleFailures: path.join('.forge', 'oracle-failures.json'),
    clarifications: path.join('.forge', 'clarifications.json'),
    architectHandoff: path.join('.forge', 'architect-handoff.json'),
    safety: path.join('.forge', 'safety-checkpoints.json'),
    checkpointRestores: path.join('.forge', 'checkpoint-restores.json'),
    browserValidations: path.join('.forge', 'browser-runs', 'latest-browser-validation.json'),
    browserScreenshot: path.join('.forge', 'browser-runs', 'latest-browser-validation.png'),
    browserInteraction: path.join('.forge', 'browser-sessions', 'latest-browser-state.json'),
    browserInteractionScreenshot: path.join('.forge', 'browser-sessions', 'latest-browser-state.png'),
    computerInteraction: path.join('.forge', 'computer-sessions', 'latest-computer-state.json'),
    computerInteractionScreenshot: path.join('.forge', 'computer-sessions', 'latest-computer-state.png'),
    commandEffects: path.join('.forge', 'command-effects.json'),
    budget: path.join('.forge', 'budget.json'),
    isolatedRun: path.join('.forge', 'isolated-runs', 'latest-isolated-run.json'),
    isolatedDiff: path.join('.forge', 'isolated-runs', 'latest-isolated-run.diff'),
    critiques: path.join('.forge', 'reviewer-critiques.json'),
    precommit: path.join('.forge', 'precommit-reviews.json'),
    proof: path.join('.forge', 'latest-proof-report.json'),
    weakEval: path.join('.forge', 'evals', 'latest-weak-model-eval.json'),
    reflectionAb: path.join('.forge', 'evals', 'latest-reflection-ab.json'),
    aar: path.join('.forge', 'aar.json'),
    lessons: path.join('.forge', 'lessons.json'),
    skills: path.join('.forge', 'skill-registry.json'),
    verificationMatrix: path.join('.forge', 'verification-fixture-matrix.json')
    ,support: path.join('.forge', 'support', 'latest-support-report.md')
    ,difficultProof: path.join('.forge', 'evals', 'latest-difficult-live-proof.json')
    ,productionBenchmark: path.join('.forge', 'evals', 'latest-production-benchmark.json')
  };

  const relativePath = artifactPaths[artifact];
  if (!relativePath) {
    throw new Error(`Unknown Forge artifact: ${artifact}`);
  }

  if (artifact === 'proof') {
    await persistLatestProofReport(runner.getLatestReport() || null);
  }

  let fullPath = resolveContainedWorkspacePath(relativePath);
  if (artifact === 'evidence' && !fs.existsSync(fullPath)) {
    fullPath = resolveContainedWorkspacePath(path.join('.forge', 'evidence-ledger.json'));
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Forge artifact does not exist yet: ${relativePath}`);
  }

  if (path.extname(fullPath).toLowerCase() === '.png') {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fullPath));
  } else {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }
  return fullPath;
}

async function createSupportReport(context: vscode.ExtensionContext, provider: ForgeStudioWebviewProvider, options: any = {}): Promise<any> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const readiness = await provider.refreshReadiness(false);
  const state = provider.diagnostics()?.state;
  const result = writeSupportReport(workspaceRoot, {
    extensionVersion: String(context.extension.packageJSON.version || 'unknown'),
    ideName: vscode.env.appName,
    ideVersion: vscode.version,
    platform: process.platform,
    architecture: process.arch
  }, readiness, state, context.globalStorageUri.fsPath);

  if (options.copy !== false) await vscode.env.clipboard.writeText(fs.readFileSync(result.markdownPath, 'utf8'));
  if (options.openReport !== false) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.markdownPath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }
  if (options.offerIssue !== false) {
    const action = await vscode.window.showInformationMessage('Redacted Forge support report created and copied. No source, prompts, chat, credentials, or full paths were included.', 'Open GitHub Issue');
    if (action === 'Open GitHub Issue') {
      const title = encodeURIComponent(`[Support] Forge ${result.report.environment.extensionVersion} issue`);
      await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/KennyG1990/Agent_Harness_Extension/issues/new?title=${title}`));
    }
  }
  return result;
}

async function persistLatestProofReport(report: any): Promise<string> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return '';
  }
  const reportPath = resolveContainedWorkspacePath(path.join('.forge', 'latest-proof-report.json'));
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report || { generatedAt: new Date().toISOString(), passed: false, models: [], note: 'No proof report has been generated in this extension host session.' }, null, 2), 'utf8');
  return reportPath;
}

async function openNativeDiff(): Promise<string> {
  const activePath = vscode.window.activeTextEditor?.document.uri;
  if (activePath?.scheme === 'file' && isInsideWorkspace(activePath.fsPath)) {
    try {
      await vscode.commands.executeCommand('git.openChange', activePath);
      return activePath.fsPath;
    } catch {
      // Fall through to a patch document if the built-in Git command is unavailable.
    }
  }

  const root = getWorkspaceRoot();
  const diffText = await new Promise<string>(resolve => {
    exec('git diff -- .', { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      resolve(error ? stderr || stdout || 'No git diff available.' : stdout || 'No workspace changes.');
    });
  });
  const diffPath = resolveContainedWorkspacePath(path.join('.forge', 'latest-workspace.diff'));
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, diffText, 'utf8');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(diffPath));
  await vscode.window.showTextDocument(doc, { preview: false });
  return diffPath;
}

function runControlPath(): string {
  return path.join(getWorkspaceRoot(), '.forge', 'control.json');
}

function readRunControl(): any {
  try {
    return JSON.parse(fs.readFileSync(runControlPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeRunControl(control: any): void {
  const filePath = runControlPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(control, null, 2), 'utf8');
}

function isInsideWorkspace(filePath: string): boolean {
  try {
    const root = getWorkspaceRoot();
    const realPath = fs.realpathSync(filePath);
    const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
    return realPath === root || realPath.startsWith(rootPrefix);
  } catch {
    return false;
  }
}
