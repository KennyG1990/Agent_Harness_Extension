import React, { useState } from 'react';
import { ClipboardList, BookOpen, Edit2, Play, RefreshCw, Layers } from 'lucide-react';

interface PlanEditorPanelProps {
  planMd: string;
  scratchpadMd: string;
  onUpdatePlan: (newPlan: string) => void;
  onUpdateScratchpad: (newScratchpad: string) => void;
  status: string;
}

export const PlanEditorPanel: React.FC<PlanEditorPanelProps> = ({
  planMd,
  scratchpadMd,
  onUpdatePlan,
  onUpdateScratchpad,
  status
}) => {
  const [activeTab, setActiveTab] = useState<'plan' | 'scratchpad'>('plan');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editVal, setEditVal] = useState<string>('');

  const handleStartEdit = () => {
    setEditVal(activeTab === 'plan' ? planMd : scratchpadMd);
    setIsEditing(true);
  };

  const handleSave = () => {
    if (activeTab === 'plan') {
      onUpdatePlan(editVal);
    } else {
      onUpdateScratchpad(editVal);
    }
    setIsEditing(false);
  };

  const renderSimpleMarkdown = (md: string) => {
    if (!md) return <p className="text-slate-500 italic">No instructions initialized.</p>;
    
    // Quick simple parser for beautiful visual rendering without installing heavy marked libraries
    return md.split('\n').map((line, idx) => {
      if (line.startsWith('# ')) {
        return <h1 key={idx} className="text-lg font-bold text-slate-100 border-b border-slate-800 pb-2 mb-4 font-sans mt-2">{line.substring(2)}</h1>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={idx} className="text-sm font-bold text-indigo-400 mt-5 mb-2 font-sans tracking-wide uppercase">{line.substring(3)}</h2>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={idx} className="text-xs font-bold text-slate-200 mt-4 mb-2 font-sans uppercase">{line.substring(4)}</h3>;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = line.substring(2);
        // Look for checkbox matches like [ ] or [x]
        const isUnchecked = text.startsWith('[ ] ');
        const isChecked = text.toLowerCase().startsWith('[x] ');
        
        if (isUnchecked) {
          return (
            <div key={idx} className="flex items-start gap-2.5 my-2.5 text-xs text-slate-300">
              <span className="h-4 w-4 rounded border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0 mt-0.5"></span>
              <span className="leading-relaxed">{text.substring(4)}</span>
            </div>
          );
        }
        if (isChecked) {
          return (
            <div key={idx} className="flex items-start gap-2.5 my-2.5 text-xs text-slate-400 line-through select-none">
              <span className="h-4 w-4 rounded border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              </span>
              <span className="leading-relaxed">{text.substring(4)}</span>
            </div>
          );
        }

        return (
          <li key={idx} className="list-disc pl-1 ml-4 my-1.5 leading-relaxed text-xs text-slate-300">
            {text}
          </li>
        );
      }
      if (line.trim().startsWith('1. ') || line.trim().match(/^\d+\. /)) {
        const cleanLine = line.trim();
        const startIdx = cleanLine.indexOf('.') + 1;
        const text = cleanLine.substring(startIdx).trim();
        const isUnchecked = text.startsWith('[ ] ');
        const isChecked = text.toLowerCase().startsWith('[x] ');

        return (
          <div key={idx} className="flex items-start gap-2 ml-1 my-2.5 text-xs">
            {isUnchecked ? (
              <>
                <span className="h-4 w-4 rounded border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0 mt-0.5 font-bold font-mono text-[9px] text-slate-500"></span>
                <span className="leading-relaxed text-slate-300">{text.substring(4)}</span>
              </>
            ) : isChecked ? (
              <>
                <span className="h-4 w-4 rounded border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5 font-bold font-mono text-[9px] text-emerald-400">✓</span>
                <span className="leading-relaxed text-slate-500 line-through">{text.substring(4)}</span>
              </>
            ) : (
              <>
                <span className="font-mono text-[10px] text-slate-500 shrink-0 mt-0.5">{cleanLine.split('.')[0]}.</span>
                <span className="leading-relaxed text-slate-300">{text}</span>
              </>
            )}
          </div>
        );
      }
      if (!line.trim()) return <div key={idx} className="h-2"></div>;
      return <p key={idx} className="text-xs text-slate-300 leading-relaxed my-2 font-sans">{line}</p>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-300 font-sans" id="plan-editor-panel">
      {/* Tab Select Header */}
      <div className="p-3 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5 p-0.5 rounded bg-slate-900 border border-slate-800/85">
          <button
            onClick={() => { setActiveTab('plan'); setIsEditing(false); }}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded transition-all cursor-pointer ${
              activeTab === 'plan' 
                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ClipboardList size={12} />
            <span>PLAN.md</span>
          </button>
          
          <button
            onClick={() => { setActiveTab('scratchpad'); setIsEditing(false); }}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded transition-all cursor-pointer ${
              activeTab === 'scratchpad' 
                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={12} />
            <span>SCRATCHPAD.md</span>
          </button>
        </div>

        {/* Action controls */}
        <div>
          {!isEditing ? (
            <button
              onClick={handleStartEdit}
              disabled={status === 'running'}
              className="flex items-center gap-1 bg-slate-850 hover:bg-slate-800 border border-slate-750 font-bold text-[11px] px-2.5 py-1 text-slate-300 hover:text-white rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Edit2 size={11} />
              <span>Override State</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsEditing(false)}
                className="text-[11px] px-2.5 py-1 hover:bg-slate-800/40 rounded border border-transparent transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] px-3 py-1 rounded transition-all shadow shadow-indigo-600/10 cursor-pointer"
              >
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Panel Content Box */}
      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin bg-slate-950/15">
        {isEditing ? (
          <div className="h-full flex flex-col">
            <textarea
              className="w-full flex-1 bg-slate-950/80 border border-slate-800/80 rounded p-4 font-mono text-xs text-slate-300 leading-relaxed focus:outline-none focus:border-indigo-500/40 resize-none outline-none focus:ring-1 focus:ring-indigo-500/20"
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
            />
            <p className="text-[10px] text-slate-500 mt-2 font-mono flex items-center gap-1 select-none">
              <BookOpen size={10} />
              Direct state mutation authorized by the user. Editing will update sandbox live state.
            </p>
          </div>
        ) : (
          <div className="prose prose-invert max-w-none prose-sm leading-relaxed">
            {activeTab === 'plan' ? renderSimpleMarkdown(planMd) : renderSimpleMarkdown(scratchpadMd)}
          </div>
        )}
      </div>
    </div>
  );
};
