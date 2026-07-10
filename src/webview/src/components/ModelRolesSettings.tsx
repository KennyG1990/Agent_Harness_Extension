import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  AlertTriangle, 
  CheckCircle2, 
  HelpCircle, 
  Plus, 
  Trash2, 
  RotateCcw, 
  Zap, 
  Play, 
  Terminal, 
  ShieldCheck, 
  Shield, 
  Settings, 
  Lock, 
  ArrowRightLeft, 
  X, 
  Globe, 
  FileCode,
  BookOpen
} from 'lucide-react';
import { 
  ModelDefinition, 
  RoleDefinition, 
  STANDARD_MODELS, 
  DEFAULT_ROLES, 
  DEFAULT_BINDINGS, 
  ModelBindingsTable, 
  assessModelCapabilities, 
  resolveModelForRole, 
  ModelCapability
} from '../data/models';
import { StepLog, FirewallAction } from '../types';

interface ModelRolesSettingsProps {
  bindings: ModelBindingsTable;
  onUpdateBindings: (newBindings: ModelBindingsTable) => void;
  roles: RoleDefinition[];
  onUpdateRoles: (newRoles: RoleDefinition[]) => void;
  modelsCatalog: ModelDefinition[];
  onAddLog: (type: StepLog['type'], message: string, subAgent?: string) => void;
  onSetFirewall: (firewall: FirewallAction) => void;
}

export const ModelRolesSettings: React.FC<ModelRolesSettingsProps> = ({
  bindings,
  onUpdateBindings,
  roles,
  onUpdateRoles,
  modelsCatalog,
  onAddLog,
  onSetFirewall
}) => {
  const [activeMenu, setActiveMenu] = useState<'models' | 'providers' | 'agent' | 'firewall' | 'probes' | 'delegation' | 'about'>('models');
  const [saveLocation, setSaveLocation] = useState<'local' | 'global'>('local');
  const [hidePromptTraining, setHidePromptTraining] = useState<boolean>(true);

  // Add Custom Role State
  const [showAddRoleForm, setShowAddRoleForm] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newRoleCaps, setNewRoleCaps] = useState<ModelCapability[]>([]);
  const [addRoleError, setAddRoleError] = useState('');

  // Probing State
  const [isProbing, setIsProbing] = useState(false);
  const [probeIndex, setProbeIndex] = useState<number>(-1);
  const [probeLogs, setProbeLogs] = useState<string[]>([]);
  const [probeResults, setProbeResults] = useState<Record<string, 'pass' | 'fail' | 'testing'>>({});

  // Delegation Simulator State
  const [simOrigin, setSimOrigin] = useState('reason');
  const [simTarget, setSimTarget] = useState('vision');
  const [simAsset, setSimAsset] = useState('src/assets/unformatted_wireframe.png');
  const [isSimulatingDelegation, setIsSimulatingDelegation] = useState(false);
  const [simLogs, setSimLogs] = useState<string[]>([]);

  const handleResetToDefaults = () => {
    if (window.confirm("Are you sure you want to reset all model roles and bindings back to system defaults?")) {
      localStorage.removeItem('forge_model_bindings_v1');
      localStorage.removeItem('forge_custom_roles_v1');
      onUpdateBindings(DEFAULT_BINDINGS);
      onUpdateRoles(DEFAULT_ROLES);
      onAddLog('warning', "Restored role bindings and slots back to default config table profiles.", "Orchestrator");
    }
  };

  const handleSelectModel = (roleKey: string, modelId: string) => {
    const updated = { ...bindings, [roleKey]: modelId };
    onUpdateBindings(updated);
    
    // Log bind change
    const model = modelsCatalog.find(m => m.id === modelId);
    if (model) {
      onAddLog('info', `Reasserted role binding: slot [${roleKey}] assigned to ${model.name}`, "Orchestrator");
    }
  };

  const toggleCapInNewRole = (cap: ModelCapability) => {
    if (newRoleCaps.includes(cap)) {
      setNewRoleCaps(newRoleCaps.filter(c => c !== cap));
    } else {
      setNewRoleCaps([...newRoleCaps, cap]);
    }
  };

  const handleAddCustomRole = (e: React.FormEvent) => {
    e.preventDefault();
    setAddRoleError('');

    const cleanKey = newRoleKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanKey) {
      setAddRoleError("Role ID/Key is required and should be alphanumeric.");
      return;
    }

    if (roles.some(r => r.key === cleanKey)) {
      setAddRoleError(`Role ID "${cleanKey}" already exists.`);
      return;
    }

    if (!newRoleName.trim()) {
      setAddRoleError("Friendly name is required.");
      return;
    }

    const newRole: RoleDefinition = {
      key: cleanKey,
      name: newRoleName.trim(),
      description: newRoleDesc.trim() || 'Custom user-defined harness role.',
      requiredCapabilities: newRoleCaps,
      isCustom: true
    };

    onUpdateRoles([...roles, newRole]);

    // Bind new role to default
    const updatedBindings = { ...bindings, [cleanKey]: 'google/gemini-2.5-flash' };
    onUpdateBindings(updatedBindings);

    setNewRoleKey('');
    setNewRoleName('');
    setNewRoleDesc('');
    setNewRoleCaps([]);
    setShowAddRoleForm(false);
    onAddLog('success', `Dynamically declared extensible role: slot [${cleanKey}] instantiated.`, "Orchestrator");
  };

  const handleDeleteCustomRole = (key: string) => {
    if (window.confirm(`Are you sure you want to remove the custom role "${key}"?`)) {
      onUpdateRoles(roles.filter(r => r.key !== key));
      const updatedBindings = { ...bindings };
      delete updatedBindings[key];
      onUpdateBindings(updatedBindings);
      onAddLog('warning', `Deleted custom model role slot: [${key}].`, "Orchestrator");
    }
  };

  // Run Capability Probe Sequence
  const runProbes = () => {
    if (isProbing) return;
    setIsProbing(true);
    setProbeIndex(0);
    setProbeLogs(["[PROBING] Launching high-fidelity capability probe sequence...", "[PROBING] Analysing config mapping table..."]);
    
    const initialStatuses: Record<string, 'pass' | 'fail' | 'testing'> = {};
    roles.forEach(r => {
      initialStatuses[r.key] = 'testing';
    });
    setProbeResults(initialStatuses);
  };

  useEffect(() => {
    if (!isProbing || probeIndex < 0 || probeIndex >= roles.length) {
      if (isProbing && probeIndex >= roles.length) {
        setIsProbing(false);
        setProbeIndex(-1);
        setProbeLogs(prev => [...prev, "[PROD] Compliance checks completed. All bindings resolved."]);
      }
      return;
    }

    const currentRole = roles[probeIndex];
    const boundModel = resolveModelForRole(currentRole.key, bindings, modelsCatalog);

    const checkTimeout = setTimeout(() => {
      const { hasRequired, missing } = assessModelCapabilities(currentRole, boundModel);
      
      const newLogs = [
        `[TEST] Checking slot [${currentRole.key}] utilizing model "${boundModel.id}"...`,
        `      -> Context depth check: ${boundModel.contextLength.toLocaleString()} tokens verified.`,
        `      -> Required features: [${currentRole.requiredCapabilities.join(', ')}]`,
      ];

      currentRole.requiredCapabilities.forEach(cap => {
        const pass = boundModel.capabilities.includes(cap);
        newLogs.push(`      -> feature [${cap}] assertion: ${pass ? 'PASS' : 'FAIL'}`);
      });

      if (hasRequired) {
        newLogs.push(`[SUCCESS] Slot [${currentRole.key}] matches capability profile.`);
        setProbeResults(prev => ({ ...prev, [currentRole.key]: 'pass' }));
      } else {
        newLogs.push(`[WARNING] Slot [${currentRole.key}] fails verification. Missing required: [${missing.join(', ')}].`);
        setProbeResults(prev => ({ ...prev, [currentRole.key]: 'fail' }));
      }

      setProbeLogs(prev => [...prev, ...newLogs]);
      setProbeIndex(prev => prev + 1);
    }, 800);

    return () => clearTimeout(checkTimeout);
  }, [isProbing, probeIndex, roles, bindings, modelsCatalog]);

  const runDelegationSimulation = () => {
    if (isSimulatingDelegation) return;
    setIsSimulatingDelegation(true);
    setSimLogs([]);

    const originRoleDef = roles.find(r => r.key === simOrigin);
    const originModel = resolveModelForRole(simOrigin, bindings, modelsCatalog);
    const targetModel = resolveModelForRole(simTarget, bindings, modelsCatalog);

    const steps = [
      { text: `[Harness] Requested state validation on visual asset: '${simAsset}'`, delay: 100 },
      { text: `[Harness] Probe: Checking if origin model supports 'vision' capability...`, delay: 300 },
      {
        text: originModel.capabilities.includes('vision') 
          ? `[Harness] Origin model natively supports 'vision'. Running inline analysis directly...`
          : `[DELEGATION] Lacks 'vision' capability. Automatic routing rules engaged!`,
        delay: 500
      },
      {
        text: !originModel.capabilities.includes('vision')
          ? `[DELEGATION] Role 'vision' is assigned to '${targetModel.id}'. Dispatching sub-call...`
          : `[Harness] Analysis completed natively bypassed cross-modal delegation.`,
        delay: 800
      },
      {
        text: !originModel.capabilities.includes('vision')
          ? `[DELEGATION] Sub-call resolved descriptor: "Parsed a 3-column stats panel with glass backdrop. Values: Cost ($0.12), Speed (142ms), Result (100% Success)."`
          : `[Harness] Analysis: "3-column stats card verified successfully."`,
        delay: 1100
      }
    ];

    let currentStep = 0;
    const runNextStep = () => {
      if (currentStep >= steps.length) {
        setIsSimulatingDelegation(false);
        onAddLog('success', `Automated cross-modal delegation: text-only ${originModel.id} delegated to visual ${targetModel.id}.`, "Harness");
        return;
      }
      setTimeout(() => {
        setSimLogs(prev => [...prev, steps[currentStep].text]);
        currentStep++;
        runNextStep();
      }, 400);
    };

    runNextStep();
  };

  return (
    <div className="flex h-full bg-[#141416] text-[#c5c6c9]" id="forge-settings-tab">
      
      {/* 1. Left internal navigation menu bar inside the Forge settings page */}
      <div className="w-[180px] border-r border-[#0d0d10] bg-[#141416] flex flex-col shrink-0 select-none py-1">
        <div className="px-3.5 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-[#0d0d10] mb-2">
          Forge Settings
        </div>
        <div className="space-y-0.5 px-1.5 flex-1 overflow-y-auto scrollbar-none text-[11px]">
          {[
            { id: 'models', label: 'Models', icon: Cpu },
            { id: 'providers', label: 'Providers', icon: Globe },
            { id: 'agent', label: 'Agent Behaviour', icon: Settings },
            { id: 'firewall', label: 'Firewall Security', icon: Shield },
            { id: 'probes', label: 'Capabilities Probes', icon: Terminal },
            { id: 'delegation', label: 'Delegation Router', icon: ArrowRightLeft },
            { id: 'about', label: 'About Forge Studio', icon: HelpCircle }
          ].map(item => {
            const Icon = item.icon;
            const active = activeMenu === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveMenu(item.id as any)}
                className={`w-full text-left px-2.5 py-1.5 rounded transition-all flex items-center gap-2 cursor-pointer ${
                  active 
                    ? 'bg-[#1e1e24] text-slate-100 font-medium border-l-[3px] border-[#dfff2e]' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1a1a1f]/60'
                }`}
              >
                <Icon size={12} className={active ? 'text-[#dfff2e]' : 'text-slate-500'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="p-2 border-t border-[#0d0d10] text-[9px] text-slate-600 px-3 font-mono">
          Extension Host v1.2
        </div>
      </div>

      {/* 2. Right panels list depending on active selection */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e24]">
        
        {/* Settings top action status bar */}
        <div className="px-5 py-3 border-b border-[#0d0d10] flex items-center justify-between shrink-0 select-none">
          <div>
            <h2 className="text-sm font-bold text-slate-200 capitalize tracking-tight">
              {activeMenu === 'models' ? 'Models' : 
               activeMenu === 'providers' ? 'Providers' : 
               activeMenu === 'agent' ? 'Agent Behaviour' : 
               activeMenu === 'firewall' ? 'Firewall Rules' : 
               activeMenu === 'probes' ? 'Capabilities Probes' : 
               activeMenu === 'delegation' ? 'Delegation Router' : 'About'}
            </h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Customize extension rules, model slots capability routing, and verify oracles checker.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-[#141416] p-0.5 border border-slate-800 rounded">
            <button 
              onClick={() => setSaveLocation('local')}
              className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${saveLocation === 'local' ? 'bg-[#2a2a35] text-slate-100' : 'text-slate-500 hover:text-slate-350'}`}
            >
              Local Config
            </button>
            <button 
              onClick={() => setSaveLocation('global')}
              className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${saveLocation === 'global' ? 'bg-[#2a2a35] text-slate-100' : 'text-slate-500 hover:text-slate-350'}`}
            >
              Global Config
            </button>
          </div>
        </div>

        {/* Dynamic content scroll frame */}
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          <div className="max-w-3xl space-y-5">
            
            {/* SUB PANEL: MODELS */}
            {activeMenu === 'models' && (
              <div className="space-y-4">
                <div className="bg-[#141416]/50 p-4 border border-slate-900 rounded space-y-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Model Mapping Configuration</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-slate-500 block">Default Model</label>
                      <select className="w-full text-xs bg-[#141416] text-slate-300 p-2 rounded border border-slate-800 outline-none cursor-pointer">
                        <option>OpenRouter / google/gemini-2.5-flash</option>
                      </select>
                      <span className="text-[9px] text-slate-600">Primary model for conversations and general routing</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-slate-500 block">Small Model</label>
                      <select className="w-full text-xs bg-[#141416] text-slate-300 p-2 rounded border border-slate-800 outline-none cursor-pointer">
                        <option>OpenRouter / google/gemini-2.5-flash-lite</option>
                      </select>
                      <span className="text-[9px] text-slate-600">Lightweight model for title, descriptions, context compression</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-slate-500 block">Subagent Model</label>
                      <select className="w-full text-xs bg-[#141416] text-slate-300 p-2 rounded border border-slate-800 outline-none cursor-pointer">
                        <option>OpenRouter / google/gemini-2.5-pro</option>
                      </select>
                      <span className="text-[9px] text-slate-600">High-tier model for advanced decomposition coding blocks</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-slate-500 block">Autocomplete Model</label>
                      <select className="w-full text-xs bg-[#141416] text-slate-300 p-2 rounded border border-slate-800 outline-none cursor-pointer">
                        <option>Not set (use server defaults)</option>
                      </select>
                      <span className="text-[9px] text-slate-600">Handles inline real-time smart ghost text suggestions</span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-[#0d0d10] mt-3">
                    <span className="text-slate-400 text-[11px] font-bold">Hide Prompt-Training Models</span>
                    <button 
                      onClick={() => setHidePromptTraining(!hidePromptTraining)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-all outline-none cursor-pointer ${hidePromptTraining ? 'bg-[#dfff2e]' : 'bg-[#141416]'}`}
                    >
                      <div className={`h-4 w-4 rounded-full shadow-sm transition-all ${hidePromptTraining ? 'bg-[#0d0d10] translate-x-4' : 'bg-slate-400'}`} />
                    </button>
                  </div>
                </div>

                {/* Model Roles Config - Grid of Current Binder Statuses */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Model per Mode</h3>
                    <button
                      onClick={handleResetToDefaults}
                      className="px-2 py-1 bg-transparent hover:bg-slate-800 border border-slate-800 rounded text-[9px] font-bold transition-all text-slate-400 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw size={10} />
                      <span>Restore defaults</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {roles.map((role) => {
                      const boundModelId = bindings[role.key] || 'google/gemini-2.5-flash';
                      const boundModel = resolveModelForRole(role.key, bindings, modelsCatalog);
                      const { hasRequired, missing } = assessModelCapabilities(role, boundModel);

                      return (
                        <div key={role.key} className="p-3.5 bg-[#141416]/50 border border-slate-900 rounded-lg flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start gap-2">
                              <div>
                                <span className="text-[8px] font-mono uppercase bg-[#141416] p-1 rounded text-slate-500">mode: {role.key}</span>
                                <h4 className="text-xs font-bold text-slate-200 mt-1">{role.name}</h4>
                              </div>
                              {role.isCustom && (
                                <button
                                  onClick={() => handleDeleteCustomRole(role.key)}
                                  className="text-slate-500 hover:text-rose-400 p-0.5 cursor-pointer"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1">{role.description}</p>
                          </div>

                          <div className="mt-3 space-y-1.5">
                            <select
                              value={boundModelId}
                              onChange={(e) => handleSelectModel(role.key, e.target.value)}
                              className="w-full text-[11px] bg-[#141416] text-slate-300 p-1.5 rounded border border-slate-800 focus:outline-none cursor-pointer"
                            >
                              {modelsCatalog.map((model) => {
                                const containsAll = role.requiredCapabilities.every(c => model.capabilities.includes(c));
                                return (
                                  <option key={model.id} value={model.id}>
                                    {model.name} {!containsAll ? '⚠️ (caps gap)' : ''}
                                  </option>
                                );
                              })}
                            </select>

                            {!hasRequired ? (
                              <div className="p-1 px-1.5 rounded bg-amber-500/10 text-amber-500 text-[8px] leading-snug flex gap-1">
                                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                                <span>Fallback delegation will run! Missing: [{missing.join(', ')}]</span>
                              </div>
                            ) : (
                              <div className="text-[8px] font-mono text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 size={8} />
                                <span>Capability compliant</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* New Role ext form */}
                    {!showAddRoleForm ? (
                      <button
                        onClick={() => setShowAddRoleForm(true)}
                        className="p-3.5 border border-dashed border-slate-800 rounded-lg hover:bg-slate-900/10 flex flex-col items-center justify-center text-slate-500 hover:text-slate-350 cursor-pointer text-center h-full min-h-[120px]"
                      >
                        <Plus size={16} className="text-[#dfff2e] mb-1" />
                        <span className="text-[11px] font-bold">Add custom mode slot</span>
                        <p className="text-[9px] mt-0.5 max-w-[200px]">Define a brand-new role bound dynamically to standard LLM endpoints.</p>
                      </button>
                    ) : (
                      <form onSubmit={handleAddCustomRole} className="p-3.5 bg-slate-950/20 border border-slate-800 rounded-lg space-y-3">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-900">
                          <span className="text-[10px] font-bold text-[#dfff2e] uppercase font-sans">Add Custom Mode</span>
                          <button type="button" onClick={() => setShowAddRoleForm(false)} className="text-slate-400 hover:text-white">
                            <X size={12} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            required
                            placeholder="Unique key id"
                            value={newRoleKey}
                            onChange={(e) => setNewRoleKey(e.target.value)}
                            className="bg-[#141416] border border-slate-800 text-[10px] p-1.5 rounded text-slate-200 outline-none"
                          />
                          <input
                            type="text"
                            required
                            placeholder="Friendly Name"
                            value={newRoleName}
                            onChange={(e) => setNewRoleName(e.target.value)}
                            className="bg-[#141416] border border-slate-800 text-[10px] p-1.5 rounded text-slate-200 outline-none"
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Description"
                          value={newRoleDesc}
                          onChange={(e) => setNewRoleDesc(e.target.value)}
                          className="w-full bg-[#141416] border border-slate-800 text-[10px] p-1.5 rounded text-slate-200 outline-none"
                        />
                        <button type="submit" className="w-full text-[10px] font-bold p-1 bg-[#dfff2e] text-[#0d0d10] hover:opacity-90 rounded">
                          Create Custom Mode
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SUB PANEL: PROVIDERS */}
            {activeMenu === 'providers' && (
              <div className="bg-[#141416]/50 p-4 border border-slate-900 rounded space-y-4 text-xs font-sans">
                <h3 className="text-xs font-bold text-slate-300">Connected Endpoint Providers</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-[#141416] border border-slate-850 rounded">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      <div>
                        <span className="font-bold text-slate-200">OpenRouter Endpoint API</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">Proxied multi-model catalog gateway</p>
                      </div>
                    </div>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 font-mono uppercase rounded">Ready</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-[#141416] border border-slate-850 rounded">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <div>
                        <span className="font-bold text-slate-200">Google Gemini API Node</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">Direct developer framework server connection</p>
                      </div>
                    </div>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 font-mono uppercase rounded">Connected</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-[#141416] border border-slate-850 rounded">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                      <div>
                        <span className="font-bold text-slate-200">Offline Simulation Engine</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">Local high-fidelity seed engine</p>
                      </div>
                    </div>
                    <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 font-mono uppercase rounded">Simulating</span>
                  </div>
                </div>
              </div>
            )}

            {/* SUB PANEL: AGENT BEHAVIOUR */}
            {activeMenu === 'agent' && (
              <div className="bg-[#141416]/50 p-4 border border-slate-900 rounded space-y-4 text-xs font-sans">
                <h3 className="text-xs font-bold text-slate-300">Agent Extension Behaviour Configuration</h3>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-bold block">Refinement Retries Limit</label>
                    <input type="number" defaultValue={3} className="bg-[#141416] border border-slate-850 p-2 rounded w-full text-xs text-slate-300 focus:outline-none" />
                    <span className="text-[9px] text-slate-500 block">Maximum file code refinement iterations to clear testing and compilation checks</span>
                  </div>

                  <div className="space-y-1 pt-2">
                    <label className="text-[10px] text-slate-400 font-bold block">Automatic Commit Checks</label>
                    <select className="bg-[#141416] border border-[#1b1b1f] p-2 rounded w-full text-xs text-slate-300 focus:outline-none cursor-pointer">
                      <option>Ask User Approval before Commit (Interactive Mode)</option>
                      <option>Auto Commit upon 100% Compiler Pass (Autonomous Mode)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* SUB PANEL: FIREWALL */}
            {activeMenu === 'firewall' && (
              <div className="bg-[#141416]/50 p-4 border border-slate-900 rounded space-y-4 text-xs font-sans">
                <h3 className="text-xs font-bold text-slate-300">Deterministic Validation Firewall Rules</h3>
                <p className="text-[10px] text-slate-500 pb-2 border-b border-slate-900">
                  Secures and coordinates sandbox executions. Prevents out-of-scope files writes, blocks system abuse vectors.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 bg-[#141416] rounded border border-slate-850 font-mono text-[10px]">
                    <div className="flex items-center gap-2">
                      <Shield size={12} className="text-[#dfff2e] shrink-0" />
                      <span>RULE_DIRECTORY_ROOT_RESTRICTION</span>
                    </div>
                    <span className="text-emerald-400 font-bold uppercase text-[9px]">Enforced</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-[#141416] rounded border border-slate-850 font-mono text-[10px]">
                    <div className="flex items-center gap-2">
                      <Shield size={12} className="text-[#dfff2e] shrink-0" />
                      <span>RULE_TEST_RECOMPILE_VERIFICATION</span>
                    </div>
                    <span className="text-emerald-400 font-bold uppercase text-[9px]">Active</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-[#141416] rounded border border-slate-850 font-mono text-[10px]">
                    <div className="flex items-center gap-2">
                      <Shield size={12} className="text-[#dfff2e] shrink-0" />
                      <span>RULE_USD_BUDGET_CAP</span>
                    </div>
                    <span className="text-amber-400 font-bold uppercase text-[9px]">Warn @ $2.00</span>
                  </div>
                </div>

                <div className="p-3 bg-indigo-900/10 border border-indigo-500/10 text-indigo-400 rounded leading-relaxed text-[10px] flex gap-2">
                  <ShieldCheck size={14} className="shrink-0 mt-0.5" />
                  <span>The custom firewall automatically logs violation states side-by-side or inside the loop console. Trigger Walker scenarios 1 and 2 to mock real-time containment triggers.</span>
                </div>
              </div>
            )}

            {/* SUB PANEL: PROBES */}
            {activeMenu === 'probes' && (
              <div className="bg-[#141416]/50 p-4 border border-slate-900 rounded space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-slate-900">
                  <div>
                    <h3 className="text-xs font-bold text-slate-300">Interactive Capability Probes Console</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Assert code logic, parser limits, and vision capacities on server configurations.</p>
                  </div>
                  <button
                    onClick={runProbes}
                    disabled={isProbing}
                    className="px-3 py-1.5 bg-[#dfff2e] text-[#0d0d10] hover:opacity-90 disabled:bg-[#141416] disabled:text-slate-500 font-bold rounded text-[10px] uppercase tracking-wider transition-all cursor-pointer select-none"
                  >
                    {isProbing ? 'Checking...' : 'Run Diagnostics'}
                  </button>
                </div>

                <div className="bg-[#141416] rounded-lg p-3 font-mono text-[10px] text-slate-300 h-48 overflow-y-auto space-y-1 scrollbar-thin border border-slate-850">
                  {probeLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 font-sans">
                      <Terminal size={18} />
                      <span>Diagnostics idle. Clear linter by tapping 'Run Diagnostics' above.</span>
                    </div>
                  ) : (
                    probeLogs.map((logStr, lIdx) => (
                      <div key={lIdx} className={`whitespace-pre-wrap ${
                        logStr.includes('[SUCCESS]') ? 'text-emerald-400' :
                        logStr.includes('[WARNING]') ? 'text-amber-400' :
                        logStr.includes('[TEST]') ? 'text-indigo-400' : 'text-slate-400'
                      }`}>
                        {logStr}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* SUB PANEL: DELEGATION */}
            {activeMenu === 'delegation' && (
              <div className="bg-[#141416]/50 p-4 border border-slate-900 rounded space-y-4 text-xs font-sans">
                <div className="flex justify-between items-center pb-3 border-b border-slate-900">
                  <div>
                    <h3 className="text-xs font-bold text-slate-300">Cross-Modal Router Delegation</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">Simulate automatic delegation requests from text models to vision peers.</p>
                  </div>
                  <button
                    onClick={runDelegationSimulation}
                    disabled={isSimulatingDelegation}
                    className="px-3 py-1.5 bg-[#dfff2e] text-[#0d0d10] hover:opacity-90 disabled:bg-[#141416] disabled:text-slate-500 font-bold rounded text-[10px] uppercase tracking-wider transition-all cursor-pointer select-none"
                  >
                    {isSimulatingDelegation ? 'Routing...' : 'Trigger Simulation'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[9px] uppercase font-mono text-slate-500 block mb-1">Origin Node</label>
                    <select value={simOrigin} onChange={(e) => setSimOrigin(e.target.value)} className="w-full text-[10px] bg-[#141416] text-slate-300 p-1.5 border border-slate-850 rounded">
                      {roles.map(r => (
                        <option key={r.key} value={r.key}>{r.name} ({r.key})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono text-slate-500 block mb-1">Delegate Vision To</label>
                    <select value={simTarget} onChange={(e) => setSimTarget(e.target.value)} className="w-full text-[10px] bg-[#141416] text-slate-300 p-1.5 border border-slate-850 rounded">
                      {roles.map(r => (
                        <option key={r.key} value={r.key}>{r.name} ({r.key})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono text-slate-500 block mb-1">Asset To Parse</label>
                    <select value={simAsset} onChange={(e) => setSimAsset(e.target.value)} className="w-full text-[10px] bg-[#141416] text-slate-300 p-1.5 border border-slate-850 rounded">
                      <option value="src/assets/unformatted_wireframe.png">wireframe_card.png</option>
                      <option value="src/assets/bento_design.png">bento_layout_spec.png</option>
                    </select>
                  </div>
                </div>

                <div className="bg-[#141416] border border-slate-850 rounded p-3 font-mono text-[10px] text-slate-300 h-28 overflow-y-auto space-y-1">
                  {simLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 font-sans gap-2">
                      <ArrowRightLeft size={16} />
                      <span>Select roles and click 'Trigger Simulation' to check visual offloads.</span>
                    </div>
                  ) : (
                    simLogs.map((logStr, lIdx) => (
                      <div key={lIdx} className={`whitespace-pre-wrap ${logStr.startsWith('[DELEGATION]') ? 'text-teal-400' : 'text-slate-400'}`}>
                        {logStr}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* SUB PANEL: ABOUT */}
            {activeMenu === 'about' && (
              <div className="bg-[#141416]/50 p-5 border border-slate-900 rounded space-y-4 text-xs font-sans leading-relaxed">
                <div className="flex items-center gap-3 border-b border-slate-900 pb-3">
                  <div className="h-10 w-10 rounded bg-[#dfff2e] flex items-center justify-center font-bold text-black text-xs shadow-md">
                    FORGE
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-200">Forge Studio Extension Host</h3>
                    <p className="text-[10px] text-slate-600">First-Class Sandbox Code-Patch Coordinator</p>
                  </div>
                </div>

                <div className="space-y-2 text-slate-400">
                  <p>
                    <strong>Forge Studio</strong> is an elite workspace extension allowing large language model clusters to execute, debug, test, and safely build scripts. 
                  </p>
                  <p>
                    Utilizing a strict <strong>Propose-Validate-Commit deterministic firewall</strong> layer, the extension inspects and runs proposed patches inside container boundaries, executing oracles to verify outcomes before saving to main checkpoints.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
};
