import type {
  LLMProvider,
  ProviderConfig,
  ProviderFactory,
} from '../types/providers.js';

// ─── Provider Registry ──────────────────────────────────────────
// Dynamic registry for LLM providers. Supports runtime switching
// and future smart routing. New providers are added by calling
// register() at startup.

export class ProviderRegistry {
  private factories = new Map<string, ProviderFactory>();
  private instances = new Map<string, LLMProvider>();

  /**
   * Register a provider factory under a name.
   * Called once at startup for each supported provider.
   */
  register(name: string, factory: ProviderFactory): void {
    this.factories.set(name.toLowerCase(), factory);
  }

  /**
   * Create (or retrieve cached) a provider instance.
   * Instances are cached by "name:model" key so switching
   * models within the same provider creates a new instance.
   */
  create(name: string, config: ProviderConfig): LLMProvider {
    const key = `${name.toLowerCase()}:${config.model}`;

    const cached = this.instances.get(key);
    if (cached) return cached;

    const factory = this.factories.get(name.toLowerCase());
    if (!factory) {
      const available = this.listProviders().join(', ');
      throw new Error(
        `Unknown provider "${name}". Available providers: ${available}`,
      );
    }

    const instance = factory(config);
    this.instances.set(key, instance);
    return instance;
  }

  /**
   * List all registered provider names.
   */
  listProviders(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Check if a provider is registered.
   */
  has(name: string): boolean {
    return this.factories.has(name.toLowerCase());
  }
}

// ─── Default Provider Models ────────────────────────────────────
// Used when the user specifies a provider but not a model.

export const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
};

// ─── Singleton Registry Setup ───────────────────────────────────
// Lazily imports each provider to avoid loading unused ones.

let _registry: ProviderRegistry | null = null;

export async function getProviderRegistry(): Promise<ProviderRegistry> {
  if (_registry) return _registry;

  _registry = new ProviderRegistry();

  // Lazily import providers — only the factory is registered,
  // actual instantiation happens when create() is called.
  const { GeminiProvider } = await import('./gemini.js');
  const { AnthropicProvider } = await import('./anthropic.js');
  const { OpenAIProvider } = await import('./openai.js');

  _registry.register('gemini', (config) => new GeminiProvider(config));
  _registry.register('anthropic', (config) => new AnthropicProvider(config));
  _registry.register('openai', (config) => new OpenAIProvider(config));

  return _registry;
}

/**
 * Resolve the API key for a given provider from environment variables.
 * Returns undefined if not set.
 */
export function resolveApiKey(provider: string): string | undefined {
  const envMap: Record<string, string> = {
    gemini: 'GEMINI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };

  const envVar = envMap[provider.toLowerCase()];
  return envVar ? process.env[envVar] : undefined;
}
