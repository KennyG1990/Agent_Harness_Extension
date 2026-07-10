import React from 'react';
import { FileCode, Folder, FolderOpen, AlertCircle } from 'lucide-react';
import { WorkspaceFile } from '../types';

interface WorkspaceExplorerProps {
  files: Record<string, WorkspaceFile>;
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  oracleStatuses: {
    linter: 'pass' | 'fail' | 'unchecked';
    compiler: 'pass' | 'fail' | 'unchecked';
    tests: 'pass' | 'fail' | 'unchecked';
  };
}

export const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = ({
  files,
  activeFilePath,
  onSelectFile,
  oracleStatuses
}) => {
  // Simple directory structure deduction from file paths
  const filePaths = Object.keys(files);
  const folders: Record<string, string[]> = {};
  const rootFiles: string[] = [];

  filePaths.forEach(fp => {
    if (fp.includes('/')) {
      const parts = fp.split('/');
      const folderName = parts[0];
      if (!folders[folderName]) folders[folderName] = [];
      folders[folderName].push(fp);
    } else {
      rootFiles.push(fp);
    }
  });

  const renderStatusBadge = (type: string, status: 'pass' | 'fail' | 'unchecked') => {
    const colors = {
      pass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      fail: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      unchecked: 'bg-slate-700/30 text-slate-400 border-slate-700/50'
    };

    return (
      <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ${colors[status]}`}>
        {type}: {status}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-300 select-none font-sans" id="workspace-explorer">
      {/* Workspace Header */}
      <div className="p-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Sandbox Code Workspace</span>
        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
      </div>

      {/* Oracle Signals Panel */}
      <div className="p-3 border-b border-slate-800 bg-slate-950/20 flex flex-col gap-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
          <AlertCircle size={12} className="text-slate-400" />
          Deterministic Verification Oracles
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {renderStatusBadge('lint', oracleStatuses.linter)}
          {renderStatusBadge('tsc', oracleStatuses.compiler)}
          {renderStatusBadge('test', oracleStatuses.tests)}
        </div>
      </div>

      {/* Explorer Tree */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        <div className="flex items-center gap-2 px-1 py-1.5 text-xs text-slate-400 font-medium">
          <FolderOpen size={14} className="text-blue-400" />
          <span>PROJECT_WORKTREE (In-Scope Sandbox)</span>
        </div>

        <div className="pl-3 mt-1 space-y-2">
          {/* Folders */}
          {Object.entries(folders).map(([folderName, paths]) => (
            <div key={folderName} className="space-y-0.5">
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 rounded transition-colors cursor-pointer">
                <Folder size={13} className="text-amber-400/80" />
                <span className="font-medium">{folderName}</span>
              </div>
              <div className="pl-3 border-l border-slate-800 space-y-0.5 ml-3">
                {paths.map(fp => {
                  const isActive = activeFilePath === fp;
                  const displayFn = fp.split('/').slice(1).join('/');
                  return (
                    <button
                      key={fp}
                      onClick={() => onSelectFile(fp)}
                      className={`flex items-center gap-1.5 w-full text-left px-2 py-1 text-xs rounded transition-all cursor-pointer ${
                        isActive
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium'
                          : 'hover:bg-slate-800/30 text-slate-400 hover:text-slate-300 border border-transparent'
                      }`}
                    >
                      <FileCode size={13} className={isActive ? 'text-blue-400' : 'text-slate-500'} />
                      <span className="font-mono truncate">{displayFn}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Root Files */}
          {rootFiles.map(fp => {
            const isActive = activeFilePath === fp;
            return (
              <button
                key={fp}
                onClick={() => onSelectFile(fp)}
                className={`flex items-center gap-1.5 w-full text-left px-2 py-1 text-xs rounded transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium'
                    : 'hover:bg-slate-800/30 text-slate-400 hover:text-slate-300 border border-transparent'
                }`}
              >
                <FileCode size={13} className={isActive ? 'text-blue-400' : 'text-slate-500'} />
                <span className="font-mono truncate">{fp}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
