import React, { useEffect, useRef } from 'react';
import { Terminal, Shield, RefreshCw, AlertTriangle, CheckCircle, Database } from 'lucide-react';
import { StepLog, FirewallAction } from '../types';

interface GoalLoopTerminalProps {
  logs: StepLog[];
  firewall: FirewallAction;
  status: 'idle' | 'running' | 'paused' | 'success' | 'failed';
  activeSubAgent: string;
}

export const GoalLoopTerminal: React.FC<GoalLoopTerminalProps> = ({
  logs,
  firewall,
  status,
  activeSubAgent
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColorClass = (type: StepLog['type']) => {
    switch (type) {
      case 'success': return 'text-emerald-400';
      case 'error': return 'text-rose-400 font-semibold';
      case 'warning': return 'text-amber-400';
      case 'proposal': return 'text-cyan-400 font-mono';
      case 'validation': return 'text-indigo-400 font-medium';
      case 'commit': return 'text-fuchsia-400 font-mono';
      case 'narration': return 'text-slate-300 italic';
      case 'oracle': return 'text-teal-400 font-mono';
      default: return 'text-slate-400';
    }
  };

  const getStageColor = (stage: FirewallAction['stage']) => {
    switch (stage) {
      case 'PROPOSE': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'VALIDATE': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
      case 'COMMIT': return 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30';
      case 'NARRATE': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      default: return 'bg-slate-800 text-slate-500 border-slate-700/50';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 font-mono text-xs border-r border-slate-900 shadow-inner" id="goal-loop-terminal">
      {/* Firewall & Agent Loop Panel Header */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-900 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div>
          <h3 className="text-slate-200 font-bold flex items-center gap-2">
            <Terminal size={14} className="text-indigo-400" />
            <span>Agent Harness Console</span>
            {status === 'running' && (
              <span className="flex items-center gap-1 bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded text-[10px] uppercase font-mono animate-pulse border border-indigo-500/20">
                <RefreshCw size={10} className="animate-spin" />
                Live Loop
              </span>
            )}
          </h3>
          <p className="text-[10px] text-slate-500 mt-1">Autonomous State Machine Engine (PROPOSE → VALIDATE → COMMIT → NARRATE)</p>
        </div>

        {/* Current Firewall Stage Badges */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] px-1.5 py-0.5 text-slate-500 uppercase flex items-center gap-1">
            <Shield size={11} className="text-slate-500" />
            Firewall Stage:
          </span>
          <div className="flex gap-1">
            {(['PROPOSE', 'VALIDATE', 'COMMIT', 'NARRATE'] as const).map((stg) => {
              const isActive = firewall.stage === stg;
              return (
                <span
                  key={stg}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-all ${
                    isActive 
                      ? getStageColor(stg) + " border-indigo-500/60"
                      : "bg-slate-900 text-slate-600 border-slate-950 opacity-40"
                  }`}
                >
                  {stg}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Embedded Firewall Details Panel (Dynamic) */}
      {firewall.stage !== 'IDLE' && (
        <div className="mx-4 mt-4 p-3 rounded bg-slate-900/40 border border-slate-800/80 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-indigo-400 flex items-center gap-1 font-sans">
              <Database size={11} />
              Current State Mutation Node ({firewall.stage})
            </span>
            <span className="text-[10px] text-slate-500">{firewall.timestamp}</span>
          </div>
          <p className="text-slate-300 font-mono text-xs leading-relaxed mt-1">
            {firewall.details}
          </p>

          {firewall.proposalToolCall && (
            <div className="mt-2 bg-slate-950 p-2 rounded border border-slate-900 font-mono text-[11px]">
              <span className="text-cyan-400 font-bold">Proposed Tool: </span>
              <span className="text-purple-400">{firewall.proposalToolCall.name}</span>
              <pre className="text-slate-400 mt-1 scrollbar-thin overflow-x-auto select-all text-[10px]">
                {JSON.stringify(firewall.proposalToolCall.arguments, null, 2)}
              </pre>
            </div>
          )}

          {firewall.isValidated !== undefined && (
            <div className={`mt-2 p-1.5 rounded flex items-center gap-1.5 text-[11px] font-sans ${
              firewall.isValidated 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/15'
            }`}>
              {firewall.isValidated ? (
                <>
                  <CheckCircle size={13} className="text-emerald-400 shrink-0" />
                  <span><strong>Firewall VALIDATION Approved:</strong> Deterministic constraints satisfied. Committing change...</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={13} className="text-rose-400 shrink-0" />
                  <span><strong>Firewall VALIDATION Refused:</strong> {firewall.validationReason || "Attempted modification failed constraints."}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Terminal Output */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2.5 scrollbar-thin select-text"
        style={{ contentVisibility: 'auto' }}
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 font-sans">
            <Terminal size={24} className="opacity-40 animate-pulse" />
            <p className="text-xs">Console is quiet. Initialize goal or select template to boot up the Harness.</p>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 items-start leading-relaxed animate-fade-in">
              <span className="text-[10px] text-slate-600 font-mono select-none w-14 shrink-0">
                {log.timestamp}
              </span>
              
              {log.subAgent && (
                <span className="bg-slate-800 text-slate-400 text-[10px] px-1 py-0.2 rounded border border-slate-700/40 select-none shrink-0 font-sans">
                  {log.subAgent}
                </span>
              )}

              <span className={`flex-1 break-words leading-relaxed ${getLogColorClass(log.type)}`}>
                {log.message.startsWith('```') ? (
                  <pre className="my-1.5 p-2 bg-slate-900/60 rounded border border-slate-900/80 overflow-x-auto text-[11px] font-mono select-all text-slate-300">
                    {log.message.replace(/```/g, '')}
                  </pre>
                ) : log.message.includes('\n') ? (
                  <pre className="whitespace-pre-wrap font-mono inline text-[11px]">
                    {log.message}
                  </pre>
                ) : (
                  log.message
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
