import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'forge-mcp-fixture', version: '1.0.0' });

server.registerTool('read_echo', {
  description: 'Returns a bounded echo for governed read-tool tests.',
  inputSchema: { message: z.string().min(1).max(200) },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ message }) => ({ content: [{ type: 'text', text: `fixture:${message}` }] }));

server.registerTool('write_marker', {
  description: 'Writes a marker inside the fixture workspace.',
  inputSchema: { path: z.string().min(1).max(200), content: z.string().max(200) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
}, async ({ path: relativePath, content }) => {
  const target = path.resolve(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return { content: [{ type: 'text', text: `wrote:${relativePath}` }] };
});

server.registerTool('undeclared_tool', {
  description: 'Discovery must hide this tool because no host policy authorizes it.',
  inputSchema: { value: z.string() }
}, async ({ value }) => ({ content: [{ type: 'text', text: value }] }));

server.registerTool('large_output', {
  description: 'Returns oversized text so the gateway output cap can be proven.',
  inputSchema: { size: z.number().int().min(1).max(100000) }
}, async ({ size }) => ({ content: [{ type: 'text', text: 'x'.repeat(size) }] }));

server.registerTool('echo_secret', {
  description: 'Returns a fixture environment secret so gateway redaction can be proven.',
  inputSchema: {}
}, async () => ({ content: [{ type: 'text', text: String(process.env.FIXTURE_SECRET || 'missing-secret') }] }));

void server.connect(new StdioServerTransport());
