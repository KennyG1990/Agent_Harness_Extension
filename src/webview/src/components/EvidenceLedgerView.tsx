import React from 'react';
import { Shield, Sparkles, CheckCircle2, XCircle, FileText, Compass, BarChart } from 'lucide-react';
import { EvidenceLedgerItem } from '../types';

interface EvidenceLedgerViewProps {
  ledger: EvidenceLedgerItem[];
}

export const EvidenceLedgerView: React.FC<EvidenceLedgerViewProps> = ({ ledger }) => {
  const parseDiffLines = (diff?: string) => {
    if (!diff) return null;
    return diff.split('\n').map((line, idx) => {
      let bgClass = 'text-slate-400 bg-slate-950/20';
      if (line.startsWith('+')) {
        bgClass = 'text-emerald-300 bg-emerald-500/10 font-bold border-l-2 border-emerald-500';
      } else if (line.startsWith('-')) {
        bgClass = 'text-rose-300 bg-rose-500/10 line-through border-l-2 border-rose-500';
      } else if (line.startsWith('@@')) {
        bgClass = 'text-indigo-400 bg-indigo-500/5 font-bold font-mono py-1 border-y border-indigo-900/40';
      }
      return (
        <div key={idx} className={`px-3 py-0.5 leading-relaxed font-mono text-[11px] select-all ${bgClass}`}>
          {line}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 font-sans text-slate-300" id="evidence-ledger-view">
      {/* View Header */}
      <div className="p-4 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Shield size={15} className="text-indigo-400" />
            <span>Evidence Ledger</span>
          </h3>
          <p className="text-[10px] text-slate-500 mt-1">Durable cryptographic/testproof checkpoints justifying overall goal completion.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 px-2 py-0.5 rounded uppercase font-mono">
            Auditable Chain
          </span>
        </div>
      </div>

      {/* Ledger Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {ledger.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center h-full text-slate-600 gap-2">
            <Compass size={24} className="opacity-40 animate-pulse" />
            <p className="text-xs max-w-xs leading-relaxed">Evidence Ledger is empty. When the agent completes goals and verifies code, cryptographic audit evidence blocks appear here.</p>
          </div>
        ) : (
          ledger.map((item) => (
            <div key={item.id} className="rounded border border-slate-800 bg-slate-950/40 overflow-hidden flex flex-col hover:border-slate-800/80 transition-colors">
              {/* Header Box */}
              <div className="p-3 bg-slate-900 border-b border-slate-850 flex items-start sm:items-center justify-between flex-col sm:flex-row gap-2">
                <div className="flex items-center gap-2">
                  {item.testResult?.pass ? (
                    <CheckCircle2 size={16} className="text-emerald-400 fill-emerald-500/10" />
                  ) : (
                    <XCircle size={16} className="text-rose-400 fill-rose-500/10" />
                  )}
                  <div>
                    <h4 className="text-xs font-bold text-slate-200">
                      Checkpoint #{item.id}: {item.stepTitle}
                    </h4>
                    <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">{item.timestamp}</span>
                  </div>
                </div>

                {/* Score badge / Proof */}
                <div className="flex items-center gap-2 mt-1 sm:mt-0 font-mono text-[10px] self-end sm:self-auto">
                  <span className="bg-slate-950 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                    Confidence: {item.confidence}%
                  </span>
                  <span className={`px-2 py-0.5 rounded uppercase font-bold text-[9px] min-w-16 text-center border ${
                    item.testResult?.pass 
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
                      : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  }`}>
                    {item.testResult?.pass ? 'PASSED PROOF' : 'FAILED ORACLE'}
                  </span>
                </div>
              </div>

              {/* Observation Content description */}
              <div className="p-3 text-xs leading-relaxed text-slate-300 border-b border-slate-850">
                <div className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider mb-1 font-sans">
                  Harness Assessment:
                </div>
                {item.observation}
              </div>

              {/* Git Diff Display */}
              {item.diff && (
                <div className="border-b border-slate-850 bg-slate-950 flex flex-col">
                  <div className="p-2 border-b border-slate-900 bg-slate-900/40 text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5 font-sans">
                    <FileText size={11} className="text-slate-400" />
                    Context-Anchored Git Patch Block (apply_patch format)
                  </div>
                  <div className="overflow-x-auto p-1.5 scrollbar-thin select-all">
                    {parseDiffLines(item.diff)}
                  </div>
                </div>
              )}

              {/* Verification Details */}
              {item.testResult && (
                <div className="bg-slate-900/20 p-3">
                  <div className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5 font-sans">
                    <BarChart size={11} className="text-slate-400" />
                    Oracle Verification Logs
                  </div>
                  <pre className="text-[10px] font-mono text-slate-400 leading-relaxed bg-slate-950 p-2.5 rounded border border-slate-900 overflow-x-auto max-h-48 scrollbar-thin select-all">
                    {item.testResult.details || item.testResult.summary}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
