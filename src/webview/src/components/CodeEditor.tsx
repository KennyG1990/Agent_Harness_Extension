import React, { useEffect, useState } from 'react';
import { Eye, Edit2, Play, Layout, Save, CheckCircle2 } from 'lucide-react';

interface CodeEditorProps {
  filePath: string;
  fileContent: string;
  language: string;
  onContentChange: (path: string, newContent: string) => void;
  isAgentRunning: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  filePath,
  fileContent,
  language,
  onContentChange,
  isAgentRunning
}) => {
  const [localContent, setLocalContent] = useState<string>(fileContent);
  const [editMode, setEditMode] = useState<boolean>(false);

  useEffect(() => {
    setLocalContent(fileContent);
  }, [fileContent, filePath]);

  const handleSave = () => {
    onContentChange(filePath, localContent);
    setEditMode(false);
  };

  const getLineStyles = (line: string) => {
    if (line.includes("+") && (line.includes("b ===") || line.includes("return null") || line.includes("reverseStr") || line.includes("backdrop-blur"))) {
      return 'bg-emerald-500/10 text-emerald-300 font-bold border-l-2 border-emerald-500';
    }
    if (line.includes("-") && (line.includes("+ b") || line.includes("divider") || line.includes("TODO:"))) {
      return 'bg-rose-500/10 text-rose-300 line-through border-l-2 border-rose-500';
    }
    return '';
  };

  const lines = localContent ? localContent.split('\n') : ['// No active file selected. Choose a file from the explorer.'];

  return (
    <div className="flex flex-col h-full bg-slate-950 font-mono text-xs border-r border-slate-900 select-text" id="code-editor">
      {/* Editor Tab bar */}
      <div className="p-3 bg-slate-900 border-b border-slate-950 flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {/* Active File Tab tab */}
          <div className="bg-slate-950/90 text-blue-400 border border-slate-800/80 px-4 py-1.5 text-xs rounded-t flex items-center gap-1.5 font-bold shadow-sm font-sans select-none shrink-0 border-b-2 border-b-blue-500">
            <span className="text-slate-500 text-[10px]">&lt;/&gt;</span>
            <span className="truncate">{filePath || 'scratchpad'}</span>
          </div>
        </div>

        {/* Action controllers */}
        <div className="flex items-center gap-2 select-none">
          {!editMode ? (
            <button
              onClick={() => { setLocalContent(fileContent); setEditMode(true); }}
              disabled={isAgentRunning || !filePath}
              className="flex items-center gap-1 bg-slate-850 hover:bg-slate-800 border border-slate-750 font-bold text-[11px] px-2.5 py-1 text-slate-300 hover:text-white rounded transition-all disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
            >
              <Edit2 size={11} />
              <span>Modify File</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setLocalContent(fileContent); setEditMode(false); }}
                className="text-[11px] px-2 py-1 text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] px-3 py-1 rounded transition-all shadow shadow-blue-600/10 cursor-pointer"
              >
                <Save size={11} />
                <span>Save</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Editor Body Area code panel */}
      <div className="flex-1 overflow-y-auto p-4 flex font-mono leading-relaxed relative scrollbar-thin bg-slate-950/50">
        {editMode ? (
          <textarea
            className="w-full h-full bg-slate-950/80 text-blue-300 font-mono text-xs focus:outline-none p-2 border border-slate-900 rounded outline-none leading-relaxed resize-none overflow-y-auto scrollbar-thin select-all"
            value={localContent}
            onChange={(e) => setLocalContent(e.target.value)}
          />
        ) : (
          <>
            {/* Gutter Line Numbers */}
            <div className="w-10 pr-3 border-r border-slate-900 text-slate-600 text-right select-none select-none-all">
              {lines.map((_, idx) => (
                <div key={idx} className="leading-relaxed hover:text-slate-400 font-mono text-[10px] h-5 mb-0.5">
                  {idx + 1}
                </div>
              ))}
            </div>

            {/* Code lines list render */}
            <div className="flex-1 pl-4 overflow-x-auto scrollbar-thin">
              {lines.map((line, idx) => (
                <div 
                  key={idx} 
                  className={`leading-relaxed h-5 mb-0.5 select-text hover:bg-slate-900/30 pl-1 rounded whitespace-pre transition-colors duration-100 ${getLineStyles(line)}`}
                >
                  {line || ' '}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Lock indicator during loop running */}
        {isAgentRunning && (
          <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-[0.5px] flex items-center justify-center pointer-events-none select-none select-none-all">
            <span className="bg-slate-900/90 border border-slate-800 text-[10px] uppercase font-mono tracking-wider px-3 py-1 text-slate-400 flex items-center gap-1.5 shadow-xl rounded-full">
              <span className="h-1.5 w-1.5 bg-blue-500 rounded-full animate-ping"></span>
              Forge Agent actively writing edits (Gutter Locked)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
