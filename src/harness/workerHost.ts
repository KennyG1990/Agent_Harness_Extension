import { WorkspaceTools } from './tools';
import { ToolProposal } from './types';

interface WorkerRequest {
  id: string;
  workspaceRoot: string;
  role: string;
  proposal: ToolProposal;
}

let handled = false;
process.on('message', async (request: WorkerRequest) => {
  if (handled || !request?.id || !request.workspaceRoot || !request.proposal) return;
  handled = true;
  try {
    const result = await new WorkspaceTools(request.workspaceRoot).dispatch(request.proposal);
    process.send?.({ id: request.id, result });
  } catch (error: any) {
    process.send?.({ id: request.id, error: String(error?.message || error) });
  }
});

process.on('disconnect', () => process.exit(0));
