export interface ModelBehaviorPromptProfile {
  family: 'claude-fable-5' | 'claude-mythos-5';
  selectedModelId: string;
  prompt: string;
}

export function modelBehaviorPromptProfile(modelId: string): ModelBehaviorPromptProfile | undefined {
  const selectedModelId = String(modelId || '').trim();
  const normalized = selectedModelId.toLowerCase();
  const family = normalized.includes('claude-fable-5')
    ? 'claude-fable-5'
    : normalized.includes('claude-mythos-5')
      ? 'claude-mythos-5'
      : undefined;
  if (!family) return undefined;
  return {
    family,
    selectedModelId,
    prompt: [
      `Host-selected ${family} behavior profile for exact model ${selectedModelId}:`,
      '- When workspace evidence is sufficient, act through the next allowed structured tool instead of re-deriving settled facts or listing unused options.',
      '- Stay inside the requested task. Do not add cleanup, features, abstractions, compatibility layers, or defensive work that the acceptance contract does not require.',
      '- Ground every progress or completion claim in a tool result from this run. State red, skipped, or unverified work honestly.',
      '- Use ask_user only for a genuine user-owned ambiguity, destructive or irreversible action, or real scope change. Continue reversible authorized work without asking again.',
      '- Never reproduce, transcribe, or explain hidden reasoning. Return only the structured proposal required by the Forge tool contract.'
    ].join('\n')
  };
}
