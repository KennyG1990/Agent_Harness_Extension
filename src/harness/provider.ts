export interface ProviderCapabilities {
  structuredOutput: boolean;
  toolCalls: boolean;
  vision: boolean;
  contextLength: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  capabilities: ('structured_output' | 'tool_calls' | 'vision')[];
  contextLength: number;
  provider: string;
  promptPrice?: number;
  completionPrice?: number;
  created?: number;
  supportedParameters?: string[];
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

export interface ChatOptions {
  modelId: string;
  messages: { role: 'user' | 'system' | 'assistant'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }[];
  responseFormatSchema?: any;
  sessionId: string;
  fallbackModels?: string[];
}

export interface Provider {
  capabilities(modelId: string): ProviderCapabilities;
  listModels(): Promise<ModelDescriptor[]>;
  generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }>;
}

let runtimeOpenRouterApiKey = '';

export function setRuntimeOpenRouterApiKey(value: string): void {
  runtimeOpenRouterApiKey = String(value || '').trim();
}

function configValue<T>(key: string, fallback: T): T {
  try {
    // Keep provider usable from the extension host and from plain Node eval scripts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode') as typeof import('vscode');
    return vscode.workspace.getConfiguration('forge').get<T>(key, fallback);
  } catch {
    const envKey = `FORGE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
    return (process.env[envKey] as T | undefined) || fallback;
  }
}

function estimateCapabilities(modelId: string, contextLength = 128000): ProviderCapabilities {
  const mid = modelId.toLowerCase();
  const vision = /vision|gpt-4o|gemini|pixtral|claude/.test(mid);
  const toolCalls = /openrouter\/pareto-code|gpt-|claude-|gemini-|llama|mistral|qwen|deepseek|kimi/.test(mid);
  return { structuredOutput: true, toolCalls, vision, contextLength };
}

export class OpenRouterProvider implements Provider {
  private readonly capabilityCache = new Map<string, ProviderCapabilities>();
  public static codingModel(): string {
    return configValue('defaultCodingModel', 'openrouter/pareto-code');
  }

  public static mixedModel(): string {
    return configValue('defaultMixedModel', 'openrouter/auto');
  }

  public static architectModel(): string {
    return String(configValue('architectModel', '') || '').trim() || OpenRouterProvider.mixedModel();
  }

  private getApiKey(): string {
    return (runtimeOpenRouterApiKey || process.env.OPENROUTER_API_KEY || '').trim();
  }

  public capabilities(modelId: string): ProviderCapabilities {
    return this.capabilityCache.get(modelId) || estimateCapabilities(modelId, modelId.includes('auto') || modelId.includes('pareto') ? 200000 : 128000);
  }

  public async listModels(): Promise<ModelDescriptor[]> {
    const fallback = [
      this.toDescriptor(OpenRouterProvider.codingModel(), 'OpenRouter Pareto Code'),
      this.toDescriptor(OpenRouterProvider.mixedModel(), 'OpenRouter Auto'),
      this.toDescriptor('meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B')
    ];

    try {
      const apiKey = this.getApiKey();
      const authenticated = apiKey ? await this.fetchModelCatalog({ Authorization: `Bearer ${apiKey}` }) : [];
      const anonymous = await this.fetchModelCatalog({});
      const live = mergeModels([...authenticated, ...anonymous]);
      if (!live.length) {
        return fallback;
      }
      const result = [...fallback, ...live.filter((m: ModelDescriptor) => !fallback.some(f => f.id === m.id))];
      for (const model of result) this.capabilityCache.set(model.id, { structuredOutput: model.capabilities.includes('structured_output'), toolCalls: model.capabilities.includes('tool_calls'), vision: model.capabilities.includes('vision'), contextLength: model.contextLength });
      return result;
    } catch {
      return fallback;
    }
  }

  private async fetchModelCatalog(extraHeaders: Record<string, string>): Promise<ModelDescriptor[]> {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json', ...extraHeaders }
    });
    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    if (!Array.isArray(data?.data)) {
      return [];
    }

    return data.data.map((m: any) => this.toDescriptor(
      m.id || '',
      m.name || m.id || '',
      m.context_length || m.top_provider?.context_length || 128000,
      {
        promptPrice: m.pricing?.prompt === undefined ? undefined : Number(m.pricing.prompt),
        completionPrice: m.pricing?.completion === undefined ? undefined : Number(m.pricing.completion),
        created: Number(m.created || 0),
        supportedParameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : [],
        capabilities: [
          'structured_output',
          ...(Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools') ? ['tool_calls' as const] : estimateCapabilities(m.id || '').toolCalls ? ['tool_calls' as const] : []),
          ...(Array.isArray(m.architecture?.input_modalities) && m.architecture.input_modalities.includes('image') ? ['vision' as const] : [])
        ]
      }
    )).filter((m: ModelDescriptor) => Boolean(m.id));
  }

  public async generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('OpenRouter API key is missing. Add it through Forge onboarding or set OPENROUTER_API_KEY.');
    }

    const body: any = {
      model: options.modelId,
      messages: options.messages,
      session_id: options.sessionId,
      models: options.fallbackModels?.length ? options.fallbackModels : undefined
    };

    if (options.responseFormatSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'forge_agent_response',
          strict: true,
          schema: options.responseFormatSchema
        }
      };
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/KennyG1990/Forge-agent-harness',
        'X-Title': 'Forge Agent Extension'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`OpenRouter API call failed: ${res.status} ${res.statusText} - ${await res.text()}`);
    }

    const data: any = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalCost: Number(data.usage.cost || data.usage.total_cost || 0)
      } : undefined
    };
  }

  private toDescriptor(id: string, name: string, contextLength = 128000, extra: Partial<ModelDescriptor> = {}): ModelDescriptor {
    const cap = this.capabilities(id);
    return {
      id,
      name,
      provider: id.split('/')[0] || 'openrouter',
      contextLength,
      ...extra,
      capabilities: extra.capabilities || [
        'structured_output',
        ...(cap.toolCalls ? ['tool_calls' as const] : []),
        ...(cap.vision ? ['vision' as const] : [])
      ]
    };
  }
}

export class OpenAiCompatibleProvider implements Provider {
  public capabilities(modelId: string): ProviderCapabilities {
    return estimateCapabilities(modelId, 128000);
  }

  public async listModels(): Promise<ModelDescriptor[]> {
    return [this.toDescriptor('local/default', 'OpenAI-compatible default')];
  }

  public async generateChat(options: ChatOptions): Promise<{ text: string; usage?: ChatUsage }> {
    const baseUrl = configValue('openAiCompatibleBaseUrl', 'http://localhost:11434/v1').replace(/\/$/, '');
    const body: any = {
      model: options.modelId,
      messages: options.messages
    };
    if (options.responseFormatSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name: 'forge_agent_response', schema: options.responseFormatSchema } };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`OpenAI-compatible API call failed: ${res.status} ${res.statusText} - ${await res.text()}`);
    }
    const data: any = await res.json();
    return { text: data.choices?.[0]?.message?.content || '' };
  }

  private toDescriptor(id: string, name: string): ModelDescriptor {
    const cap = this.capabilities(id);
    return {
      id,
      name,
      provider: 'openai-compatible',
      contextLength: cap.contextLength,
      capabilities: ['structured_output', ...(cap.toolCalls ? ['tool_calls' as const] : [])]
    };
  }
}

export function createConfiguredProvider(): Provider {
  const providerDefault = configValue<string>('providerDefault', 'openrouter');
  return providerDefault === 'openai-compatible'
    ? new OpenAiCompatibleProvider()
    : new OpenRouterProvider();
}

export function mergeModels(models: ModelDescriptor[]): ModelDescriptor[] {
  const byId = new Map<string, ModelDescriptor>();
  for (const model of models) {
    const existing = byId.get(model.id);
    if (!existing) {
      byId.set(model.id, model);
      continue;
    }
    byId.set(model.id, {
      ...existing,
      ...model,
      promptPrice: model.promptPrice || existing.promptPrice,
      completionPrice: model.completionPrice || existing.completionPrice,
      supportedParameters: model.supportedParameters?.length ? model.supportedParameters : existing.supportedParameters
    });
  }
  return [...byId.values()];
}
