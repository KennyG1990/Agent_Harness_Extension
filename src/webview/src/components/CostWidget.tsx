import React from 'react';
import { DollarSign, Cpu, BarChart2, Zap } from 'lucide-react';

interface CostWidgetProps {
  spent: number;
  budget: number;
  tokenCount: number;
}

export const CostWidget: React.FC<CostWidgetProps> = ({
  spent,
  budget,
  tokenCount
}) => {
  const percentUsed = Math.min((spent / budget) * 100, 100);

  return (
    <div className="bg-slate-900 border-b border-slate-800 p-4 font-sans flex items-center justify-between gap-6 overflow-hidden shrink-0 select-none" id="cost-widget">
      {/* Spent display */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
          <DollarSign size={18} />
        </div>
        <div>
          <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">USD Session Spent</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-sm font-bold text-slate-100 font-mono">${spent.toFixed(4)}</span>
            <span className="text-[10px] text-slate-500 font-mono">/ ${budget.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar container */}
      <div className="flex-1 max-w-xs hidden sm:block">
        <div className="flex items-center justify-between text-[9px] uppercase font-mono tracking-wider text-slate-500 mb-1.5">
          <span>Active Budget Exhaustion</span>
          <span className={percentUsed > 80 ? 'text-rose-400 animate-pulse' : 'text-indigo-400'}>
            {percentUsed.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-slate-950 rounded overflow-hidden border border-slate-850">
          <div 
            className={`h-full rounded transition-all duration-500 ${
              percentUsed > 80 
                ? 'bg-rose-500' 
                : 'bg-indigo-500'
            }`}
            style={{ width: `${percentUsed}%` }}
          />
        </div>
      </div>

      {/* Token count */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
          <Cpu size={16} />
        </div>
        <div>
          <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Context Tokens</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-sm font-bold text-slate-100 font-mono">
              {tokenCount.toLocaleString()}
            </span>
            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 rounded uppercase font-mono">
              92% Limit
            </span>
          </div>
        </div>
      </div>

      {/* Speed index wrapper */}
      <div className="hidden md:flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 shrink-0">
          <Zap size={15} />
        </div>
        <div>
          <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">Inference Mode</span>
          <div className="text-sm font-bold text-slate-100 font-mono mt-0.5">
            <span className="text-pink-400 font-bold">Fast</span>
            <span className="text-[10px] text-slate-500 font-mono font-normal ml-1">Capped</span>
          </div>
        </div>
      </div>
    </div>
  );
};
