import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface EmbeddingProvider {
  readonly id: string;
  readonly modelId: string;
  embed(inputs: string[]): Promise<number[][]>;
}

export interface SemanticDocument {
  path: string;
  text: string;
}

export interface SemanticCandidate {
  path: string;
  similarity: number;
}

export interface SemanticRetrievalReport {
  generatedAt: string;
  status: 'ready' | 'disabled' | 'failed';
  provider: string;
  modelId: string;
  query: string;
  cacheHits: number;
  embeddedDocuments: number;
  candidates: SemanticCandidate[];
  error?: string;
}

interface EmbeddingCache {
  version: 1;
  modelId: string;
  entries: Record<string, number[]>;
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  public readonly id = 'openrouter';

  constructor(public readonly modelId: string, private readonly apiKey: string) {}

  public async embed(inputs: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OpenRouter API key is missing for semantic retrieval.');
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/KennyG1990/Forge-agent-harness',
        'X-Title': 'Forge Agent Extension'
      },
      body: JSON.stringify({ model: this.modelId, input: inputs, encoding_format: 'float' })
    });
    if (!response.ok) {
      throw new Error(`OpenRouter embeddings failed: ${response.status} ${response.statusText} - ${await response.text()}`);
    }
    const body: any = await response.json();
    const ordered = Array.isArray(body?.data) ? [...body.data].sort((a: any, b: any) => Number(a.index) - Number(b.index)) : [];
    const vectors = ordered.map((item: any) => Array.isArray(item.embedding) ? item.embedding.map(Number) : []);
    if (vectors.length !== inputs.length || vectors.some(vector => !vector.length || vector.some((value: number) => !Number.isFinite(value)))) {
      throw new Error(`OpenRouter embeddings returned ${vectors.length} valid vector(s) for ${inputs.length} input(s).`);
    }
    return vectors;
  }
}

export async function rankSemantically(
  root: string,
  query: string,
  documents: SemanticDocument[],
  provider: EmbeddingProvider,
  limit = 20
): Promise<SemanticRetrievalReport> {
  const cachePath = path.join(root, '.forge', 'embedding-cache.json');
  const cache = loadCache(cachePath, provider.modelId);
  const inputs = [{ path: '$query', text: query }, ...documents];
  const keys = inputs.map(item => cacheKey(provider.modelId, item.path, item.text));
  const missingIndexes = keys.map((key, index) => cache.entries[key] ? -1 : index).filter(index => index >= 0);
  let cacheHits = inputs.length - missingIndexes.length;
  for (let offset = 0; offset < missingIndexes.length; offset += 32) {
    const batchIndexes = missingIndexes.slice(offset, offset + 32);
    const vectors = await provider.embed(batchIndexes.map(index => inputs[index].text));
    batchIndexes.forEach((inputIndex, vectorIndex) => {
      cache.entries[keys[inputIndex]] = normalizeVector(vectors[vectorIndex]);
    });
  }
  saveCache(cachePath, cache);
  const queryVector = cache.entries[keys[0]];
  const candidates = documents.map((document, index) => ({
    path: document.path,
    similarity: cosineSimilarity(queryVector, cache.entries[keys[index + 1]])
  })).sort((a, b) => b.similarity - a.similarity || a.path.localeCompare(b.path)).slice(0, limit);
  return {
    generatedAt: new Date().toISOString(),
    status: 'ready',
    provider: provider.id,
    modelId: provider.modelId,
    query,
    cacheHits,
    embeddedDocuments: missingIndexes.filter(index => index > 0).length,
    candidates
  };
}

export function cosineSimilarity(a: number[] = [], b: number[] = []): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }
  return aNorm && bNorm ? dot / Math.sqrt(aNorm * bNorm) : 0;
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map(value => value / norm) : vector;
}

function cacheKey(modelId: string, documentPath: string, text: string): string {
  return crypto.createHash('sha256').update(`${modelId}\0${documentPath}\0${text}`).digest('hex');
}

function loadCache(cachePath: string, modelId: string): EmbeddingCache {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as EmbeddingCache;
    if (parsed.version === 1 && parsed.modelId === modelId && parsed.entries && typeof parsed.entries === 'object') return parsed;
  } catch {
    // Missing or incompatible cache starts empty.
  }
  return { version: 1, modelId, entries: {} };
}

function saveCache(cachePath: string, cache: EmbeddingCache): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
}

export function createConfiguredEmbeddingProvider(): EmbeddingProvider | undefined {
  if (!configValue<boolean>('semanticRetrievalEnabled', false)) return undefined;
  const apiKey = String(configValue('openRouterApiKey', '') || process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return undefined;
  const modelId = String(configValue('embeddingModel', 'openai/text-embedding-3-small') || '').trim();
  return new OpenRouterEmbeddingProvider(modelId, apiKey);
}

function configValue<T>(key: string, fallback: T): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode') as typeof import('vscode');
    return vscode.workspace.getConfiguration('forge').get<T>(key, fallback);
  } catch {
    return fallback;
  }
}
