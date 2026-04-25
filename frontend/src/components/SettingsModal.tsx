// frontend/src/components/SettingsModal.tsx
import { useState, useEffect, useMemo } from 'react';
import { X, Search, Trash2, Plus } from 'lucide-react';
import { invoke } from '../lib/ipc';

type ProviderKind = 'openai-compatible' | 'anthropic' | 'minimax';

interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  kind: ProviderKind;
  enabled: boolean;
  configured: boolean;
  isCustom: boolean;
  isPrimary: boolean;
  models: string[];
  selectedModel: string | null;
}

interface CustomDraft {
  id: string;
  name: string;
  baseUrl: string;
  kind: ProviderKind;
  models: string;
}

const EMPTY_DRAFT: CustomDraft = {
  id: '',
  name: '',
  baseUrl: '',
  kind: 'openai-compatible',
  models: '',
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: Props) {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState<{ providerId: string; value: string } | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) loadConfig();
  }, [isOpen]);

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const config = await invoke<ModelProvider[]>('settings.modelConfig:get');
      setProviders(config);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string) {
    const updated = providers.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p);
    setProviders(updated);
    const p = updated.find(x => x.id === id);
    if (!p) return;
    await invoke('settings.modelConfig:set', { id, enabled: p.enabled });
  }

  async function handleModelSelect(providerId: string, model: string) {
    setProviders(prev => prev.map(x => x.id === providerId ? { ...x, selectedModel: model } : x));
    await invoke('settings.modelConfig:selectModel', { id: providerId, model });
  }

  async function handleSetPrimary(id: string) {
    setProviders(prev => prev.map(p => ({ ...p, isPrimary: p.id === id })));
    try {
      await invoke('settings.modelConfig:setPrimary', { id });
    } catch (e: any) {
      setError(e.message);
      loadConfig();
    }
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput) return;
    try {
      await invoke('settings.apiKey:set', { providerId: apiKeyInput.providerId, apiKey: apiKeyInput.value });
      setApiKeyInput(null);
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save API key');
      setApiKeyInput(null);
    }
  }

  async function handleRemoveCustom(id: string) {
    if (!confirm(`Remove provider "${id}"? This also deletes its API key.`)) return;
    try {
      await invoke('settings.modelConfig:remove', { id });
      await loadConfig();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleSubmitCustom() {
    if (!customDraft) return;
    setCustomError(null);
    const models = customDraft.models.split(',').map(m => m.trim()).filter(Boolean);
    try {
      await invoke('settings.modelConfig:add', {
        id: customDraft.id.trim(),
        name: customDraft.name.trim(),
        baseUrl: customDraft.baseUrl.trim(),
        kind: customDraft.kind,
        models,
      });
      setCustomDraft(null);
      await loadConfig();
    } catch (e: any) {
      setCustomError(e.message ?? 'Failed to add provider');
    }
  }

  const { configured, available } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (p: ModelProvider) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    return {
      configured: providers.filter(p => p.configured && match(p)),
      available: providers.filter(p => !p.configured && match(p)),
    };
  }, [providers, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Model Providers</h3>

          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter providers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-border rounded pl-8 pr-3 py-1.5 text-sm"
            />
          </div>

          {loading && <p className="text-muted-foreground">Loading...</p>}
          {error && <p className="text-red-500 mb-2">{error}</p>}

          {configured.length > 0 && (
            <SectionHeader label="Configured" count={configured.length} />
          )}
          <div className="space-y-3">
            {configured.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                apiKeyInput={apiKeyInput}
                setApiKeyInput={setApiKeyInput}
                onToggle={handleToggle}
                onModelSelect={handleModelSelect}
                onSetPrimary={handleSetPrimary}
                onSaveApiKey={handleSaveApiKey}
                onRemoveCustom={handleRemoveCustom}
              />
            ))}
          </div>

          {available.length > 0 && (
            <SectionHeader label="Available" count={available.length} />
          )}
          <div className="space-y-3">
            {available.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                apiKeyInput={apiKeyInput}
                setApiKeyInput={setApiKeyInput}
                onToggle={handleToggle}
                onModelSelect={handleModelSelect}
                onSetPrimary={handleSetPrimary}
                onSaveApiKey={handleSaveApiKey}
                onRemoveCustom={handleRemoveCustom}
              />
            ))}
          </div>

          {!loading && providers.length > 0 && configured.length === 0 && available.length === 0 && (
            <p className="text-muted-foreground text-sm">No providers match "{search}".</p>
          )}

          <div className="mt-5 pt-4 border-t border-border">
            {customDraft ? (
              <CustomProviderForm
                draft={customDraft}
                error={customError}
                onChange={setCustomDraft}
                onCancel={() => { setCustomDraft(null); setCustomError(null); }}
                onSubmit={handleSubmitCustom}
              />
            ) : (
              <button
                onClick={() => setCustomDraft(EMPTY_DRAFT)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-4 h-4" />
                Add custom provider
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-2">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-xs text-muted-foreground">({count})</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

interface ProviderCardProps {
  provider: ModelProvider;
  apiKeyInput: { providerId: string; value: string } | null;
  setApiKeyInput: (v: { providerId: string; value: string } | null) => void;
  onToggle: (id: string) => void;
  onModelSelect: (id: string, model: string) => void;
  onSetPrimary: (id: string) => void;
  onSaveApiKey: () => void;
  onRemoveCustom: (id: string) => void;
}

function ProviderCard({
  provider, apiKeyInput, setApiKeyInput,
  onToggle, onModelSelect, onSetPrimary, onSaveApiKey, onRemoveCustom,
}: ProviderCardProps) {
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{provider.name}</span>
          {provider.isCustom && (
            <span className="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">Custom</span>
          )}
          {provider.configured && (
            <span className="text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Configured</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {provider.configured && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="radio"
                name="primaryProvider"
                checked={provider.isPrimary}
                onChange={() => onSetPrimary(provider.id)}
                className="w-3.5 h-3.5"
              />
              <span className={provider.isPrimary ? 'text-foreground' : 'text-muted-foreground'}>
                Primary
              </span>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={() => onToggle(provider.id)}
              className="w-3.5 h-3.5"
            />
            <span className="text-muted-foreground">Enabled</span>
          </label>
          {provider.isCustom && (
            <button
              onClick={() => onRemoveCustom(provider.id)}
              className="text-muted-foreground hover:text-red-500"
              title="Remove custom provider"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {provider.configured && provider.models.length > 0 && (
        <div className="mb-3">
          <label className="text-xs text-muted-foreground block mb-1">Model</label>
          <select
            value={provider.selectedModel ?? provider.models[0]}
            onChange={(e) => onModelSelect(provider.id, e.target.value)}
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
          >
            {provider.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {apiKeyInput?.providerId === provider.id ? (
        <div className="mt-2">
          <input
            type="password"
            autoComplete="off"
            placeholder="Enter API key"
            value={apiKeyInput.value}
            onChange={(e) => setApiKeyInput({ providerId: provider.id, value: e.target.value })}
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={onSaveApiKey}
              className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
            >
              Save
            </button>
            <button
              onClick={() => setApiKeyInput(null)}
              className="px-3 py-1 border border-border rounded text-sm hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setApiKeyInput({ providerId: provider.id, value: '' })}
          className="mt-1 text-sm text-muted-foreground hover:text-foreground underline"
        >
          {provider.configured ? 'Update API Key' : 'Add API Key'}
        </button>
      )}
    </div>
  );
}

interface CustomProviderFormProps {
  draft: CustomDraft;
  error: string | null;
  onChange: (draft: CustomDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CustomProviderForm({ draft, error, onChange, onCancel, onSubmit }: CustomProviderFormProps) {
  const update = (patch: Partial<CustomDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-semibold">Add custom provider</h4>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID" hint="lowercase, no spaces">
          <input
            type="text"
            value={draft.id}
            onChange={(e) => update({ id: e.target.value })}
            placeholder="local-llama"
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Local Llama"
            className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
          />
        </Field>
      </div>
      <Field label="Base URL">
        <input
          type="text"
          value={draft.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="http://localhost:11434/v1"
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Kind">
        <select
          value={draft.kind}
          onChange={(e) => update({ kind: e.target.value as ProviderKind })}
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
        >
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </Field>
      <Field label="Models" hint="comma-separated">
        <input
          type="text"
          value={draft.models}
          onChange={(e) => update({ models: e.target.value })}
          placeholder="llama3, llama3:70b"
          className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
        />
      </Field>
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
        >
          Add provider
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-border rounded text-sm hover:bg-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">
        {label}
        {hint && <span className="ml-1 text-muted-foreground/60">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
