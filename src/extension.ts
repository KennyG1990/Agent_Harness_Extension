import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { AgentHarnessLoop } from './harness/loop';
import { HarnessState } from './harness/types';
import { BlueprintProofRunner } from './harness/proof';
import { createConfiguredProvider, OpenRouterProvider } from './harness/provider';
import { WeakModelEvalRunner } from './harness/weakEval';
import { runVerificationFixtureMatrix } from './harness/verificationMatrix';
import { runIsolatedAgentGoal } from './harness/isolation';
import { runReflectionAbEval } from './harness/reflectionAb';
import { directiveToGoalOverrides, parseGoalDirective } from './harness/goalContract';
import { runDeepResearch } from './harness/research';

/** Research artifacts attached to the live chat context this extension-host session. */
const attachedResearch: string[] = [];

let activeProvider: ForgeStudioWebviewProvider | undefined;
const proofRunner = new BlueprintProofRunner();
const weakEvalRunner = new WeakModelEvalRunner();

export function activate(context: vscode.ExtensionContext) {
  console.log('Forge Agent Extension is now active.');

  const provider = new ForgeStudioWebviewProvider(context.extensionUri);
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
      return runChatCompletion(options || {});
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.runAgentGoal', async (options?: any) => {
      const loop = new AgentHarnessLoop();
      const rawGoal = String(options?.goal || 'Validate the workspace with Forge Agent.');
      const directive = parseGoalDirective(rawGoal);
      const goalOverrides = directive.isDirective
        ? { ...directiveToGoalOverrides(directive), ...(options?.goalOverrides || {}) }
        : options?.goalOverrides;
      let state = await loop.initializeHarness(directive.isDirective ? directive.goal : rawGoal, options?.modelBindings || {}, options?.runBudget || {}, { goalOverrides });
      while (!['success', 'failed', 'gave_up', 'paused'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
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
    vscode.commands.registerCommand('forge-agent.steerGoal', (edit?: any) => {
      const current = readRunControl();
      writeRunControl({ ...(current || {}), editedGoal: edit || {}, requestedAt: new Date().toISOString() });
      return { steered: true, edit: edit || {} };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('forge-agent.resumeAgentGoal', async (options?: any) => {
      const loop = new AgentHarnessLoop();
      let state = await loop.resumeFromDisk({
        additionalSteps: options?.additionalSteps,
        allowBudgetHaltResume: options?.allowBudgetHaltResume === true
      });
      if (!state) {
        return null;
      }
      while (!['success', 'failed', 'gave_up', 'paused'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
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

  constructor(private readonly extensionUri: vscode.Uri) {
    this.harnessLoop = new AgentHarnessLoop();
  }

  public diagnostics(): any {
    return this.harnessLoop.getDiagnostics();
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

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'init': {
          try {
            const state = await this.harnessLoop.initializeHarness(message.goal, message.modelBindings, message.runBudget || {});
            webviewView.webview.postMessage({ command: 'state-update', state });
          } catch (err: any) {
            vscode.window.showErrorMessage("Harness Initialization failed: " + err.message);
          }
          break;
        }
        case 'run-step': {
          try {
            const state = await this.harnessLoop.runStep(message.state, message.modelBindings);
            webviewView.webview.postMessage({ command: 'state-update', state });
          } catch (err: any) {
            vscode.window.showErrorMessage("Harness Run Step failed: " + err.message);
          }
          break;
        }
        case 'run-agent-loop': {
          try {
            // /goal typed into the composer gets full elicitation in the UI path too.
            const rawGoal = String(message.goal || '');
            const directive = parseGoalDirective(rawGoal);
            const config = vscode.workspace.getConfiguration('forge');
            const configBudget = {
              maxCostUsd: config.get<number>('maxCostUsd', 1),
              maxWallClockMs: Math.max(1, config.get<number>('maxWallClockMinutes', 30)) * 60 * 1000
            };
            const goalOverrides = directive.isDirective ? directiveToGoalOverrides(directive) : { maxSteps: config.get<number>('maxSteps', 30) };
            let state = await this.harnessLoop.initializeHarness(
              directive.isDirective ? directive.goal : rawGoal,
              message.modelBindings,
              { ...configBudget, ...(message.runBudget || {}) },
              { reflectionEnabled: config.get<boolean>('reflectionEnabled', true), goalOverrides }
            );
            webviewView.webview.postMessage({ command: 'state-update', state });
            while (!['success', 'failed', 'gave_up', 'paused'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
              state = await this.harnessLoop.runStep(state, message.modelBindings);
              webviewView.webview.postMessage({ command: 'state-update', state });
            }
          } catch (err: any) {
            vscode.window.showErrorMessage("Agent run failed: " + err.message);
            webviewView.webview.postMessage({ command: 'host-error', message: err.message || 'Agent run failed.' });
          }
          break;
        }
        case 'list-models': {
          try {
            const list = await this.harnessLoop.listModels();
            webviewView.webview.postMessage({ command: 'models-list', models: list });
          } catch (err) {}
          break;
        }
        case 'load-state': {
          try {
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0) {
              const statePath = path.join(folders[0].uri.fsPath, '.forge', 'state.json');
              if (fs.existsSync(statePath)) {
                const state: HarnessState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                webviewView.webview.postMessage({ command: 'state-update', state });
              }
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
        case 'chat': {
          try {
            const lastUser = String((message.messages || []).slice(-1)[0]?.content || '');
            if (/^\/research\s+/i.test(lastUser.trim())) {
              const question = lastUser.trim().replace(/^\/research\s+/i, '');
              webviewView.webview.postMessage({ command: 'chat-response', text: `🔎 Deep research: "${question}" — planning sub-questions and dispatching web-grounded workers (OpenRouter :online)...` });
              const research = await runDeepResearch(question, createConfiguredProvider(), getWorkspaceRoot(), message.modelId);
              attachedResearch.push(research.artifactPath);
              webviewView.webview.postMessage({
                command: 'chat-response',
                text: `📎 Research artifact attached to this conversation (${research.subQuestions.length} sub-questions, web-grounded: ${research.webGrounded}, saved to ${path.relative(getWorkspaceRoot(), research.artifactPath)}). It will ground my answers from now on.\n\n${research.markdown.slice(0, 4000)}`
              });
              break;
            }
            if (/^\/goal\s+/i.test(lastUser.trim())) {
              const directive = parseGoalDirective(lastUser);
              const contractPreview = {
                goal: directive.goal,
                doneWhen: directive.doneWhen,
                constraints: directive.constraints,
                nonGoals: directive.nonGoals,
                budgetUsd: directive.budgetUsd,
                maxSteps: directive.maxSteps
              };
              webviewView.webview.postMessage({
                command: 'chat-response',
                text: `Goal contract compiled (oracle gates are mandatory and cannot be removed):\n${JSON.stringify(contractPreview, null, 2)}\nStart it with the Run button or the forge-agent.runAgentGoal command; steer with forge-agent.pauseGoal / steerGoal / resumeGoal.`
              });
              break;
            }
            const result = await runChatCompletion({
              messages: message.messages || [],
              modelId: message.modelId,
              sessionId: message.sessionId
            });
            webviewView.webview.postMessage({ command: 'chat-response', ...result });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'chat-response', error: err.message || 'Chat failed.' });
          }
          break;
        }
        case 'list-sessions': {
          try {
            const indexPath = path.join(getWorkspaceRoot(), '.forge', 'sessions', 'index.json');
            const sessions = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
            webviewView.webview.postMessage({ command: 'sessions-list', sessions });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'sessions-list', sessions: [], error: err.message });
          }
          break;
        }
        case 'load-session': {
          try {
            const dir = path.join(getWorkspaceRoot(), '.forge', 'sessions', String(message.sessionId || ''));
            const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
            const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
            let chat: any[] = [];
            try {
              chat = JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8'));
            } catch { /* no chat yet */ }
            // Loading makes it the active session (backcompat copy).
            fs.writeFileSync(path.join(getWorkspaceRoot(), '.forge', 'state.json'), JSON.stringify(state, null, 2), 'utf8');
            webviewView.webview.postMessage({ command: 'session-loaded', state, meta, chat });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Could not load session: ${err.message}` });
          }
          break;
        }
        case 'pin-session': {
          try {
            const dir = path.join(getWorkspaceRoot(), '.forge', 'sessions', String(message.sessionId || ''));
            const metaPath = path.join(dir, 'meta.json');
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            meta.pinned = message.pinned === true;
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
            const indexPath = path.join(getWorkspaceRoot(), '.forge', 'sessions', 'index.json');
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            const at = index.findIndex((item: any) => item.sessionId === meta.sessionId);
            if (at >= 0) {
              index[at].pinned = meta.pinned;
              index.sort((a: any, b: any) => (Number(b.pinned) - Number(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
              fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
            }
            webviewView.webview.postMessage({ command: 'sessions-list', sessions: index });
          } catch (err: any) {
            webviewView.webview.postMessage({ command: 'host-error', message: `Pin failed: ${err.message}` });
          }
          break;
        }
        case 'save-chat': {
          try {
            const dir = path.join(getWorkspaceRoot(), '.forge', 'sessions', String(message.sessionId || ''));
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(Array.isArray(message.messages) ? message.messages.slice(-500) : [], null, 2), 'utf8');
          } catch { /* chat persistence must never break the panel */ }
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
                webviewView.webview.postMessage({ command: 'state-update', state });
              }
              while (!['success', 'failed', 'gave_up', 'paused'].includes(state.status) && state.currentStepIndex < state.maxSteps) {
                state = await this.harnessLoop.runStep(state, message.modelBindings || {});
                webviewView.webview.postMessage({ command: 'state-update', state });
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

async function runChatCompletion(options: {
  messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  modelId?: string;
  sessionId?: string;
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

  const result = await provider.generateChat({
    modelId,
    sessionId,
    fallbackModels: [OpenRouterProvider.mixedModel(), OpenRouterProvider.codingModel(), 'meta-llama/llama-3.3-70b-instruct'],
    messages: [
      {
        role: 'system',
        content: [
          'You are Forge Agent chat inside the Forge Studio panel (a VS Code/Antigravity extension).',
          'HARD FACTS ABOUT THE UI - never contradict or embellish these:',
          'This chat has NO tools: it cannot create/edit files, run commands, or commit anything. It is advisory only.',
          'The ONLY way work gets done: the user types a goal in this same composer box and clicks the Run (play) button. That starts the autonomous firewalled agent, which itself creates files, runs tests, and only succeeds when tests pass.',
          'Optional goal syntax the user can type before clicking Run: "/goal <objective>" with optional lines "done when:", "constraints:", "budget: $N", "max steps: N".',
          'Pause and Resume buttons sit next to Run. Artifacts (plan, evidence, diffs) open via the panel buttons.',
          'There are NO commands named "Forge: Propose" or "PROPOSE run", NO manual commit step, and NO command-palette workflow for this - never instruct the user to paste code into files themselves; that defeats the agent.',
          'The user can also type "/research <question>" in this composer for web-grounded deep research; the resulting artifact attaches to this conversation as context.',
          'When the user asks you to build or fix something: give a one-line summary of what the agent will do, then tell them exactly: type the goal (suggest a concrete /goal line for them) and click Run.',
          'If asked about UI you are not certain exists, say you are not certain instead of inventing steps.'
        ].join('\n')
      },
      ...researchContext,
      ...messages.slice(-12)
    ]
  });

  return { text: result.text || '(empty response)', usage: result.usage, modelId };
}

function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    throw new Error('No workspace folder is open.');
  }
  return fs.realpathSync(folders[0].uri.fsPath);
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
    scratchpad: 'SCRATCHPAD.md',
    todos: 'todos.json',
    evidence: 'evidence_ledger.json',
    state: path.join('.forge', 'state.json'),
    context: path.join('.forge', 'context-bundle.json'),
    retrieval: path.join('.forge', 'retrieval-index.json'),
    handoffs: path.join('.forge', 'role-handoffs.json'),
    safety: path.join('.forge', 'safety-checkpoints.json'),
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
    verificationMatrix: path.join('.forge', 'verification-fixture-matrix.json')
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

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
  await vscode.window.showTextDocument(doc, { preview: false });
  return fullPath;
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
