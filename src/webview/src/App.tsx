import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronUp,
  CheckCircle2,
  Circle,
  Database,
  ExternalLink,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Star,
  Terminal,
  Wand2,
} from 'lucide-react';
import { HarnessState, StepLog } from './types';
import { DEFAULT_BINDINGS, PERSISTED_BINDINGS_KEY, STANDARD_MODELS } from './data/models';

type ViewMode = 'run' | 'proof' | 'settings';

const SLASH_COMMANDS: Array<{ cmd: string; hint: string }> = [
  { cmd: '/goal', hint: 'Autonomous firewalled run. Optional lines: done when: | constraints: | non-goals: | budget: $N | max steps: N. Type it, then press Run ▶.' },
  { cmd: '/research', hint: 'Deep web research (plan → web-grounded workers → cited report). Artifact saves to .forge/research/ and attaches to this conversation. Press Enter.' }
];
type ModelRole = 'code' | 'plan' | 'review';
type AgentRole = 'Code' | 'Architect' | 'Ask' | 'Code Reviewer' | 'Code Simplifier' | 'Code Skeptic' | 'Debug' | 'Plan' | 'Test Engineer';
type InferenceMode = 'Instant' | 'Thinking';
type ChatMessage = { role: 'user' | 'assistant'; content: string; modelId?: string; error?: boolean };
type ModelSortMode = 'recommended' | 'context' | 'reasoning' | 'coding' | 'cost' | 'newest';

const agentRoles: { id: AgentRole; description: string; binding: ModelRole }[] = [
  { id: 'Code', description: 'Default agent. Executes tools based on configured permissions.', binding: 'code' },
  { id: 'Architect', description: 'Stress-test technical designs and produce implementation-ready plans.', binding: 'plan' },
  { id: 'Ask', description: 'Get answers and explanations without making changes to the codebase.', binding: 'plan' },
  { id: 'Code Reviewer', description: 'Senior software engineer conducting thorough code reviews.', binding: 'review' },
  { id: 'Code Simplifier', description: 'Simplify and refactor features of the codebase.', binding: 'code' },
  { id: 'Code Skeptic', description: 'Criticize code and plans before they become expensive mistakes.', binding: 'review' },
  { id: 'Debug', description: 'Diagnose and fix software issues systematically.', binding: 'code' },
  { id: 'Plan', description: 'Plan mode. Prefer plan artifacts before filesystem mutation.', binding: 'plan' },
  { id: 'Test Engineer', description: 'QA engineer and testing specialist.', binding: 'review' }
];

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
  const [verificationMatrixReport, setVerificationMatrixReport] = useState<any>(null);
  const [isolatedRunReport, setIsolatedRunReport] = useState<any>(null);
  const [chatInput, setChatInput] = useState('');
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedRole, setSelectedRole] = useState<AgentRole>('Code');
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('Instant');
  const [openComposerMenu, setOpenComposerMenu] = useState<'role' | 'model' | 'inference' | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [composerSortMode, setComposerSortMode] = useState<ModelSortMode>('recommended');
  const [favoriteModels, setFavoriteModels] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('forge_favorite_models_v1') || '[]');
    } catch {
      return [];
    }
  });
  const [autoApprove, setAutoApprove] = useState(false);

  useEffect(() => {
    refreshModels();
    vscode?.postMessage({ command: 'load-state' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'state-update') {
        setState(message.state);
        setIsBusy(false);
        setStatusMessage(`Run ${message.state.status}: ${message.state.haltReason || message.state.firewall?.details || 'state updated'}`);
      }
      if (message.command === 'models-list') {
        setModelsCatalog(message.models || STANDARD_MODELS);
        setIsRefreshingModels(false);
        setModelsStatus(`Catalog loaded: ${(message.models || STANDARD_MODELS).length} models.`);
      }
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

  const activeTask = useMemo(() => {
    return state?.taskGraph.tasks.find(task => task.status === 'running' || task.status === 'pending');
  }, [state]);

  const latestLog = state?.logs[state.logs.length - 1];
  const latestEvidence = state?.evidenceLedger[state.evidenceLedger.length - 1];
  const selectedRoleConfig = agentRoles.find(role => role.id === selectedRole) || agentRoles[0];
  const selectedRoleBinding = selectedRoleConfig.binding;
  const selectedModelId = bindings[selectedRoleBinding] || bindings[selectedRole] || bindings.code || bindings.Editor || 'openrouter/pareto-code';
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
    vscode?.postMessage({ command: 'init', goal, modelBindings: bindings });
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

  const runVerificationMatrix = () => {
    setIsBusy(true);
    setStatusMessage('Running verification fixture matrix in disposable workspaces...');
    vscode?.postMessage({ command: 'run-verification-fixture-matrix' });
  };

  const runIsolatedAgentGoal = () => {
    setIsBusy(true);
    setStatusMessage('Running Forge Agent in an isolated workspace copy...');
    vscode?.postMessage({
      command: 'run-isolated-agent-goal',
      options: {
        goal: 'Run Forge Agent in an isolated workspace copy and report whether the source workspace stayed unchanged.',
        modelBindings: bindings,
        maxSteps: 6,
        keepIsolated: true
      }
    });
  };

  const openArtifact = (artifact: string) => {
    vscode?.postMessage({ command: 'open-artifact', artifact });
  };

  const sendChat = () => {
    const content = chatInput.trim();
    if (!content || isChatting) {
      return;
    }
    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', content }];
    const roleScopedMessages = nextMessages.map((message, index) => {
      if (index !== nextMessages.length - 1 || message.role !== 'user') {
        return { role: message.role, content: message.content };
      }
      return {
        role: message.role,
        content: `[${selectedRole} mode | ${inferenceMode} inference] ${message.content}`
      };
    });
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatting(true);
    vscode?.postMessage({
      command: 'chat',
      modelId: selectedModelId,
      sessionId: state?.sessionId,
      messages: roleScopedMessages
    });
  };

  const startRunFromComposer = () => {
    const composerGoal = chatInput.trim() || chatMessages.filter(message => message.role === 'user').at(-1)?.content || goal;
    setGoal(composerGoal);
    setIsBusy(true);
    setStatusMessage('Running firewalled agent loop...');
    vscode?.postMessage({ command: 'run-agent-loop', goal: composerGoal, modelBindings: bindings });
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
      <header className="px-3 py-2 border-b border-slate-800 bg-[#151518]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-[#dfff2e] text-black font-black flex items-center justify-center text-xs">F</div>
            <h1 className="text-xs font-bold tracking-wide">Forge Agent</h1>
          </div>
          <div className="flex items-center gap-1">
            <button data-testid="view-run" onClick={() => setActiveView('run')} className={`rounded border px-2 py-1 text-[10px] ${activeView === 'run' ? 'border-[#dfff2e] text-[#dfff2e]' : 'border-slate-800 text-slate-500'}`}>Run</button>
            <button data-testid="view-proof" onClick={() => setActiveView('proof')} className="rounded border border-slate-800 p-1 text-slate-500 hover:text-slate-200" title="Proof"><ShieldCheck size={13} /></button>
            <button data-testid="view-settings" onClick={() => setActiveView('settings')} className="rounded border border-slate-800 p-1 text-slate-500 hover:text-slate-200" title="Settings"><Settings size={13} /></button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {activeView === 'run' && (
          <section data-testid="run-console" className="flex h-full flex-col">
            <div data-testid="agent-chat" className="flex-1 select-text cursor-auto overflow-y-auto p-3" style={{ userSelect: 'text' }}>
              {chatMessages.length === 0 ? (
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
                  placeholder="Type a message, or / for commands (Tab completes; Run ▶ executes /goal)"
                />
                </div>
                <div className="relative mt-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <button data-testid="role-menu-button" onClick={() => setOpenComposerMenu(openComposerMenu === 'role' ? null : 'role')}>
                      <Chip label={selectedRole} />
                    </button>
                    <button data-testid="model-menu-button" onClick={() => setOpenComposerMenu(openComposerMenu === 'model' ? null : 'model')}>
                      <Chip label={selectedModelId} />
                    </button>
                    <button data-testid="inference-menu-button" onClick={() => setOpenComposerMenu(openComposerMenu === 'inference' ? null : 'inference')}>
                      <Chip label={inferenceMode} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-slate-300">
                    <IconButton title={state ? 'Codebase index available for this workspace' : 'Codebase indexing is waiting for a workspace run'} onClick={() => setStatusMessage(state ? 'Codebase index is available from persisted Forge artifacts.' : 'Codebase indexing needs an initialized workspace run.')}>
                      <Database size={14} />
                    </IconButton>
                    <IconButton title={autoApprove ? 'Auto-approve prompts is enabled' : 'Auto-approve is disabled. Click to approve permission prompts automatically.'} onClick={() => setAutoApprove(!autoApprove)}>
                      <ShieldCheck size={14} />
                    </IconButton>
                    <IconButton title="Enhance prompt" onClick={enhancePrompt}>
                      <Wand2 size={14} />
                    </IconButton>
                    <IconButton title="Start voice input" onClick={startVoiceInput}>
                      <Mic size={14} />
                    </IconButton>
                    <IconButton title="Start firewalled run" testId="initialize-run" onClick={startRunFromComposer} disabled={isBusy}>
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
                      {agentRoles.map(role => (
                        <button
                          key={role.id}
                          className={`block w-full px-3 py-2 text-left ${selectedRole === role.id ? 'bg-[#06466d] text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                          onClick={() => {
                            setSelectedRole(role.id);
                            setOpenComposerMenu(null);
                          }}
                        >
                          <div className="text-xs font-bold">{role.id}</div>
                          <div className="mt-1 text-[11px] text-slate-400">{role.description}</div>
                        </button>
                      ))}
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
                </div>
              </div>
              <div data-testid="run-status-line" className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span className="truncate">{state?.status || 'idle'} · {activeTask?.title || statusMessage}</span>
                <span className="shrink-0 font-mono">
                  tests {state?.oracleStatuses.tests || '-'} · cost ${budgetSpent.toFixed(4)}/${budgetCap.toFixed(2)} · halt {state?.runStats?.budgetHalts ?? 0} · model {state?.runStats?.modelDrivenProposals ?? 0} · fallback {state?.runStats?.fallbackActions ?? 0} · repair {state?.runStats?.repairAttempts ?? 0} · reflect {state?.runStats?.reflectionAttempts ?? 0} · review {state?.runStats?.reviewerApprovals ?? 0} · crit {state?.runStats?.reviewerCritiques ?? 0} · pre {state?.runStats?.preCommitReviews ?? 0} · cmd {state?.runStats?.commandEffectCaptures ?? 0} · esc {state?.runStats?.escalationCount ?? 0} · ctx {state?.runStats?.contextRefreshes ?? 0} · hand {state?.runStats?.roleHandoffRefreshes ?? 0} · ret {state?.runStats?.retrievalRefreshes ?? 0} · safe {state?.runStats?.safetyCheckpoints ?? 0}
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

            <Panel title="Isolated Run">
              <p className="text-[11px] text-slate-400 mb-2">
                Runs the normal harness against a temp workspace copy and proves whether the source workspace changed.
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
