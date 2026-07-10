import React from 'react';
import { Network, CheckCircle, Play, Circle, XCircle, ArrowRight, ShieldCheck, ShieldAlert } from 'lucide-react';
import { TaskGraph, TaskItem } from '../types';

interface TaskGraphWidgetProps {
  taskGraph: TaskGraph;
  activeTaskId?: string;
}

export const TaskGraphWidget: React.FC<TaskGraphWidgetProps> = ({
  taskGraph,
  activeTaskId
}) => {
  const getStatusIcon = (status: TaskItem['status'], isActive: boolean) => {
    if (isActive) {
      return <Play size={13} className="text-blue-400 animate-pulse fill-blue-400/20" />;
    }
    switch (status) {
      case 'completed':
        return <CheckCircle size={13} className="text-emerald-400 fill-emerald-500/10" />;
      case 'failed':
        return <XCircle size={13} className="text-rose-400 fill-rose-500/10" />;
      case 'running':
        return <Play size={13} className="text-blue-400 animate-spin" />;
      default:
        return <Circle size={13} className="text-slate-600" />;
    }
  };

  const getStatusRowBg = (status: TaskItem['status'], isActive: boolean) => {
    if (isActive) return 'bg-blue-500/5 border-blue-500/20 text-blue-200';
    switch (status) {
      case 'completed': return 'bg-slate-900/40 border-slate-800/40 text-slate-400';
      case 'failed': return 'bg-rose-500/5 border-rose-500/10 text-rose-300';
      case 'running': return 'bg-blue-500/10 border-blue-500/20 text-blue-300';
      default: return 'bg-slate-900/20 border-slate-900 text-slate-500';
    }
  };

  const getOwnerColor = (owner: string) => {
    switch (owner) {
      case 'Architect': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'Editor': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'Reviewer': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'Explorer': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      default: return 'bg-slate-800 text-slate-400 border-slate-700/60';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 select-none font-sans" id="task-graph-widget">
      {/* Widget Header */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
          <Network size={14} className="text-pink-400" />
          <span>Active Task Graph</span>
        </h4>
        <span className="text-[10px] bg-pink-500/10 text-pink-400 border border-pink-500/20 rounded px-1.5 py-0.5 uppercase font-mono">
          State-Tracked
        </span>
      </div>

      {/* Task List Grid */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {taskGraph.tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 p-4 text-center">
            <Network size={20} className="opacity-30" />
            <p className="text-xs leading-relaxed">No tasks plotted. Initialize a goal template to compile a state task list.</p>
          </div>
        ) : (
          taskGraph.tasks.map((task) => {
            const isActive = activeTaskId === task.id;
            return (
              <div
                key={task.id}
                className={`flex flex-col p-3 rounded border transition-all ${getStatusRowBg(task.status, isActive)} ${
                  isActive ? 'border-indigo-500/50' : ''
                }`}
              >
                {/* Task Title Row */}
                <div className="flex items-center gap-2.5 justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0">{getStatusIcon(task.status, isActive)}</span>
                    <span className="font-medium text-xs truncate leading-snug">{task.title}</span>
                  </div>
                  <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border shrink-0 font-mono tracking-wider ${getOwnerColor(task.owner)}`}>
                    {task.owner}
                  </span>
                </div>

                {/* Sub-info layout */}
                {(task.dependencies.length > 0 || task.blockers.length > 0 || task.status === 'completed') && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px]">
                    {/* Dependencies */}
                    {task.dependencies.length > 0 ? (
                      <div className="text-slate-500 flex items-center gap-1">
                        <span>Requires:</span>
                        <div className="flex items-center gap-1 font-mono">
                          {task.dependencies.map(depId => (
                            <span key={depId} className="bg-slate-950 px-1 py-0.2 rounded border border-slate-800 text-slate-400">
                              #{depId}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-600 font-mono">#ID {task.id} - Root Node</span>
                    )}

                    {/* Step Validation Node status */}
                    {task.status === 'completed' && (
                      <span className="text-emerald-400 flex items-center gap-1 font-medium text-[9px] font-mono">
                        <ShieldCheck size={11} />
                        VERIFIED
                      </span>
                    )}

                    {task.status === 'failed' && (
                      <span className="text-rose-400 flex items-center gap-1 font-medium text-[9px] font-mono">
                        <ShieldAlert size={11} />
                        RE-ROUTING
                      </span>
                    )}

                    {task.status === 'running' && (
                      <span className="text-blue-400 animate-pulse flex items-center gap-1 text-[9px]">
                        RESOLVING...
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Task Flow Graph visual connector hint */}
      {taskGraph.tasks.length > 0 && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/20 text-[11px] text-slate-500 flex items-center gap-1.5 shrink-0 justify-center">
          <span>Handoff Pipeline:</span>
          <span className="text-slate-400 font-medium">Explore</span>
          <ArrowRight size={10} className="text-slate-600" />
          <span className="text-slate-400 font-medium">Plan</span>
          <ArrowRight size={10} className="text-slate-600" />
          <span className="text-slate-400 font-medium">Edit</span>
          <ArrowRight size={10} className="text-slate-600" />
          <span className="text-slate-400 font-medium">Verify</span>
        </div>
      )}
    </div>
  );
};
