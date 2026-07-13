import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronUp,
  CheckCircle2,
  CircleHelp,
  Circle,
  Database,
  ExternalLink,
  FileCode2,
  Folder,
  History,
  Globe2,
  Mic,
  MessageSquareMore,
  Monitor,
  Paperclip,
  Pause,
  Pin,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Star,
  Terminal,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { AgentMode, ComposerContextSummary, HarnessState, HumanApprovalPolicy, ProviderReadiness, RunProgressEvent, SessionSummary, StepLog, WorkspaceIndexStatus, WorkspaceMentionCandidate } from './types';
import { DEFAULT_BINDINGS, PERSISTED_BINDINGS_KEY, STANDARD_MODELS } from './data/models';

type ViewMode = 'run' | 'proof' | 'settings';

const SLASH_COMMANDS: Array<{ cmd: string; hint: string }> = [
  { cmd: '/goal', hint: 'Autonomous firewalled run. Optional lines: done when: | constraints: | non-goals: | budget: $N | max steps: N. Type it, then press Run ▶.' },
  { cmd: '/research', hint: 'Deep web research (plan → web-grounded workers → cited report). Artifact saves to .forge/research/ and attaches to this conversation. Press Enter.' }
];
type ModelRole = 'code' | 'plan' | 'review';
type InferenceMode = 'Instant' | 'Thinking';
type ChatMessage = { role: 'user' | 'assistant'; content: string; modelId?: string; error?: boolean };
type ModelSortMode = 'recommended' | 'context' | 'reasoning' | 'coding' | 'cost' | 'newest';

const FALLBACK_MODES: AgentMode[] = [
  { id: 'code', name: 'Code', description: 'Default governed coding agent.', instructions: 'Implement through the Forge workflow.', intent: 'code', modelRole: 'code', inference: 'Instant', allowedTools: [], builtIn: true },
  { id: 'architect', name: 'Architect', description: 'Architecture guidance without workspace mutation.', instructions: 'Analyze and plan.', intent: 'architect', modelRole: 'plan', inference: 'Thinking', allowedTools: [], builtIn: true },
  { id: 'ask', name: 'Ask', description: 'Answer questions without changing files.', instructions: 'Explain clearly.', intent: 'ask', modelRole: 'plan', inference: 'Instant', allowedTools: [], builtIn: true },
  { id: 'code-reviewer', name: 'Code Reviewer', description: 'Review code without implementing changes.', instructions: 'Find correctness risks.', intent: 'review', modelRole: 'review', inference: 'Thinking', allowedTools: [], builtIn: true }
];
const REQUIRED_CUSTOM_CODE_TOOLS = ['update_plan', 'run_tests', 'get_diff', 'record_evidence', 'ask_user', 'declare_success'];
const OPTIONAL_CUSTOM_CODE_TOOLS = ['repo_search', 'symbol_search', 'read_file', 'read_range', 'apply_patch', 'write_file', 'run_command', 'browser_validate', 'browser_inspect', 'browser_action', 'computer_inspect', 'computer_action', 'update_tasks'];

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (message: any) => void;
      getState?: () => any;
      setState?: (state: any) => void;
    };
  }
}

const vscode = typeof window !== 'undefined' && window.acquireVsCodeApi
  ? window.acquireVsCodeApi()
  : undefined;

export default function App() {
  const [activeView, setActiveView] = useState<ViewMode>('run');
  const [goal, setGoal] = useState('Validate the workspace with Forge Agent.');
  const [statusMessage, setStatusMessage] = useState('Forge extension host ready.');
  const [isBusy, setIsBusy] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [state, setState] = useState<HarnessState | null>(null);
  const [modelsCatalog, setModelsCatalog] = useState(STANDARD_MODELS);
  const [modelsStatus, setModelsStatus] = useState(`Fallback catalog loaded (${STANDARD_MODELS.length} models).`);
  const [bindings, setBindings] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(PERSISTED_BINDINGS_KEY) || '') || DEFAULT_BINDINGS;
    } catch {
      return DEFAULT_BINDINGS;
    }
  });
  const [proofModels, setProofModels] = useState('openrouter/pareto-code\nopenrouter/auto\nmeta-llama/llama-3.3-70b-instruct');
  const [proofReport, setProofReport] = useState<any>(null);
  const [weakEvalReport, setWeakEvalReport] = useState<any>(null);
  const [difficultProofReport, setDifficultProofReport] = useState<any>(null);
  const [difficultProofProgress, setDifficultProofProgress] = useState<any>(null);
  const [difficultProofModel, setDifficultProofModel] = useState('qwen/qwen-2.5-7b-instruct');
  const [difficultProofTasks, setDifficultProofTasks] = useState(4);
  const [confirmLiveSpend, setConfirmLiveSpend] = useState(false);
  const [verificationMatrixReport, setVerificationMatrixReport] = useState<any>(null);
  const [isolatedRunReport, setIsolatedRunReport] = useState<any>(null);
  const [chatInput, setChatInput] = useState('');
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [progressEvents, setProgressEvents] = useState<RunProgressEvent[]>([]);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isCheckingReadiness, setIsCheckingReadiness] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [modes, setModes] = useState<AgentMode[]>(FALLBACK_MODES);
  const [selectedModeId, setSelectedModeId] = useState('code');
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('Instant');
  const [modeName, setModeName] = useState('');
  const [modeDescription, setModeDescription] = useState('');
  const [modeInstructions, setModeInstructions] = useState('');
  const [modeIntent, setModeIntent] = useState<AgentMode['intent']>('code');
  const [modeOptionalTools, setModeOptionalTools] = useState<string[]>(['repo_search', 'symbol_search', 'read_file', 'read_range', 'apply_patch', 'write_file']);
  const [modeError, setModeError] = useState('');
  const [openComposerMenu, setOpenComposerMenu] = useState<'role' | 'model' | 'inference' | 'checkpoint' | 'index' | 'context' | null>(null);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [composerSortMode, setComposerSortMode] = useState<ModelSortMode>('recommended');
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('forge_favorite_models_v1') || '[]');
    } catch {
      return [];
    }
  });
  const [humanApprovalPolicy, setHumanApprovalPolicy] = useState<HumanApprovalPolicy>('ask');
  const [workspaceIndexStatus, setWorkspaceIndexStatus] = useState<WorkspaceIndexStatus>({ status: 'missing', fileCount: 0, symbolCount: 0, ignoredCount: 0, truncated: false });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [corruptSessionCount, setCorruptSessionCount] = useState(0);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [composerContext, setComposerContext] = useState<ComposerContextSummary[]>([]);
  const [mentionCandidates, setMentionCandidates] = useState<WorkspaceMentionCandidate[]>([]);
  const [mentionProvenance, setMentionProvenance] = useState<'ready' | 'stale' | 'missing'>('missing');
  const [mentionSelection, setMentionSelection] = useState(0);
  const mentionRequestRef = useRef('');

  useEffect(() => {
    refreshModels();
    vscode?.postMessage({ command: 'load-state' });
    vscode?.postMessage({ command: 'load-readiness' });
    vscode?.postMessage({ command: 'list-modes' });
    vscode?.postMessage({ command: 'list-sessions' });
    vscode?.postMessage({ command: 'load-human-approval-policy' });
    vscode?.postMessage({ command: 'load-workspace-index-status' });
    vscode?.postMessage({ command: 'load-composer-context' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'state-update') {
        setState(message.state);
        if (message.state?.sessionId) setActiveSessionId(message.state.sessionId);
        if (message.state?.modePolicy?.id) setSelectedModeId(message.state.modePolicy.id);
        setProgressEvents(previous => mergeProgressEvents(previous, message.state?.progressEvents || []));
        setIsBusy(false);
        setPendingRestoreId(null);
        setStatusMessage(`Run ${message.state.status}: ${message.state.haltReason || message.state.firewall?.details || 'state updated'}`);
        const pending = message.state?.clarifications?.find((item: any) => item.status === 'pending');
        if (pending) {
          const optionText = pending.options?.length ? `\n\nOptions: ${pending.options.join(' | ')}` : '';
          const recommendation = pending.recommendedAnswer ? `\nRecommended: ${pending.recommendedAnswer}` : '';
          const content = `${pending.question}${optionText}${recommendation}`;
          setChatMessages(previous => previous.some(item => item.role === 'assistant' && item.content === content)
            ? previous
            : [...previous, { role: 'assistant', content }]);
        }
      }
      if (message.command === 'run-progress' && message.event) {
        setProgressEvents(previous => mergeProgressEvents(previous, [message.event]));
        setStatusMessage(message.event.summary || 'Forge run updated.');
      }
      if (message.command === 'models-list') {
        setModelsCatalog(message.models || STANDARD_MODELS);
        setIsRefreshingModels(false);
        setModelsStatus(message.provenance === 'live'
          ? `Live catalog: ${message.liveCount || (message.models || []).length} models.`
          : `Fallback catalog (${(message.models || STANDARD_MODELS).length} models): provider is not ready.`);
      }
      if (message.command === 'provider-readiness') {
        setReadiness(message.readiness);
        setIsCheckingReadiness(false);
        if (message.readiness?.ready) setStatusMessage(`${message.readiness.provider} is ready with ${message.readiness.catalog.modelCount} live models.`);
      }
      if (message.command === 'modes-list') {
        const nextModes = Array.isArray(message.modes) && message.modes.length ? message.modes : FALLBACK_MODES;
        setModes(nextModes);
        setSelectedModeId(previous => nextModes.some((mode: AgentMode) => mode.id === previous) ? previous : 'code');
        setModeError('');
      }
      if (message.command === 'human-approval-policy') setHumanApprovalPolicy(message.policy === 'auto' ? 'auto' : 'ask');
      if (message.command === 'workspace-index-status' && message.status) setWorkspaceIndexStatus(message.status);
      if (message.command === 'composer-context') {
        setComposerContext(Array.isArray(message.attachments) ? message.attachments : []);
        if (message.sessionId) setActiveSessionId(message.sessionId);
      }
      if (message.command === 'context-mention-results' && message.requestId === mentionRequestRef.current) {
        setMentionCandidates(Array.isArray(message.candidates) ? message.candidates : []);
        setMentionProvenance(message.provenance === 'ready' || message.provenance === 'stale' ? message.provenance : 'missing');
        setMentionSelection(0);
      }
      if (message.command === 'mode-error') setModeError(message.message || 'Could not save mode.');
      if (message.command === 'sessions-list') {
        setSessions(Array.isArray(message.sessions) ? message.sessions : []);
        setCorruptSessionCount(Number(message.corruptCount || 0));
        setPendingDeleteSessionId(null);
      }
      if (message.command === 'session-loaded') {
        setState(message.state || null);
        setActiveSessionId(message.meta?.sessionId || null);
        setProgressEvents(message.state?.progressEvents || []);
        setChatMessages(Array.isArray(message.chat) ? message.chat : []);
        setComposerContext(Array.isArray(message.context) ? message.context : []);
        if (message.state?.goalContract?.goal) setGoal(message.state.goalContract.goal);
        if (message.state?.modePolicy?.id) setSelectedModeId(message.state.modePolicy.id);
        setShowSessionMenu(false);
        setIsBusy(false);
        setStatusMessage(`${message.resumed ? 'Resumed' : 'Opened'} session: ${message.meta?.title || message.state?.sessionId || 'Forge run'}`);
        vscode?.postMessage({ command: 'list-sessions' });
      }
      if (message.command === 'support-report-ready') setStatusMessage(`Redacted support report ${message.reportId || ''} opened and copied.`.trim());
      if (message.command === 'proof-report') {
        setProofReport(message.report);
        setIsBusy(false);
        setStatusMessage(message.report?.passed ? 'Proof matrix passed.' : 'Proof matrix finished with failures.');
      }
      if (message.command === 'weak-eval-report') {
        setWeakEvalReport(message.report);
        setIsBusy(false);
        setStatusMessage(message.report?.passed ? 'Weak-model eval observed harness uplift.' : 'Weak-model eval finished with no uplift claim.');
      }
      if (message.command === 'difficult-proof-progress') {
        setDifficultProofProgress(message.progress || null);
        setStatusMessage(`Live Tier-4 proof: ${message.progress?.completedTaskCount || 0}/${message.progress?.taskCount || difficultProofTasks} tasks · ${message.progress?.providerCalls || 0} calls · $${Number(message.progress?.costUsd || 0).toFixed(4)}`);
      }
      if (message.command === 'difficult-proof-report') {
        setDifficultProofReport(message.report);
        setDifficultProofProgress(message.report);
        setIsBusy(false);
        setStatusMessage(message.report?.capabilityGatePassed ? 'Difficult live weak-model capability gate passed.' : `Difficult live proof finished honestly: ${message.report?.outcome || 'no result'}.`);
      }
      if (message.command === 'verification-matrix-report') {
        setVerificationMatrixReport(message.report);
        setIsBusy(false);
        setStatusMessage(message.report?.passed ? 'Verification fixture matrix passed.' : 'Verification fixture matrix failed.');
      }
      if (message.command === 'isolated-run-report') {
        setIsolatedRunReport(message.report);
        setIsBusy(false);
        setStatusMessage(message.report?.sourceMutated ? 'Isolated run finished, but source mutation was detected.' : 'Isolated run finished without source mutation.');
      }
      if (message.command === 'chat-response') {
        if (message.sessionId) setActiveSessionId(message.sessionId);
        setIsChatting(false);
        setChatMessages(previous => [
          ...previous,
          {
            role: 'assistant',
            content: message.error ? `Chat failed: ${message.error}` : (message.text || '(empty response)'),
            modelId: message.modelId,
            error: Boolean(message.error)
          }
        ]);
      }
      if (message.command === 'host-error') {
        setIsBusy(false);
        setIsRefreshingModels(false);
        setStatusMessage(message.message || 'Host command failed.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [chatMessages.length, progressEvents.length, state?.pendingHumanApproval?.id]);

  useEffect(() => {
    if (!state?.pendingHumanApproval?.id) return;
    const keepDecisionVisible = () => {
      const scroller = chatScrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    };
    window.addEventListener('resize', keepDecisionVisible);
    return () => window.removeEventListener('resize', keepDecisionVisible);
  }, [state?.pendingHumanApproval?.id]);

  useEffect(() => {
    if (!activeSessionId) return;
    const timer = window.setTimeout(() => vscode?.postMessage({ command: 'save-chat', sessionId: activeSessionId, messages: chatMessages }), 250);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, chatMessages]);

  useEffect(() => {
    const mention = activeMention(chatInput);
    if (!mention) {
      setMentionCandidates([]);
      return;
    }
    setShowCommandMenu(false);
    const requestId = `mention-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    mentionRequestRef.current = requestId;
    const timer = window.setTimeout(() => vscode?.postMessage({ command: 'search-context-mentions', query: mention.query, requestId }), 100);
    return () => window.clearTimeout(timer);
  }, [chatInput]);

  useEffect(() => {
    if (!state?.sessionId) return;
    const timer = window.setTimeout(() => vscode?.postMessage({ command: 'list-sessions' }), 400);
    return () => window.clearTimeout(timer);
  }, [state?.sessionId, state?.currentStepIndex, state?.status]);

  const activeTask = useMemo(() => {
    return state?.taskGraph.tasks.find(task => task.status === 'running' || task.status === 'pending');
  }, [state]);

  const latestLog = state?.logs[state.logs.length - 1];
  const latestEvidence = state?.evidenceLedger[state.evidenceLedger.length - 1];
  const selectedMode = modes.find(mode => mode.id === selectedModeId) || modes[0] || FALLBACK_MODES[0];
  const selectedRoleBinding = selectedMode.modelRole as ModelRole;
  const selectedModelId = bindings[selectedRoleBinding] || bindings.code || bindings.Editor || 'openrouter/pareto-code';
  const budgetSpent = state?.goalContract?.spent ?? 0;
  const budgetCap = state?.runBudget?.maxCostUsd ?? state?.goalContract?.budget ?? 0;
  const filteredComposerModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return [...modelsCatalog]
      .map(model => ({ model, score: scoreModelForRole(model, selectedRoleBinding, query) + (favoriteModels.includes(model.id) ? 40 : 0) }))
      .filter(item => item.score > -1000)
      .sort((a, b) => compareRankedModels(a, b, composerSortMode, selectedRoleBinding))
      .slice(0, 80);
  }, [composerSortMode, favoriteModels, modelSearch, modelsCatalog, selectedRoleBinding]);

  const saveBindings = (next: Record<string, string>) => {
    setBindings(next);
    localStorage.setItem(PERSISTED_BINDINGS_KEY, JSON.stringify(next));
  };

  const selectComposerModel = (modelId: string) => {
    const next = { ...bindings, [selectedRoleBinding]: modelId };
    if (selectedRoleBinding === 'code') next.Editor = modelId;
    if (selectedRoleBinding === 'plan') next.Architect = modelId;
    if (selectedRoleBinding === 'review') next.Reviewer = modelId;
    saveBindings(next);
    setModelSearch('');
    setOpenComposerMenu(null);
  };

  const toggleFavoriteModel = (modelId: string) => {
    const next = favoriteModels.includes(modelId)
      ? favoriteModels.filter(id => id !== modelId)
      : [...favoriteModels, modelId];
    setFavoriteModels(next);
    localStorage.setItem('forge_favorite_models_v1', JSON.stringify(next));
  };

  const refreshModels = () => {
    setIsRefreshingModels(true);
    setModelsStatus('Refreshing OpenRouter model catalog...');
    vscode?.postMessage({ command: 'list-models' });
  };

  const initializeRun = () => {
    setIsBusy(true);
    setStatusMessage('Initializing harness artifacts...');
    vscode?.postMessage({ command: 'init', goal, modelBindings: bindings, modeId: selectedMode.id });
  };

  const runStep = () => {
    if (!state) {
      initializeRun();
      return;
    }
    setIsBusy(true);
    setStatusMessage('Running one firewalled harness step...');
    vscode?.postMessage({ command: 'run-step', state, modelBindings: bindings });
  };

  const runProofMatrix = () => {
    setIsBusy(true);
    setStatusMessage('Running blueprint proof matrix in disposable fixtures...');
    vscode?.postMessage({
      command: 'run-proof-matrix',
      options: {
        models: proofModels.split(/\r?\n/).map(model => model.trim()).filter(Boolean),
        goal: 'Run the same blueprint proof fixture across configured models.',
        keepFixtures: true
      }
    });
  };

  const runWeakModelEval = () => {
    setIsBusy(true);
    setStatusMessage('Running weak-model harness eval in disposable fixtures...');
    vscode?.postMessage({
      command: 'run-weak-model-eval',
      options: { live: false, taskLimit: 15, keepFixtures: true }
    });
  };

  const runDifficultLiveProof = () => {
    if (!confirmLiveSpend) {
      setStatusMessage('Confirm provider-credit use before running the live proof.');
      return;
    }
    setIsBusy(true);
    setDifficultProofReport(null);
    setDifficultProofProgress({ completedTaskCount: 0, taskCount: difficultProofTasks, providerCalls: 0, providerFailures: 0, costUsd: 0 });
    setStatusMessage(`Starting ${difficultProofTasks}-task live Tier-4 proof with ${difficultProofModel}...`);
    vscode?.postMessage({ command: 'run-difficult-live-proof', options: {
      model: difficultProofModel,
      taskLimit: difficultProofTasks,
      maxHarnessSteps: 10,
      providerCallTimeoutMs: 90000,
      confirmLiveSpend: true,
      keepFixtures: true
    } });
  };

  const runVerificationMatrix = () => {
    setIsBusy(true);
    setStatusMessage('Running verification fixture matrix in disposable workspaces...');
    vscode?.postMessage({ command: 'run-verification-fixture-matrix' });
  };

  const runIsolatedAgentGoal = () => {
    setIsBusy(true);
    setStatusMessage('Running Forge Agent in an isolated worktree (copy fallback for non-git workspaces)...');
    vscode?.postMessage({
      command: 'run-isolated-agent-goal',
      options: {
        goal: 'Run Forge Agent in an isolated worktree or fallback copy and report whether the source workspace stayed unchanged.',
        modelBindings: bindings,
        maxSteps: 6,
        keepIsolated: true
      }
    });
  };

  const openArtifact = (artifact: string) => {
    vscode?.postMessage({ command: 'open-artifact', artifact });
  };

  const restoreCheckpoint = (checkpointId: string) => {
    if (pendingRestoreId !== checkpointId) {
      setPendingRestoreId(checkpointId);
      return;
    }
    setIsBusy(true);
    setStatusMessage(`Restoring ${checkpointId} and invalidating later proof...`);
    setOpenComposerMenu(null);
    vscode?.postMessage({ command: 'restore-checkpoint', checkpointId });
  };

  const sendChat = () => {
    const content = chatInput.trim();
    if (!content || isChatting) {
      return;
    }
    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', content }];
    const roleScopedMessages = nextMessages.map(message => ({ role: message.role, content: message.content }));
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatting(true);
    vscode?.postMessage({
      command: 'chat',
      modelId: selectedModelId,
      modeId: selectedMode.id,
      sessionId: activeSessionId,
      modelBindings: bindings,
      messages: roleScopedMessages
    });
  };

  const attachMention = (candidate: WorkspaceMentionCandidate) => {
    const mention = activeMention(chatInput);
    if (!mention) return;
    vscode?.postMessage({ command: 'attach-context-mention', kind: candidate.kind, path: candidate.path });
    setChatInput(chatInput.slice(0, mention.start));
    setMentionCandidates([]);
    setMentionSelection(0);
  };

  const startRunFromComposer = () => {
    if (readiness && !readiness.ready) {
      setStatusMessage(readiness.blockers[0]?.message || 'Complete Forge setup before starting a run.');
      return;
    }
    if (selectedMode.intent !== 'code') {
      setStatusMessage(`${selectedMode.name} is advisory. Use Send for non-mutating guidance, or select a Code mode to run tools.`);
      return;
    }
    const composerGoal = chatInput.trim() || chatMessages.filter(message => message.role === 'user').at(-1)?.content || goal;
    setGoal(composerGoal);
    setProgressEvents([]);
    setIsBusy(true);
    setStatusMessage('Running firewalled agent loop...');
    vscode?.postMessage({ command: 'run-agent-loop', goal: composerGoal, modelBindings: bindings, modeId: selectedMode.id });
  };

  const saveCustomMode = () => {
    setModeError('');
    const advisoryTools = ['repo_search', 'symbol_search', 'read_file', 'read_range', 'ask_user'];
    const allowedTools = modeIntent === 'code' ? Array.from(new Set([...REQUIRED_CUSTOM_CODE_TOOLS, ...modeOptionalTools])) : advisoryTools;
    const modelRole: ModelRole = modeIntent === 'code' ? 'code' : modeIntent === 'review' ? 'review' : 'plan';
    vscode?.postMessage({ command: 'save-mode', mode: {
      name: modeName, description: modeDescription, instructions: modeInstructions,
      intent: modeIntent, modelRole, inference: modeIntent === 'ask' ? 'Instant' : 'Thinking', allowedTools
    } });
    setModeName(''); setModeDescription(''); setModeInstructions('');
  };

  const saveOpenRouterKey = () => {
    const value = apiKeyInput.trim();
    if (!value) {
      setStatusMessage('Enter an OpenRouter API key first.');
      return;
    }
    setIsCheckingReadiness(true);
    vscode?.postMessage({ command: 'save-openrouter-key', apiKey: value });
    setApiKeyInput('');
  };

  const retryReadiness = () => {
    setIsCheckingReadiness(true);
    vscode?.postMessage({ command: 'load-readiness' });
  };

  const enhancePrompt = () => {
    const content = chatInput.trim();
    if (!content) {
      setChatInput('Inspect the current workspace, identify the next safest step, and explain what evidence would prove success.');
      return;
    }
    setChatInput(`Goal: ${content}\n\nPlease clarify assumptions, propose a safe plan, and identify the exact verification command or artifact that would prove completion.`);
  };

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatusMessage('Voice input is not available in this webview runtime.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) setChatInput(previous => previous ? `${previous} ${transcript}` : transcript);
    };
    recognition.onerror = () => setStatusMessage('Voice input failed or was denied.');
    recognition.start();
  };

  return (
    <div id="forge-agent-app" data-testid="forge-agent-app" className="h-screen bg-[#111113] text-slate-200 font-sans flex flex-col overflow-hidden">
      <header className="relative px-3 py-2 border-b border-slate-800 bg-[#151518]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-[#dfff2e] text-black font-black flex items-center justify-center text-xs">F</div>
            <h1 className="text-xs font-bold tracking-wide">Forge Agent</h1>
          </div>
          <div className="flex items-center gap-1">
            <button data-testid="view-run" onClick={() => setActiveView('run')} className={`rounded border px-2 py-1 text-[10px] ${activeView === 'run' ? 'border-[#dfff2e] text-[#dfff2e]' : 'border-slate-800 text-slate-500'}`}>Run</button>
            <button data-testid="view-proof" onClick={() => setActiveView('proof')} className="rounded border border-slate-800 p-1 text-slate-500 hover:text-slate-200" title="Proof"><ShieldCheck size={13} /></button>
            <button data-testid="view-settings" onClick={() => setActiveView('settings')} className="rounded border border-slate-800 p-1 text-slate-500 hover:text-slate-200" title="Settings"><Settings size={13} /></button>
            <button data-testid="sessions-toggle" onClick={() => { setShowSessionMenu(value => !value); setPendingDeleteSessionId(null); }} className="rounded border border-slate-800 p-1 text-slate-500 hover:text-slate-200" title="Recent Forge sessions"><MessageSquareMore size={13} /></button>
            <button data-testid="report-problem" onClick={() => vscode?.postMessage({ command: 'report-problem' })} className="rounded border border-slate-800 p-1 text-slate-500 hover:text-slate-200" title="Report a problem (creates a redacted diagnostic report)"><CircleHelp size={13} /></button>
          </div>
        </div>
        {showSessionMenu && (
          <div data-testid="sessions-menu" className="absolute right-3 top-10 z-30 w-96 max-w-[calc(100vw-1.5rem)] rounded border border-slate-700 bg-[#202024] p-2 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-200">Recent sessions</span>
              <span className="text-[9px] text-slate-500">{sessions.length} saved{corruptSessionCount ? ` · ${corruptSessionCount} skipped` : ''}</span>
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {sessions.slice(0, 20).map(session => {
                const active = activeSessionId === session.sessionId;
                return (
                  <div key={session.sessionId} data-testid={`session-${session.sessionId}`} className={`rounded border p-2 ${active ? 'border-[#dfff2e]/40 bg-[#dfff2e]/5' : 'border-slate-700 bg-[#151518]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button className="min-w-0 flex-1 text-left" onClick={() => vscode?.postMessage({ command: 'load-session', sessionId: session.sessionId })}>
                        <div className="truncate text-[11px] font-semibold text-slate-200">{session.title}</div>
                        <div className="mt-0.5 truncate text-[9px] text-slate-500">{session.status} · step {session.steps} · ${session.costUsd.toFixed(4)} · {new Date(session.updatedAt).toLocaleString()}</div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button data-testid={`open-session-${session.sessionId}`} className="rounded border border-slate-600 px-1.5 py-1 text-[9px] text-slate-300 hover:text-white" onClick={() => vscode?.postMessage({ command: 'load-session', sessionId: session.sessionId })}>Open</button>
                        {session.resumable && <button data-testid={`resume-session-${session.sessionId}`} className="rounded border border-[#dfff2e]/50 px-1.5 py-1 text-[9px] text-[#dfff2e]" onClick={() => { setIsBusy(true); setStatusMessage(`Resuming ${session.title}...`); vscode?.postMessage({ command: 'resume-session', sessionId: session.sessionId, modelBindings: bindings }); }}>Resume</button>}
                        <IconButton title={session.pinned ? 'Unpin session' : 'Pin session'} onClick={() => vscode?.postMessage({ command: 'pin-session', sessionId: session.sessionId, pinned: !session.pinned })}><Pin size={12} className={session.pinned ? 'fill-[#dfff2e] text-[#dfff2e]' : ''} /></IconButton>
                        <IconButton title={active ? 'Active session cannot be deleted' : pendingDeleteSessionId === session.sessionId ? 'Confirm delete session' : 'Delete session'} disabled={active} onClick={() => {
                          if (pendingDeleteSessionId !== session.sessionId) setPendingDeleteSessionId(session.sessionId);
                          else vscode?.postMessage({ command: 'delete-session', sessionId: session.sessionId });
                        }}><Trash2 size={12} className={pendingDeleteSessionId === session.sessionId ? 'text-rose-400' : ''} /></IconButton>
                      </div>
                    </div>
                    {pendingDeleteSessionId === session.sessionId && !active && <div className="mt-1 text-[9px] text-rose-300">Click the red trash icon again to permanently delete this session.</div>}
                  </div>
                );
              })}
              {!sessions.length && <div className="py-5 text-center text-[10px] text-slate-500">No saved Forge sessions in this workspace.</div>}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden">
        {activeView === 'run' && (
          <section data-testid="run-console" className="flex h-full flex-col">
            <div ref={chatScrollRef} data-testid="agent-chat" className="flex-1 select-text cursor-auto overflow-y-auto p-3" style={{ userSelect: 'text' }}>
              {readiness && !readiness.ready ? (
                <div className="flex h-full items-center justify-center p-2">
                  <div data-testid="first-run-onboarding" className="w-full max-w-md rounded border border-slate-700 bg-[#17171b] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-[#dfff2e] text-xs font-black text-black">F</div>
                      <div>
                        <div className="text-sm font-semibold text-slate-100">Set up Forge Agent</div>
                        <div className="text-[11px] text-slate-500">Two checks before your first governed run.</div>
                      </div>
                    </div>
                    <OnboardingStep number="1" title="Workspace" status={readiness.workspaceOpen ? 'pass' : 'action'} detail={readiness.workspaceOpen ? 'Workspace folder is open.' : 'Open the project Forge should work on.'}>
                      {!readiness.workspaceOpen && <button data-testid="onboarding-open-workspace" onClick={() => vscode?.postMessage({ command: 'open-workspace' })} className="forge-secondary mt-2 w-full">Open workspace</button>}
                    </OnboardingStep>
                    <OnboardingStep number="2" title={readiness.provider === 'openrouter' ? 'OpenRouter' : 'Local provider'} status={(readiness.provider === 'openrouter' ? readiness.credential.valid === true : readiness.authentication.status === 'pass') && readiness.catalog.status === 'live' ? 'pass' : readiness.credential.valid === false || readiness.authentication.status === 'fail' ? 'fail' : 'action'} detail={(readiness.provider === 'openrouter' ? readiness.credential.valid === true : readiness.authentication.status === 'pass') && readiness.catalog.status === 'live' ? `${readiness.catalog.modelCount} live models available.` : readiness.blockers.find(item => item.code !== 'workspace_missing')?.message || 'Verify the configured provider.'}>
                      {readiness.provider === 'openrouter' && !readiness.ready && (
                        <div className="mt-2 flex gap-2">
                          <input data-testid="onboarding-api-key" type="password" autoComplete="off" value={apiKeyInput} onChange={event => setApiKeyInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveOpenRouterKey(); }} className="min-w-0 flex-1 rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-[#dfff2e]" placeholder="OpenRouter API key" />
                          <button data-testid="onboarding-save-key" onClick={saveOpenRouterKey} disabled={isCheckingReadiness || !apiKeyInput.trim()} className="forge-primary px-3 py-1.5">{isCheckingReadiness ? 'Checking…' : 'Save & check'}</button>
                        </div>
                      )}
                      {readiness.provider === 'openai-compatible' && !readiness.ready && <button data-testid="onboarding-retry" onClick={retryReadiness} disabled={isCheckingReadiness} className="forge-secondary mt-2 w-full">Retry connection</button>}
                    </OnboardingStep>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>Keys are stored in the IDE secret vault.</span>
                      {readiness.credential.configured && readiness.provider === 'openrouter' && <button data-testid="onboarding-clear-key" onClick={() => vscode?.postMessage({ command: 'clear-openrouter-key' })} className="text-slate-400 hover:text-slate-200">Change key</button>}
                    </div>
                  </div>
                </div>
              ) : chatMessages.length === 0 && progressEvents.length === 0 && !state?.pendingHumanApproval ? (
                <div className="flex h-full items-center justify-center text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded bg-[#dfff2e] text-sm font-black text-black">F</div>
                    <p className="text-xs font-semibold text-slate-300">Ask Forge to explain, plan, or work on this codebase.</p>
                    <p className="mt-1 text-[11px] text-slate-500">Runs still pass through the deterministic harness firewall.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {chatMessages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className={`rounded border p-2 text-[11px] ${message.role === 'user' ? 'ml-4 border-[#dfff2e]/30 bg-[#dfff2e]/10 text-slate-100' : message.error ? 'mr-4 border-rose-900/60 bg-rose-950/20 text-rose-200' : 'mr-4 border-slate-800 bg-[#101014] text-slate-300'}`}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                        <span>{message.role === 'user' ? 'You' : 'Forge Agent'}</span>
                        {message.modelId && <span className="truncate normal-case">{message.modelId}</span>}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  ))}
                  {progressEvents.length > 0 && (
                    <div data-testid="run-activity" aria-live="polite" className="mr-4 rounded border border-slate-800 bg-[#101014] p-2 text-[11px] text-slate-300">
                      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                        <span>{progressEvents.at(-1)?.kind === 'terminal' ? 'Run activity' : 'Forge is working'}</span>
                        <span className="font-mono normal-case">step {progressEvents.at(-1)?.stepIndex ?? 0}</span>
                      </div>
                      <div className="space-y-1.5">
                        {progressEvents.slice(-12).map(event => (
                          <div key={event.id} data-testid={`progress-${event.kind}`} className="flex items-start gap-2">
                            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${progressStatusClass(event.status)}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-slate-300"><span className="font-semibold text-slate-200">{event.role}</span> · {event.summary}</span>
                                <span className="shrink-0 font-mono text-[9px] text-slate-600">{event.toolName || event.phase.toLowerCase()}</span>
                              </div>
                              {event === progressEvents.at(-1) && event.detail && <div className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">{event.detail}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {state?.pendingHumanApproval?.status === 'pending' && (
                    <div data-testid="human-approval-card" className="mr-4 rounded border border-amber-500/50 bg-amber-950/20 p-2.5 text-[11px] text-slate-200">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <ShieldCheck size={14} className="shrink-0 text-amber-300" />
                          <span className="truncate font-semibold">Approve {state.pendingHumanApproval.proposal.name}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[9px] text-slate-500">{state.pendingHumanApproval.role}</span>
                      </div>
                      <p className="mt-1.5 break-words text-[10px] leading-relaxed text-slate-400">{state.pendingHumanApproval.summary}</p>
                      <p className="mt-1 text-[9px] text-slate-500">Validated by Forge. Nothing has changed yet.</p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button data-testid="reject-human-approval" disabled={isBusy} onClick={() => { setIsBusy(true); vscode?.postMessage({ command: 'resolve-human-approval', decision: 'reject', approvalId: state.pendingHumanApproval?.id, modelBindings: bindings }); }} className="rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-300 hover:text-white">Reject</button>
                        <button data-testid="approve-human-approval" disabled={isBusy} onClick={() => { setIsBusy(true); vscode?.postMessage({ command: 'resolve-human-approval', decision: 'approve', approvalId: state.pendingHumanApproval?.id, modelBindings: bindings }); }} className="rounded border border-amber-400 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-400/20">Approve</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="relative border-t border-slate-800 bg-[#151518] p-3">
              {(showCommandMenu || (chatInput.startsWith('/') && !SLASH_COMMANDS.some(item => chatInput.startsWith(item.cmd + ' ')))) && (
                <div data-testid="command-menu" className="absolute bottom-full left-3 right-3 z-20 mb-1 rounded border border-slate-700 bg-[#232326] p-1 shadow-lg">
                  {SLASH_COMMANDS.filter(item => item.cmd.startsWith(chatInput.trim()) || !chatInput.startsWith('/') || chatInput.trim() === '/').map(item => (
                    <button
                      key={item.cmd}
                      data-testid={`command-option-${item.cmd.slice(1)}`}
                      className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left hover:bg-[#2f2f33]"
                      onClick={() => { setChatInput(item.cmd + ' '); setShowCommandMenu(false); }}
                    >
                      <span className="text-xs font-semibold text-[#dfff2e]">{item.cmd}</span>
                      <span className="text-[10px] text-slate-400">{item.hint}</span>
                    </button>
                  ))}
                  <div className="px-2 pt-1 text-[9px] text-slate-500">Click a command to insert it. Commands run through the firewalled agent, not chat.</div>
                </div>
              )}
              {chatInput.startsWith('/goal ') && (
                <div data-testid="goal-mode-pill" className="mb-1 inline-flex items-center gap-1 rounded-full border border-[#dfff2e] px-2 py-0.5 text-[9px] font-semibold text-[#dfff2e]">
                  GOAL MODE — press Run ▶ to start the firewalled agent (Enter just chats)
                </div>
              )}
              {activeMention(chatInput) && (
                <div data-testid="context-mention-menu" className="absolute bottom-full left-3 z-30 mb-1 max-h-72 w-96 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded border border-slate-700 bg-[#232326] p-1 shadow-xl">
                  <div className="flex items-center justify-between px-2 py-1 text-[9px] font-semibold uppercase text-slate-500">
                    <span>Attach workspace context</span><span>{mentionProvenance}</span>
                  </div>
                  {mentionCandidates.slice(0, 20).map((candidate, index) => (
                    <button
                      key={`${candidate.kind}:${candidate.path}`}
                      data-testid={`mention-option-${candidate.kind}-${index}`}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${mentionSelection === index ? 'bg-[#06466d] text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                      onMouseEnter={() => setMentionSelection(index)}
                      onClick={() => attachMention(candidate)}
                    >
                      {candidate.kind === 'folder' ? <Folder size={13} className="shrink-0 text-amber-300" /> : <FileCode2 size={13} className="shrink-0 text-sky-300" />}
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{candidate.label}</span><span className="block truncate text-[9px] text-slate-500">{candidate.detail}</span></span>
                    </button>
                  ))}
                  {!mentionCandidates.length && <div className="px-2 py-2 text-[10px] text-slate-500">{mentionProvenance === 'missing' ? 'Build the workspace index to use @ mentions.' : 'No matching workspace files or folders.'}</div>}
                </div>
              )}
              {composerContext.length > 0 && (
                <div data-testid="composer-context-chips" className="mb-1 flex max-h-14 flex-wrap gap-1 overflow-y-auto">
                  {composerContext.map(item => (
                    <span key={item.id} className="inline-flex max-w-full items-center gap-1 rounded border border-slate-700 bg-[#252525] px-1.5 py-0.5 text-[10px] text-slate-300" title={item.path || item.label}>
                      <Paperclip size={10} className="shrink-0 text-slate-500" />
                      <span className="max-w-52 truncate">{item.label}</span>
                      <button data-testid={`remove-context-${item.id}`} title={`Remove ${item.label}`} onClick={() => vscode?.postMessage({ command: 'remove-composer-context', id: item.id })} className="text-slate-500 hover:text-rose-300"><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded border border-slate-700 bg-[#303030] p-2 shadow-sm">
                <div className="flex items-start gap-1">
                <button
                  data-testid="command-menu-toggle"
                  title="Commands (/goal and more)"
                  className={`mt-1 rounded border px-1.5 py-0.5 text-xs ${showCommandMenu ? 'border-[#dfff2e] text-[#dfff2e]' : 'border-slate-600 text-slate-400'} hover:text-[#dfff2e]`}
                  onClick={() => setShowCommandMenu(open => !open)}
                >+</button>
                <textarea
                  data-testid="chat-input"
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  onKeyDown={event => {
                    const mention = activeMention(chatInput);
                    if (mention) {
                      if (event.key === 'ArrowDown' && mentionCandidates.length) {
                        event.preventDefault(); setMentionSelection(value => (value + 1) % mentionCandidates.length); return;
                      }
                      if (event.key === 'ArrowUp' && mentionCandidates.length) {
                        event.preventDefault(); setMentionSelection(value => (value - 1 + mentionCandidates.length) % mentionCandidates.length); return;
                      }
                      if ((event.key === 'Enter' || event.key === 'Tab') && mentionCandidates[mentionSelection]) {
                        event.preventDefault(); attachMention(mentionCandidates[mentionSelection]); return;
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault(); setChatInput(chatInput.slice(0, mention.start)); setMentionCandidates([]); return;
                      }
                    }
                    if (event.key === 'Tab' && chatInput.startsWith('/') && !chatInput.includes(' ')) {
                      const match = SLASH_COMMANDS.find(item => item.cmd.startsWith(chatInput.trim()));
                      if (match) {
                        event.preventDefault();
                        setChatInput(match.cmd + ' ');
                        return;
                      }
                    }
                    if (event.key === 'Escape') {
                      setShowCommandMenu(false);
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendChat();
                    }
                  }}
                  className="min-h-14 w-full resize-none bg-transparent p-1 text-xs text-slate-100 outline-none placeholder:text-slate-400"
                  placeholder="Ask anything, @ to attach context, / for actions"
                />
                </div>
                <div className="relative mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-1">
                    <button data-testid="role-menu-button" onClick={() => setOpenComposerMenu(openComposerMenu === 'role' ? null : 'role')}>
                      <Chip label={selectedMode.name} />
                    </button>
                    <button data-testid="model-menu-button" onClick={() => setOpenComposerMenu(openComposerMenu === 'model' ? null : 'model')}>
                      <Chip label={selectedModelId} />
                    </button>
                    <button data-testid="inference-menu-button" onClick={() => setOpenComposerMenu(openComposerMenu === 'inference' ? null : 'inference')}>
                      <Chip label={inferenceMode} />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1 text-slate-300">
                    <IconButton title={`Attach workspace context${composerContext.length ? ` (${composerContext.length})` : ''}`} testId="composer-context-toggle" onClick={() => setOpenComposerMenu(openComposerMenu === 'context' ? null : 'context')}>
                      <Paperclip size={14} className={composerContext.length ? 'text-[#dfff2e]' : 'text-slate-400'} />
                    </IconButton>
                    <IconButton title={`Workspace index: ${workspaceIndexStatus.status}`} testId="workspace-index-toggle" onClick={() => setOpenComposerMenu(openComposerMenu === 'index' ? null : 'index')}>
                      <Database size={14} className={workspaceIndexStatus.status === 'ready' ? 'text-emerald-400' : workspaceIndexStatus.status === 'stale' ? 'text-amber-300' : workspaceIndexStatus.status === 'error' ? 'text-rose-400' : workspaceIndexStatus.status === 'building' ? 'animate-pulse text-[#dfff2e]' : 'text-slate-400'} />
                    </IconButton>
                    <IconButton title={humanApprovalPolicy === 'auto' ? 'Auto approve is on. Firewall and verification still apply. Click to ask before changes.' : 'Ask before file changes and commands. Click to auto approve validated actions.'} testId="human-approval-policy" onClick={() => vscode?.postMessage({ command: 'set-human-approval-policy', policy: humanApprovalPolicy === 'auto' ? 'ask' : 'auto' })}>
                      <ShieldCheck size={14} className={humanApprovalPolicy === 'auto' ? 'text-[#dfff2e]' : 'text-amber-300'} />
                    </IconButton>
                    <IconButton title="Enhance prompt" onClick={enhancePrompt}>
                      <Wand2 size={14} />
                    </IconButton>
                    <IconButton title="Start voice input" onClick={startVoiceInput}>
                      <Mic size={14} />
                    </IconButton>
                    <IconButton title={selectedMode.intent === 'code' ? 'Start firewalled run' : `${selectedMode.name} is advisory; use Send`} testId="initialize-run" onClick={startRunFromComposer} disabled={isBusy || selectedMode.intent !== 'code'}>
                      <Play size={14} />
                    </IconButton>
                    <IconButton title="Run next step" testId="step-loop" onClick={runStep} disabled={isBusy}>
                      <Square size={13} />
                    </IconButton>
                    <IconButton title="Pause run (honored before the next step; no provider calls while paused)" testId="pause-run" onClick={() => vscode?.postMessage({ command: 'pause-goal' })}>
                      <Pause size={14} />
                    </IconButton>
                    <IconButton title="Resume paused run" testId="resume-run" onClick={() => vscode?.postMessage({ command: 'resume-goal' })}>
                      <RotateCcw size={14} />
                    </IconButton>
                    <IconButton title="Checkpoint history" testId="checkpoint-history-toggle" onClick={() => { setPendingRestoreId(null); setOpenComposerMenu(openComposerMenu === 'checkpoint' ? null : 'checkpoint'); }}>
                      <History size={14} />
                    </IconButton>
                    <IconButton title={(state?.browserValidations || []).length ? `Open latest browser evidence (${state?.browserValidations?.slice(-1)[0]?.status})` : 'Browser evidence appears after the agent validates a local app'} testId="browser-evidence" onClick={() => openArtifact('browserScreenshot')}>
                      <Globe2 size={14} className={state?.browserValidations?.slice(-1)[0]?.status === 'pass' ? 'text-emerald-400' : state?.browserValidations?.slice(-1)[0]?.status === 'fail' ? 'text-rose-400' : ''} />
                    </IconButton>
                    {(state?.computerInteractions || []).length > 0 && (
                      <IconButton title="Open latest governed computer-use screenshot" testId="computer-evidence" onClick={() => openArtifact('computerInteractionScreenshot')}>
                        <Monitor size={14} className={state?.computerInteractions?.slice(-1)[0]?.status === 'failed' ? 'text-rose-400' : 'text-emerald-400'} />
                      </IconButton>
                    )}
                    <IconButton title="Artifacts" testId="artifact-details-toggle" onClick={() => openArtifact('plan')}>
                      <BookOpen size={14} />
                    </IconButton>
                    <IconButton title="Proof" onClick={() => setActiveView('proof')}>
                      <ShieldCheck size={14} />
                    </IconButton>
                    <IconButton title="Settings" onClick={() => setActiveView('settings')}>
                      <Settings size={14} />
                    </IconButton>
                    <IconButton title="Send" testId="send-chat" onClick={sendChat} disabled={isChatting || !chatInput.trim()}>
                      <Send size={14} />
                    </IconButton>
                  </div>
                  {openComposerMenu === 'role' && (
                    <div data-testid="role-menu" className="absolute bottom-8 left-0 z-10 max-h-96 w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded border border-slate-700 bg-[#202020] shadow-xl">
                      {modes.map(mode => (
                        <button
                          key={mode.id}
                          data-testid={`mode-option-${mode.id}`}
                          className={`block w-full px-3 py-2 text-left ${selectedMode.id === mode.id ? 'bg-[#06466d] text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                          onClick={() => {
                            setSelectedModeId(mode.id);
                            setInferenceMode(mode.inference);
                            setOpenComposerMenu(null);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-bold"><span>{mode.name}</span><span className="text-[9px] font-normal uppercase text-slate-500">{mode.intent}{mode.builtIn ? '' : ' · custom'}</span></div>
                          <div className="mt-1 text-[11px] text-slate-400">{mode.description}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {openComposerMenu === 'context' && (
                    <div data-testid="composer-context-menu" className="absolute bottom-8 right-0 z-20 w-64 rounded border border-slate-700 bg-[#202020] p-1 shadow-xl">
                      <div className="px-2 py-1 text-[9px] font-semibold uppercase text-slate-500">Attach context</div>
                      <button data-testid="attach-active-context" onClick={() => { vscode?.postMessage({ command: 'add-active-context' }); setOpenComposerMenu(null); }} className="block w-full rounded px-2 py-2 text-left text-xs text-slate-300 hover:bg-slate-800">Active file or selection</button>
                      <button data-testid="attach-workspace-file" onClick={() => { vscode?.postMessage({ command: 'pick-context-file' }); setOpenComposerMenu(null); }} className="block w-full rounded px-2 py-2 text-left text-xs text-slate-300 hover:bg-slate-800">Workspace file...</button>
                      <button data-testid="attach-diagnostics" onClick={() => { vscode?.postMessage({ command: 'add-diagnostics-context' }); setOpenComposerMenu(null); }} className="block w-full rounded px-2 py-2 text-left text-xs text-slate-300 hover:bg-slate-800">Problems and diagnostics</button>
                      {composerContext.length > 0 && <button data-testid="clear-composer-context" onClick={() => { vscode?.postMessage({ command: 'clear-composer-context' }); setOpenComposerMenu(null); }} className="mt-1 block w-full border-t border-slate-800 px-2 py-2 text-left text-xs text-rose-300 hover:bg-slate-800">Clear attached context</button>}
                    </div>
                  )}
                  {openComposerMenu === 'model' && (
                    <div data-testid="composer-model-menu" className="absolute bottom-8 left-14 z-10 max-h-96 w-96 max-w-[calc(100vw-2rem)] rounded border border-slate-700 bg-[#202020] shadow-xl">
                      <div className="flex items-center gap-2 border-b border-slate-700 p-2">
                        <Search size={13} className="text-slate-500" />
                        <input
                          data-testid="composer-model-search"
                          value={modelSearch}
                          onChange={event => setModelSearch(event.target.value)}
                          className="min-w-0 flex-1 rounded border border-slate-700 bg-[#303030] px-2 py-1 text-xs text-slate-100 outline-none focus:border-blue-500"
                          placeholder="Search models"
                        />
                        <button title="Refresh models" onClick={refreshModels} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white">
                          <RotateCcw size={13} className={isRefreshingModels ? 'animate-spin' : ''} />
                        </button>
                      </div>
                      <div className="border-b border-slate-700 px-2 py-1.5">
                        <ModelSortSelect value={composerSortMode} onChange={setComposerSortMode} />
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {filteredComposerModels.map(({ model }) => (
                          <div key={model.id} className={`flex items-center gap-1 ${model.id === selectedModelId ? 'bg-[#06466d]' : 'hover:bg-slate-800'}`}>
                            <button className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => selectComposerModel(model.id)}>
                              <div className="truncate text-xs font-bold text-slate-100">{model.name || model.id}</div>
                              <div className="truncate text-[10px] text-slate-400">{model.id} · {formatContext(model.contextLength)} · {formatCost(model)}</div>
                            </button>
                            <button title="Favorite model" onClick={() => toggleFavoriteModel(model.id)} className="p-2 text-slate-400 hover:text-[#dfff2e]">
                              <Star size={13} fill={favoriteModels.includes(model.id) ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {openComposerMenu === 'inference' && (
                    <div data-testid="inference-menu" className="absolute bottom-8 left-52 z-10 w-48 rounded border border-slate-700 bg-[#202020] shadow-xl">
                      {(['Instant', 'Thinking'] as InferenceMode[]).map(mode => (
                        <button
                          key={mode}
                          className={`block w-full px-3 py-2 text-left text-xs font-bold ${inferenceMode === mode ? 'bg-[#06466d] text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                          onClick={() => {
                            setInferenceMode(mode);
                            setOpenComposerMenu(null);
                          }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  )}
                  {openComposerMenu === 'checkpoint' && (
                    <div data-testid="checkpoint-history" className="absolute bottom-8 right-0 z-20 w-96 max-w-[calc(100vw-2rem)] rounded border border-slate-700 bg-[#202020] p-2 shadow-xl">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-200">Checkpoint History</span>
                        <span className="text-[10px] text-slate-500">{state?.safetyCheckpoints?.length || 0} saved</span>
                      </div>
                      <div className="max-h-72 space-y-1 overflow-y-auto">
                        {[...(state?.safetyCheckpoints || [])].reverse().slice(0, 8).map(checkpoint => (
                          <div key={checkpoint.id} data-testid={`checkpoint-item-${checkpoint.id}`} className="rounded border border-slate-700 bg-[#151518] p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[11px] font-semibold text-slate-200">{checkpoint.proposalName} · {checkpoint.id.split('-').slice(0, 3).join('-')}</div>
                                <div className="mt-0.5 truncate text-[9px] text-slate-500">{checkpoint.strategy} · {checkpoint.protectedPaths.join(', ')} · {new Date(checkpoint.timestamp).toLocaleTimeString()}</div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button title="Open native diff" className="rounded border border-slate-700 px-1.5 py-1 text-[9px] text-slate-400 hover:text-white" onClick={() => vscode?.postMessage({ command: 'open-diff' })}>Diff</button>
                                <button
                                  data-testid={`restore-checkpoint-${checkpoint.id}`}
                                  className={`rounded border px-1.5 py-1 text-[9px] ${pendingRestoreId === checkpoint.id ? 'border-rose-500 bg-rose-950/40 text-rose-200' : 'border-slate-700 text-slate-300 hover:border-[#dfff2e] hover:text-[#dfff2e]'}`}
                                  onClick={() => restoreCheckpoint(checkpoint.id)}
                                >
                                  {pendingRestoreId === checkpoint.id ? 'Confirm' : 'Restore'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {!state?.safetyCheckpoints?.length && <div className="py-4 text-center text-[10px] text-slate-500">No mutation checkpoints in this run yet.</div>}
                      </div>
                      <div className="mt-2 text-[9px] text-slate-500">Restore returns workspace files to the saved step and requires fresh review and verification.</div>
                    </div>
                  )}
                  {openComposerMenu === 'index' && (
                    <div data-testid="workspace-index-popover" className="absolute bottom-8 right-0 z-20 w-80 max-w-[calc(100vw-2rem)] rounded border border-slate-700 bg-[#202020] p-3 shadow-xl">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Database size={14} className={workspaceIndexStatus.status === 'ready' ? 'text-emerald-400' : workspaceIndexStatus.status === 'stale' ? 'text-amber-300' : workspaceIndexStatus.status === 'error' ? 'text-rose-400' : 'text-slate-400'} />
                          <span className="text-[11px] font-bold text-slate-200">Workspace index</span>
                        </div>
                        <span data-testid="workspace-index-state" className="font-mono text-[9px] uppercase text-slate-500">{workspaceIndexStatus.status}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 rounded border border-slate-800 bg-[#151518] p-2 text-[10px]">
                        <span className="text-slate-500">Files</span><span className="text-right font-mono text-slate-300">{workspaceIndexStatus.fileCount}{workspaceIndexStatus.truncated ? '+' : ''}</span>
                        <span className="text-slate-500">Symbols</span><span className="text-right font-mono text-slate-300">{workspaceIndexStatus.symbolCount}</span>
                        <span className="text-slate-500">Ignored</span><span className="text-right font-mono text-slate-300">{workspaceIndexStatus.ignoredCount}</span>
                        <span className="text-slate-500">Updated</span><span className="truncate text-right text-slate-400">{workspaceIndexStatus.generatedAt ? new Date(workspaceIndexStatus.generatedAt).toLocaleString() : 'never'}</span>
                      </div>
                      {workspaceIndexStatus.status === 'stale' && <p className="mt-2 text-[10px] text-amber-200">Workspace files changed. Refresh before relying on complete search coverage.</p>}
                      {workspaceIndexStatus.status === 'missing' && <p className="mt-2 text-[10px] text-slate-400">Build once to search beyond the direct 250-file fallback.</p>}
                      {workspaceIndexStatus.error && <p className="mt-2 line-clamp-2 text-[10px] text-rose-300">{workspaceIndexStatus.error}</p>}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button data-testid="refresh-workspace-index" disabled={workspaceIndexStatus.status === 'building'} onClick={() => vscode?.postMessage({ command: 'build-workspace-index' })} className="forge-primary py-1.5"><RotateCcw size={12} className={workspaceIndexStatus.status === 'building' ? 'animate-spin' : ''} />{workspaceIndexStatus.status === 'building' ? 'Building' : 'Refresh'}</button>
                        <button data-testid="open-workspace-index" disabled={workspaceIndexStatus.status === 'missing' || workspaceIndexStatus.status === 'building' || workspaceIndexStatus.status === 'error'} onClick={() => vscode?.postMessage({ command: 'open-workspace-index' })} className="forge-secondary py-1.5"><ExternalLink size={12} />Open index</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div data-testid="run-status-line" className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span className="truncate">{state?.status || 'idle'} · {activeTask?.title || statusMessage}</span>
                <span className="shrink-0 font-mono">
                  tests {state?.oracleStatuses.tests || '-'} · build {state?.oracleStatuses.build || '-'} · web {state?.runStats?.browserValidations ?? 0}/{state?.runStats?.browserValidationFailures ?? 0} · proj {state?.projectAdapter?.ecosystem || '-'}/{state?.projectAdapter?.packageManager || '-'} · fix {state?.runStats?.oracleFailureCaptures ?? 0}/{state?.runStats?.repeatedOracleFailures ?? 0}/{state?.runStats?.oracleFailureResolutions ?? 0} · stuck {state?.runStats?.oracleStagnationHalts ?? 0} · back {state?.runStats?.checkpointRestores ?? 0}/{state?.runStats?.checkpointRestoreFailures ?? 0} · cost ${budgetSpent.toFixed(4)}/${budgetCap.toFixed(2)} · ask {state?.runStats?.clarificationAnswers ?? 0}/{state?.runStats?.clarificationRequests ?? 0} · halt {state?.runStats?.budgetHalts ?? 0} · model {state?.runStats?.modelDrivenProposals ?? 0} · fallback {state?.runStats?.fallbackActions ?? 0} · repair {state?.runStats?.repairAttempts ?? 0} · reflect {state?.runStats?.reflectionAttempts ?? 0} · review {state?.runStats?.reviewerApprovals ?? 0} · crit {state?.runStats?.reviewerCritiques ?? 0} · pre {state?.runStats?.preCommitReviews ?? 0} · cmd {state?.runStats?.commandEffectCaptures ?? 0} · net {state?.runStats?.networkIntentCaptures ?? 0}/{state?.runStats?.networkWriteBlocks ?? 0} · perm {state?.runStats?.roleCapabilityBlocks ?? 0} · proc {state?.runStats?.workerProcessExecutions ?? 0}/{state?.runStats?.workerProcessFailures ?? 0} · txn {state?.runStats?.editTransactions ?? 0}+{state?.runStats?.commandTransactions ?? 0}/{(state?.runStats?.editTransactionConflicts ?? 0) + (state?.runStats?.commandTransactionConflicts ?? 0)} · flow {state?.workflow?.currentStage ?? '-'}/{state?.runStats?.workflowGateBlocks ?? 0} · skill {state?.runStats?.skillApplications ?? 0}/{state?.runStats?.skillRetrievals ?? 0} · blk {state?.runStats?.openBlockers ?? 0}/{state?.runStats?.blockerEvents ?? 0} · sem {state?.runStats?.semanticRefreshes ?? 0}/{state?.runStats?.semanticFailures ?? 0} · esc {state?.runStats?.escalationCount ?? 0} · ctx {state?.runStats?.contextRefreshes ?? 0} · hand {state?.runStats?.roleHandoffRefreshes ?? 0} · ret {state?.runStats?.retrievalRefreshes ?? 0} · safe {state?.runStats?.safetyCheckpoints ?? 0}
                </span>
              </div>
            </div>
          </section>
        )}

        {activeView === 'proof' && (
          <section data-testid="proof-panel" className="h-full space-y-3 overflow-y-auto p-3">
            <Panel title="Model Matrix">
              <p className="text-[11px] text-slate-400 mb-2">One model slug per line. The proof report separates model-driven success from harness fallback.</p>
              <textarea
                data-testid="proof-models"
                value={proofModels}
                onChange={event => setProofModels(event.target.value)}
                className="w-full min-h-28 rounded border border-slate-800 bg-[#0c0c0f] p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-[#dfff2e]/60"
              />
              <button data-testid="run-proof-matrix" onClick={runProofMatrix} disabled={isBusy} className="forge-primary mt-2 w-full">
                <ShieldCheck size={13} /> Run Proof Matrix
              </button>
            </Panel>

            <Panel title="Weak Model Eval">
              <p className="text-[11px] text-slate-400 mb-2">
                Compares a deliberately cheap/weak model bare versus Forge harness on disposable fixtures.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button data-testid="run-weak-model-eval" onClick={runWeakModelEval} disabled={isBusy} className="forge-primary">
                  <Play size={13} /> Run Weak Eval
                </button>
                <button data-testid="open-weak-model-eval" onClick={() => openArtifact('weakEval')} className="forge-secondary">
                  <ExternalLink size={13} /> Open Scorecard
                </button>
              </div>
              {weakEvalReport && (
                <div className="mt-2 rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[11px]">
                  <KeyValue label="Model" value={weakEvalReport.modelId || '-'} />
                  <KeyValue label="Status" value={weakEvalReport.status || '-'} />
                  <KeyValue label="Tasks" value={String(weakEvalReport.taskCount ?? '-')} />
                  <KeyValue label="Bare solved" value={String(weakEvalReport.bareSolved ?? '-')} />
                  <KeyValue label="Harness solved" value={String(weakEvalReport.harnessSolved ?? '-')} />
                  <KeyValue label="Fallback solved" value={String(weakEvalReport.fallbackSolved ?? '-')} />
                </div>
              )}
            </Panel>

            <details data-testid="difficult-live-proof" className="rounded border border-slate-800 bg-[#151518] p-3">
              <summary className="cursor-pointer text-xs font-bold text-slate-200">Difficult Live Weak-Model Proof</summary>
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-slate-400">Runs equal bare and Forge lanes on symptom-only Tier-4 fixtures. Only the approved inexpensive 7B baseline is accepted; held-out judges and no-fallback accounting remain mandatory.</p>
                <label className="block text-[10px] text-slate-400">Approved weak model</label>
                <input data-testid="difficult-proof-model" list="difficult-proof-models" value={difficultProofModel} onChange={event => setDifficultProofModel(event.target.value)} className="w-full rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 font-mono text-[11px] text-slate-200 outline-none focus:border-[#dfff2e]" />
                <datalist id="difficult-proof-models"><option value="qwen/qwen-2.5-7b-instruct" /></datalist>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-slate-400">Tasks
                    <select data-testid="difficult-proof-tasks" value={difficultProofTasks} onChange={event => setDifficultProofTasks(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 text-[11px] text-slate-200">
                      {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} of 4</option>)}
                    </select>
                  </label>
                  <div className="rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[9px] text-slate-500">10 harness steps/task<br />90s provider call timeout</div>
                </div>
                <label className="flex items-start gap-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[10px] text-amber-200">
                  <input data-testid="confirm-live-spend" type="checkbox" checked={confirmLiveSpend} onChange={event => setConfirmLiveSpend(event.target.checked)} className="mt-0.5" />
                  <span>I understand this makes live OpenRouter calls and spends provider credits. Actual cost is recorded in the immutable report.</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button data-testid="run-difficult-live-proof" onClick={runDifficultLiveProof} disabled={isBusy || !confirmLiveSpend} className="forge-primary"><Play size={13} /> Run Live Tier 4</button>
                  <button data-testid="open-difficult-live-proof" onClick={() => openArtifact('difficultProof')} className="forge-secondary"><ExternalLink size={13} /> Open Report</button>
                </div>
                {difficultProofProgress && <div data-testid="difficult-proof-progress" className="rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[10px] text-slate-400">{difficultProofProgress.completedTaskCount || 0}/{difficultProofProgress.taskCount || difficultProofTasks} tasks · {difficultProofProgress.providerCalls || 0} calls · {difficultProofProgress.providerFailures || 0} failures · ${Number(difficultProofProgress.costUsd || 0).toFixed(4)}</div>}
                {difficultProofReport && <div data-testid="difficult-proof-summary" className="rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[11px]">
                  <KeyValue label="Outcome" value={difficultProofReport.outcome || '-'} />
                  <KeyValue label="Bare / harness" value={`${difficultProofReport.bareSolved}/${difficultProofReport.harnessSolved}`} />
                  <KeyValue label="Model-driven solved" value={String(difficultProofReport.harnessModelDrivenSolved ?? '-')} />
                  <KeyValue label="Fallback solved" value={String(difficultProofReport.fallbackSolved ?? '-')} />
                  <KeyValue label="Capability gate" value={difficultProofReport.capabilityGatePassed ? 'PASS' : 'NOT PASSED'} />
                </div>}
              </div>
            </details>

            <Panel title="Isolated Run">
              <p className="text-[11px] text-slate-400 mb-2">
                Runs the harness in a git worktree (copy fallback for non-git workspaces) and proves whether the source changed.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button data-testid="run-isolated-agent-goal" onClick={runIsolatedAgentGoal} disabled={isBusy} className="forge-primary">
                  <ShieldCheck size={13} /> Run Isolated
                </button>
                <button data-testid="open-isolated-run" onClick={() => openArtifact('isolatedRun')} className="forge-secondary">
                  <ExternalLink size={13} /> Open Report
                </button>
              </div>
              {isolatedRunReport && (
                <div data-testid="isolated-run-summary" className="mt-2 rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[11px]">
                  <KeyValue label="Status" value={isolatedRunReport.stateStatus || '-'} />
                  <KeyValue label="Source mutated" value={String(Boolean(isolatedRunReport.sourceMutated))} />
                  <KeyValue label="Changed files" value={String((isolatedRunReport.changedFiles || []).length)} />
                  <KeyValue label="Added files" value={String((isolatedRunReport.addedFiles || []).length)} />
                </div>
              )}
            </Panel>

            <Panel title="Verification Fixtures">
              <p className="text-[11px] text-slate-400 mb-2">
                Runs disposable oracle/firewall fixtures for pass, fail, no-test, typecheck, lint, malformed patch, path escape, and blocked command behavior.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button data-testid="run-verification-matrix" onClick={runVerificationMatrix} disabled={isBusy} className="forge-primary">
                  <ShieldCheck size={13} /> Run Fixtures
                </button>
                <button data-testid="open-verification-matrix" onClick={() => openArtifact('verificationMatrix')} className="forge-secondary">
                  <ExternalLink size={13} /> Open Matrix
                </button>
              </div>
              {verificationMatrixReport && (
                <div data-testid="verification-matrix-summary" className="mt-2 rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[11px]">
                  <KeyValue label="Overall" value={verificationMatrixReport.passed ? 'PASS' : 'FAIL'} />
                  <KeyValue label="Cases" value={String((verificationMatrixReport.cases || []).length)} />
                  <KeyValue label="Report" value={verificationMatrixReport.reportPath || '-'} />
                </div>
              )}
            </Panel>

            <Panel title="Latest Proof Report">
              {!proofReport && <p className="text-xs text-slate-500">No proof report in this webview session yet.</p>}
              {proofReport && (
                <div className="space-y-2">
                  <KeyValue label="Overall" value={proofReport.passed ? 'PASS' : 'FAIL'} />
                  <KeyValue label="Generated" value={proofReport.generatedAt || '-'} />
                  {(proofReport.models || []).map((result: any) => (
                    <div key={result.modelId} className="rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-slate-200 truncate">{result.modelId}</span>
                        <span className={result.passed ? 'text-emerald-400' : 'text-rose-400'}>{result.passed ? 'PASS' : 'FAIL'}</span>
                      </div>
                      <div className="mt-1 text-slate-500">
                        modelDriven={String(result.actuallyModelDriven)} calls={result.providerCalls} failures={result.providerFailures} fallback={result.fallbackProposals}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </section>
        )}

        {activeView === 'settings' && (
          <section data-testid="settings-panel" className="h-full space-y-3 overflow-y-auto p-3">
            <Panel title="Model Routing">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">{modelsStatus}</p>
                <button data-testid="refresh-models" onClick={refreshModels} disabled={isRefreshingModels} className="forge-secondary shrink-0 px-2 py-1 text-[11px]">
                  <RotateCcw size={12} className={isRefreshingModels ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              <SearchableModelPicker role="code" label="Coding model" value={bindings.code || bindings.Editor || ''} models={modelsCatalog} onChange={value => saveBindings({ ...bindings, code: value, Editor: value })} />
              <SearchableModelPicker role="plan" label="Plan model" value={bindings.plan || bindings.Architect || ''} models={modelsCatalog} onChange={value => saveBindings({ ...bindings, plan: value, Architect: value })} />
              <SearchableModelPicker role="review" label="Review model" value={bindings.review || bindings.Reviewer || ''} models={modelsCatalog} onChange={value => saveBindings({ ...bindings, review: value, Reviewer: value })} />
            </Panel>

            <Panel title="Hybrid Settings">
              <p className="text-xs text-slate-400">
                This panel controls Forge-specific routing and proof presets. Durable provider defaults and API keys remain backed by native IDE configuration/secret storage.
              </p>
              <button onClick={() => vscode?.postMessage({ command: 'open-native-settings' })} className="forge-link-button mt-2">
                <Settings size={13} /> Open native Forge settings
              </button>
            </Panel>

            <Panel title="Provider Readiness">
              <KeyValue label="Provider" value={readiness?.provider || 'checking'} />
              <KeyValue label="Status" value={readiness?.ready ? 'READY' : 'SETUP REQUIRED'} />
              <KeyValue label="Credential" value={readiness?.credential.configured ? readiness.credential.source : 'not configured'} />
              <KeyValue label="Catalog" value={readiness ? `${readiness.catalog.status} · ${readiness.catalog.modelCount}` : 'checking'} />
              <button data-testid="settings-check-readiness" onClick={retryReadiness} disabled={isCheckingReadiness} className="forge-secondary mt-2 w-full"><RotateCcw size={12} className={isCheckingReadiness ? 'animate-spin' : ''} /> Check again</button>
              {readiness?.provider === 'openrouter' && readiness.credential.configured && <button data-testid="settings-clear-key" onClick={() => vscode?.postMessage({ command: 'clear-openrouter-key' })} className="forge-link-button mt-2">Change OpenRouter key</button>}
            </Panel>

            <details data-testid="custom-modes-settings" className="rounded border border-slate-800 bg-[#17171b] p-3">
              <summary className="cursor-pointer text-[11px] font-bold uppercase text-slate-300">Custom modes <span className="font-normal text-slate-500">({modes.filter(mode => !mode.builtIn).length}/20)</span></summary>
              <div className="mt-3 space-y-2">
                {modes.filter(mode => !mode.builtIn).map(mode => (
                  <div key={mode.id} className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2 text-[11px]">
                    <div className="min-w-0"><div className="font-semibold text-slate-200">{mode.name}</div><div className="truncate text-slate-500">{mode.intent} · {mode.allowedTools.length} tools</div></div>
                    <button data-testid={`delete-mode-${mode.id}`} onClick={() => vscode?.postMessage({ command: 'delete-mode', modeId: mode.id })} className="text-rose-400 hover:text-rose-300">Delete</button>
                  </div>
                ))}
                <input data-testid="mode-name" value={modeName} onChange={event => setModeName(event.target.value)} className="w-full rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 text-xs text-slate-100" placeholder="Mode name" maxLength={40} />
                <input data-testid="mode-description" value={modeDescription} onChange={event => setModeDescription(event.target.value)} className="w-full rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 text-xs text-slate-100" placeholder="Short description" maxLength={240} />
                <textarea data-testid="mode-instructions" value={modeInstructions} onChange={event => setModeInstructions(event.target.value)} className="min-h-16 w-full rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 text-xs text-slate-100" placeholder="Mode-specific instructions" maxLength={1200} />
                <select data-testid="mode-intent" value={modeIntent} onChange={event => setModeIntent(event.target.value as AgentMode['intent'])} className="w-full rounded border border-slate-700 bg-[#0c0c0f] px-2 py-1.5 text-xs text-slate-100">
                  <option value="code">Code (agentic tools)</option><option value="architect">Architect (advisory)</option><option value="ask">Ask (advisory)</option><option value="review">Review (advisory)</option>
                </select>
                {modeIntent === 'code' && <div className="grid grid-cols-2 gap-1 rounded border border-slate-800 p-2">
                  {OPTIONAL_CUSTOM_CODE_TOOLS.map(tool => <label key={tool} className="flex items-center gap-1 text-[10px] text-slate-400"><input type="checkbox" checked={modeOptionalTools.includes(tool)} onChange={event => setModeOptionalTools(current => event.target.checked ? [...current, tool] : current.filter(item => item !== tool))} /> {tool}</label>)}
                  <div className="col-span-2 mt-1 text-[9px] text-slate-600">Workflow, test, evidence, success, and ask tools are always required.</div>
                </div>}
                {modeError && <div data-testid="mode-error" className="text-[10px] text-rose-400">{modeError}</div>}
                <button data-testid="save-custom-mode" onClick={saveCustomMode} disabled={!modeName.trim() || !modeDescription.trim() || !modeInstructions.trim()} className="forge-primary w-full">Create mode</button>
              </div>
            </details>

            <Panel title="Host Surfaces">
              <button onClick={() => vscode?.postMessage({ command: 'open-terminal' })} className="forge-link-button">
                <Terminal size={13} /> Open native terminal
              </button>
              <button onClick={() => vscode?.postMessage({ command: 'open-diff' })} className="forge-link-button mt-2">
                <ExternalLink size={13} /> Open native diff
              </button>
            </Panel>
          </section>
        )}
      </main>
    </div>
  );
}

function activeMention(input: string): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(input);
  if (!match) return null;
  const atOffset = match[0].lastIndexOf('@');
  return { start: match.index + atOffset, query: match[1].slice(0, 120) };
}

function mergeProgressEvents(current: RunProgressEvent[], incoming: RunProgressEvent[]): RunProgressEvent[] {
  const byId = new Map<string, RunProgressEvent>();
  for (const event of [...current, ...incoming]) {
    if (event?.id) byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((a, b) => a.sessionId === b.sessionId ? a.sequence - b.sequence : a.timestamp.localeCompare(b.timestamp))
    .slice(-300);
}

function progressStatusClass(status: RunProgressEvent['status']): string {
  if (status === 'pass') return 'bg-emerald-400';
  if (status === 'fail') return 'bg-rose-400';
  if (status === 'warning') return 'bg-amber-400';
  if (status === 'running') return 'bg-[#dfff2e] animate-pulse';
  return 'bg-slate-500';
}

function OnboardingStep({ number, title, status, detail, children }: { number: string; title: string; status: 'pass' | 'fail' | 'action'; detail: string; children?: React.ReactNode }) {
  return (
    <div className="border-t border-slate-800 py-3 first:border-t-0">
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${status === 'pass' ? 'bg-emerald-600 text-emerald-100' : status === 'fail' ? 'bg-rose-600 text-rose-100' : 'bg-slate-800 text-slate-300'}`}>{status === 'pass' ? '✓' : number}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-200">{title}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div>
          {children}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-[#17171b] p-3 shadow-sm">
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-300">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="max-w-36 truncate rounded bg-[#111113] px-2 py-1 text-[10px] font-semibold text-slate-100">
      {label}
    </span>
  );
}

function IconButton({ title, testId, onClick, disabled, children }: { title: string; testId?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      data-testid={testId}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-slate-300 hover:bg-slate-700/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 border-b border-slate-800/70 py-1 text-[11px] last:border-b-0">
      <span className="w-24 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 break-words font-mono text-slate-300">{value}</span>
    </div>
  );
}

function LogLine({ log }: { log?: StepLog }) {
  if (!log) {
    return <p className="text-xs text-slate-500">No run events yet.</p>;
  }
  return (
    <div className="rounded border border-slate-800 bg-[#0c0c0f] p-2 text-[11px]">
      <div className="mb-1 flex items-center justify-between gap-2 text-slate-500">
        <span>{log.subAgent || 'Harness'}</span>
        <span>{log.timestamp}</span>
      </div>
      <p className="text-slate-300">{log.message}</p>
    </div>
  );
}

function SearchableModelPicker({ role, label, value, models, onChange }: { role: ModelRole; label: string; value: string; models: any[]; onChange: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [sortMode, setSortMode] = useState<ModelSortMode>('recommended');
  const selected = models.find(model => model.id === value);
  const rankedModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...models]
      .map(model => ({ model, score: scoreModelForRole(model, role, normalizedQuery) }))
      .filter(item => item.score > -1000)
      .sort((a, b) => compareRankedModels(a, b, sortMode, role))
      .slice(0, 80);
  }, [models, query, role, sortMode]);

  return (
    <div className="mb-3" data-testid={`model-picker-${role}`}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>{label}</span>
        <span className="text-[10px] text-slate-600">{selected?.provider || 'OpenRouter'}</span>
      </div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between gap-2 rounded border border-slate-800 bg-[#0c0c0f] px-2 py-2 text-left hover:border-slate-700"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-slate-200">{selected?.name || selected?.id || 'Select model'}</span>
          <span className="block truncate font-mono text-[10px] text-slate-500">{selected?.id || 'No model selected'}</span>
        </span>
        <ChevronUp size={13} className={`shrink-0 text-slate-500 transition-transform ${isOpen ? '' : 'rotate-180'}`} />
      </button>
      {isOpen && (
        <div className="mt-1 rounded border border-slate-800 bg-[#101014]">
          <div className="flex items-center gap-2 border-b border-slate-800 px-2 py-1.5 focus-within:border-[#dfff2e]/60">
            <Search size={13} className="text-slate-500" />
            <input
              data-testid={`model-search-${role}`}
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none"
              placeholder={`Search ${label.toLowerCase()}...`}
            />
          </div>
          <div className="border-b border-slate-800 px-2 py-1.5">
            <ModelSortSelect value={sortMode} onChange={setSortMode} />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {rankedModels.map(({ model, score }) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  onChange(model.id);
                  setQuery('');
                  setIsOpen(false);
                }}
                className={`block w-full border-b border-slate-800/70 px-2 py-2 text-left last:border-b-0 hover:bg-slate-800/60 ${model.id === value ? 'bg-[#dfff2e]/10' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-slate-200">{model.name || model.id}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">{categoryLabel(model, role, score)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                  <span className="truncate font-mono">{model.id}</span>
                  <span className="shrink-0">{formatContext(model.contextLength)} · {formatCost(model)}</span>
                </div>
              </button>
            ))}
            {!rankedModels.length && (
              <div className="px-2 py-2 text-[11px] text-slate-500">No matching models.</div>
            )}
          </div>
        </div>
        )}
      
    </div>
  );
}

function ModelSortSelect({ value, onChange }: { value: ModelSortMode; onChange: (value: ModelSortMode) => void }) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-slate-500">
      <span className="shrink-0">Sort</span>
      <select
        data-testid="model-sort"
        value={value}
        onChange={event => onChange(event.target.value as ModelSortMode)}
        className="min-w-0 flex-1 rounded border border-slate-700 bg-[#111113] px-2 py-1 text-[11px] text-slate-200 outline-none"
      >
        <option value="recommended">Recommended for role</option>
        <option value="context">Largest context</option>
        <option value="reasoning">Reasoning rank</option>
        <option value="coding">Coding rank</option>
        <option value="cost">Lowest cost</option>
        <option value="newest">Newest</option>
      </select>
    </label>
  );
}

function scoreModelForRole(model: any, role: ModelRole, query: string): number {
  const haystack = `${model.id || ''} ${model.name || ''} ${model.provider || ''}`.toLowerCase();
  if (query && !haystack.includes(query)) {
    return -2000;
  }

  let score = query ? 200 : 0;
  const context = Number(model.contextLength || 0);
  const caps: string[] = Array.isArray(model.capabilities) ? model.capabilities : [];
  if (caps.includes('structured_output')) score += 30;
  if (caps.includes('tool_calls')) score += 20;
  if (context >= 128000) score += 10;
  if (context >= 1000000) score += 12;

  const codeHints = ['pareto-code', 'codestral', 'coder', 'code', 'deepseek', 'qwen', 'sonnet', 'gpt-4.1', 'claude'];
  const planHints = ['auto', 'gemini', 'claude', 'sonnet', 'opus', 'gpt-4.1', 'reason', 'r1', 'o3', 'o4'];
  const reviewHints = ['sonnet', 'opus', 'gpt-4.1', 'gpt-4o', 'gemini', 'qwen', 'llama-3.3', 'reason'];
  const cheapPenaltyHints = ['free', 'tiny', 'mini', 'small'];

  const hints = role === 'code' ? codeHints : role === 'plan' ? planHints : reviewHints;
  for (const hint of hints) {
    if (haystack.includes(hint)) score += 18;
  }
  if (role === 'code' && haystack.includes('openrouter/pareto-code')) score += 90;
  if (role === 'plan' && haystack.includes('openrouter/auto')) score += 75;
  if (role === 'review' && (haystack.includes('sonnet') || haystack.includes('gpt-4.1') || haystack.includes('opus'))) score += 35;
  if (role !== 'code' && haystack.includes('code')) score -= 8;
  for (const hint of cheapPenaltyHints) {
    if (haystack.includes(hint)) score -= role === 'review' ? 12 : 5;
  }
  return score;
}

function compareRankedModels(a: { model: any; score: number }, b: { model: any; score: number }, sortMode: ModelSortMode, role: ModelRole): number {
  if (sortMode === 'context') {
    return Number(b.model.contextLength || 0) - Number(a.model.contextLength || 0) || byName(a.model, b.model);
  }
  if (sortMode === 'reasoning') {
    return reasoningRank(b.model) - reasoningRank(a.model) || Number(b.model.contextLength || 0) - Number(a.model.contextLength || 0) || byName(a.model, b.model);
  }
  if (sortMode === 'coding') {
    return codingRank(b.model) - codingRank(a.model) || a.score - b.score || byName(a.model, b.model);
  }
  if (sortMode === 'cost') {
    return modelCost(a.model) - modelCost(b.model) || byName(a.model, b.model);
  }
  if (sortMode === 'newest') {
    return Number(b.model.created || 0) - Number(a.model.created || 0) || byName(a.model, b.model);
  }
  return b.score - a.score || String(role).localeCompare(String(role)) || byName(a.model, b.model);
}

function reasoningRank(model: any): number {
  const haystack = `${model.id || ''} ${model.name || ''} ${(model.supportedParameters || []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const hint of ['reasoning', 'include_reasoning', 'o3', 'o4', 'r1', 'thinking', 'gemini', 'claude', 'qwen3', 'gpt-5']) {
    if (haystack.includes(hint)) score += 20;
  }
  return score + Math.min(Number(model.contextLength || 0) / 100000, 20);
}

function codingRank(model: any): number {
  const haystack = `${model.id || ''} ${model.name || ''}`.toLowerCase();
  let score = 0;
  for (const hint of ['pareto-code', 'coder', 'codestral', 'code', 'deepseek', 'qwen', 'sonnet', 'claude', 'kimi']) {
    if (haystack.includes(hint)) score += 20;
  }
  return score + Math.min(Number(model.contextLength || 0) / 100000, 20);
}

function modelCost(model: any): number {
  if (model.promptPrice === undefined && model.completionPrice === undefined) return Number.MAX_SAFE_INTEGER;
  const prompt = Number(model.promptPrice || 0);
  const completion = Number(model.completionPrice || 0);
  if (prompt < 0 || completion < 0) return Number.MAX_SAFE_INTEGER;
  return prompt + completion;
}

function byName(a: any, b: any): number {
  return String(a.name || a.id).localeCompare(String(b.name || b.id));
}

function categoryLabel(model: any, role: ModelRole, score: number): string {
  if (model.id === 'openrouter/pareto-code' && role === 'code') return 'best coding';
  if (model.id === 'openrouter/auto' && role === 'plan') return 'best planning';
  if (score >= 100) return `strong ${role}`;
  if (score >= 60) return `good ${role}`;
  return 'available';
}

function formatContext(contextLength: number): string {
  if (!contextLength) return '- ctx';
  if (contextLength >= 1000000) return `${(contextLength / 1000000).toFixed(1)}M ctx`;
  if (contextLength >= 1000) return `${Math.round(contextLength / 1000)}K ctx`;
  return `${contextLength} ctx`;
}

function formatCost(model: any): string {
  const cost = modelCost(model);
  if (cost === Number.MAX_SAFE_INTEGER) return '$?';
  return `$${(cost * 1000000).toFixed(2)}/M`;
}
