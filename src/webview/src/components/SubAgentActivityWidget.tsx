import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Compass, 
  Code2, 
  ShieldCheck, 
  ShieldAlert, 
  Terminal, 
  Activity, 
  Maximize2, 
  Minimize2, 
  Play, 
  AlertCircle
} from 'lucide-react';

interface SubAgentActivityWidgetProps {
  activeSubAgent: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  firewallStage?: string;
  onSelectAgent?: (agentName: string) => void;
  inline?: boolean;
}

export const SubAgentActivityWidget: React.FC<SubAgentActivityWidgetProps> = ({
  activeSubAgent,
  status,
  firewallStage = 'IDLE',
  onSelectAgent,
  inline = false
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState<string | null>(null);

  // Mapping actual activeSubAgent values from the core loop to our 4 nodes
  const getActiveRole = (): 'Architect' | 'Editor' | 'Reviewer' | 'Firewall' | 'None' => {
    if (status === 'idle' || status === 'success') {
      return 'None';
    }
    const cleanAgent = activeSubAgent.toLowerCase();
    if (cleanAgent.includes('architect') || cleanAgent.includes('planner') || cleanAgent.includes('explorer')) {
      return 'Architect';
    }
    if (cleanAgent.includes('editor') || cleanAgent.includes('code')) {
      return 'Editor';
    }
    if (cleanAgent.includes('reviewer') || cleanAgent.includes('auditor') || cleanAgent.includes('orchestrator')) {
      // Orchestrator coordinates; review step is main checkpoint
      return 'Reviewer';
    }
    if (cleanAgent.includes('firewall') || cleanAgent.includes('fence') || cleanAgent.includes('gatekeeper') || firewallStage !== 'IDLE') {
      return 'Firewall';
    }
    return 'None';
  };

  const currentActiveRole = getActiveRole();

  const agentsList = [
    {
      id: 'Architect' as const,
      name: 'Architect',
      alias: 'Planner / Reasoner',
      icon: Compass,
      color: 'text-indigo-400',
      bgColor: 'bg-indigo-500/10',
      borderColor: 'border-indigo-500/30',
      glowColor: 'shadow-indigo-500/20',
      desc: 'Creates PLAN.md checklists and tracks taskGraph completion requirements cleanly.',
      metrics: 'Ctx Window: 128k'
    },
    {
      id: 'Editor' as const,
      name: 'Editor',
      alias: 'TypeScript / JSX Coder',
      icon: Code2,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
      borderColor: 'border-purple-500/30',
      glowColor: 'shadow-purple-500/20',
      desc: 'Writes, patches, and modifies React and TypeScript components inside the local sandbox.',
      metrics: 'Speed: 45ms/tok'
    },
    {
      id: 'Reviewer' as const,
      name: 'Reviewer',
      alias: 'Auditor & Validator',
      icon: ShieldAlert,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      glowColor: 'shadow-amber-500/20',
      desc: 'Validates code syntax on every compile run to avoid regressions and bad assets.',
      metrics: 'Coverage: 100%'
    },
    {
      id: 'Firewall' as const,
      name: 'Firewall',
      alias: 'Safety Gatekeeper',
      icon: ShieldCheck,
      color: 'text-rose-400',
      bgColor: 'bg-rose-500/10',
      borderColor: 'border-rose-500/30',
      glowColor: 'shadow-rose-500/20',
      desc: 'Locks sensitive file system paths, prevents credential leaks, and checks safety constraints.',
      metrics: 'Sandbox: Locked'
    }
  ];

  return (
    <div 
      className={inline ? "font-sans select-none w-full" : "absolute bottom-4 right-4 z-40 font-sans select-none max-w-[340px] w-full"}
      id="sub-agent-activity-widget-container"
    >
      <div 
        className={inline ? "bg-transparent space-y-3" : "bg-[#141416]/95 border border-slate-800/80 rounded-xl shadow-[0_12px_40px_-5px_rgba(0,0,0,0.8)] overflow-hidden"}
        style={inline ? {} : { borderBottomWidth: '3px' }}
      >
        {/* Toggle Head / Bar only shown when NOT inline */}
        {!inline && (
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/40 border-b border-slate-850">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Activity size={12.5} className="text-[#dfff2e] animate-pulse" />
                {status === 'running' && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 bg-[#dfff2e] rounded-full animate-ping" />
                )}
              </div>
              <span className="text-[10px] font-extrabold tracking-wider text-slate-205 uppercase font-mono">
                SUB-AGENT PROCESSES
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {status === 'running' && (
                <span className="text-[8px] bg-[#dfff2e]/10 text-[#dfff2e] border border-[#dfff2e]/20 px-1.5 py-0.2 rounded font-mono uppercase animate-pulse">
                  processing
                </span>
              )}
              <button 
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition-all cursor-pointer"
                title={isMinimized ? "Show details" : "Minimize Widget"}
              >
                {isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
              </button>
            </div>
          </div>
        )}

        {/* Outer body */}
        <AnimatePresence initial={false}>
          {(!isMinimized || inline) && (
            <motion.div 
              initial={inline ? false : { height: 0, opacity: 0 }}
              animate={inline ? { height: 'auto', opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={inline ? false : { height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={inline ? "space-y-3" : "p-3.5 space-y-3"}
            >
              {/* Central coordination status */}
              <div className="flex items-center gap-2.5 bg-slate-950/30 p-2.5 border border-slate-900 rounded-lg">
                <div className="h-2 w-2 rounded-full bg-[#dfff2e] relative">
                  {status === 'running' && (
                    <span className="absolute inset-0 h-full w-full bg-[#dfff2e] rounded-full animate-ping" />
                  )}
                </div>
                <div className="text-[10.5px]">
                  <span className="text-slate-405 block font-sans">
                    {status === 'running' ? (
                      <>Currently listening to <strong className="text-slate-200">{activeSubAgent}</strong></>
                    ) : (
                      <span className="text-slate-500 font-mono">Sandbox Orchestrator: Idle / Waiting</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Sub-agents activity rows */}
              <div className="space-y-2">
                {agentsList.map((agent) => {
                  const isActive = currentActiveRole === agent.id;
                  const Icon = agent.icon;

                  return (
                    <div 
                      key={agent.id}
                      onClick={() => {
                        setSelectedDetails(selectedDetails === agent.id ? null : agent.id);
                        if (onSelectAgent) onSelectAgent(agent.id);
                      }}
                      className={`relative border transition-all rounded-lg p-2.5 cursor-pointer flex items-center justify-between select-none ${
                        isActive 
                          ? `${agent.bgColor} ${agent.borderColor} shadow-md` 
                          : 'bg-[#18181c]/50 border-slate-900 hover:border-slate-800'
                      }`}
                    >
                      {/* Active glowing backdrop ring */}
                      {isActive && (
                        <div className="absolute inset-0 rounded-lg pointer-events-none border border-[#dfff2e]/10 bg-gradient-to-r from-[#dfff2e]/1 to-transparent" />
                      )}

                      <div className="flex items-center gap-3 relative z-10">
                        {/* Icon Container with beautiful layered pulse dynamics */}
                        <div className="relative">
                          {isActive && (
                            <motion.span 
                              className={`absolute -inset-2.5 rounded-full ${agent.bgColor} pointer-events-none`}
                              initial={{ scale: 0.8, opacity: 0.6 }}
                              animate={{ scale: [1, 1.45, 1], opacity: [0.6, 0, 0.6] }}
                              transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                            />
                          )}
                          <div className={`h-7 w-7 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                            isActive 
                              ? `${agent.bgColor} ${agent.borderColor} ${agent.color}` 
                              : 'bg-slate-950/50 border-slate-850/80 text-slate-500'
                          }`}>
                            <Icon size={13.5} className={isActive ? 'animate-pulse' : ''} />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-baseline gap-1.5">
                            <span className={`text-[11px] font-bold tracking-wide ${isActive ? 'text-slate-100' : 'text-slate-400'}`}>
                              {agent.name}
                            </span>
                            <span className="text-[8px] font-mono text-slate-550">
                              {agent.alias}
                            </span>
                          </div>
                          
                          <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5 line-clamp-1">
                            {agent.desc}
                          </p>
                        </div>
                      </div>

                      {/* Spark activity status */}
                      <div className="flex items-center gap-1.5 shrink-0 z-10 select-none">
                        {isActive ? (
                          <div className="flex items-center gap-1">
                            <span className="flex h-1.5 w-1.5 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                            <span className="text-[8.5px] font-mono text-emerald-450 uppercase tracking-widest font-bold">
                              ACTIVE
                            </span>
                          </div>
                        ) : (
                          <span className="text-[8.5px] font-mono text-slate-600 uppercase tracking-wider">
                            READY
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Collapsed active diagnostic explanation tooltip area */}
              <AnimatePresence mode="wait">
                {selectedDetails && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="p-2.5 bg-slate-950/70 border border-slate-900 rounded-lg text-[10px] space-y-1 select-text text-left relative"
                  >
                    <div className="flex justify-between items-center text-slate-400 border-b border-slate-900 pb-1 mb-1 font-mono">
                      <span className="font-bold text-[#dfff2e] uppercase text-[9px]">
                        Diagnostic Panel
                      </span>
                      <span>
                        {agentsList.find(a => a.id === selectedDetails)?.metrics}
                      </span>
                    </div>
                    <p className="text-slate-350 leading-relaxed font-sans">
                      {agentsList.find(a => a.id === selectedDetails)?.desc}
                    </p>
                    <div className="text-[9px] text-indigo-400 flex items-center gap-1 mt-1 font-mono">
                      <Terminal size={9} />
                      <span>Sandbox slot allocated for current walkthrough checkout.</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
