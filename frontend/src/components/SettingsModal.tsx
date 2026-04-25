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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative bg-[var(--color-surface)] border border-[var(--color-hair)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-hair)]">
          <h2 className="text-[16px] font-medium">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="text-[12px] text-[var(--color-text-faint)] mb-3">Model providers</div>

          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Filter providers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-hair)] rounded-md pl-9 pr-3 py-2 text-[13px] focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
            />
          </div>

          {loading && <p className="text-[13px] text-[var(--color-text-muted)]">Loading…</p>}
          {error && <p className="text-[13px] text-[var(--color-error)] mb-2">{error}</p>}

          {configured.length > 0 && <SectionHeader label="Configured" count={configured.length} />}
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

          {available.length > 0 && <SectionHeader label="Available" count={available.length} />}
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
            <p className="text-[13px] text-[var(--color-text-muted)]">No providers match "{search}".</p>
          )}

          <div className="mt-6 pt-5 border-t border-[var(--color-hair)]">
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
                className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add custom provider
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-hair)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md bg-[var(--color-accent)] text-[var(--color-ink)] text-[13px] font-medium hover:opacity-90 transition-opacity"
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
    <div className="flex items-baseline gap-2 mt-5 mb-2.5">
      <span className="text-[12px] text-[var(--color-text-dim)]">{label}</span>
      <span className="text-[11.5px] text-[var(--color-text-faint)] font-mono">{count}</span>
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
    <div className="rounded-lg border border-[var(--color-hair)] bg-[var(--color-surface-2)]/50 p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13.5px] font-medium truncate">{provider.name}</span>
          {provider.isCustom && (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">custom</span>
          )}
          {provider.configured && (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)]">ready</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {provider.configured && (
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
              <input
                type="radio"
                name="primaryProvider"
                checked={provider.isPrimary}
                onChange={() => onSetPrimary(provider.id)}
                className="w-3 h-3 accent-[var(--color-accent)]"
              />
              <span className={provider.isPrimary ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}>
                Primary
              </span>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-[12px] cursor-pointer">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={() => onToggle(provider.id)}
              className="w-3 h-3 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-text-muted)]">Enabled</span>
          </label>
          {provider.isCustom && (
            <button
              onClick={() => onRemoveCustom(provider.id)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
              title="Remove custom provider"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {provider.configured && provider.models.length > 0 && (
        <div className="mb-3">
          <label className="text-[11.5px] text-[var(--color-text-muted)] block mb-1">Model</label>
          <select
            value={provider.selectedModel ?? provider.models[0]}
            onChange={(e) => onModelSelect(provider.id, e.target.value)}
            className="w-full bg-[var(--color-ink)] border border-[var(--color-hair)] rounded-md px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
          >
            {provider.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {apiKeyInput?.providerId === provider.id ? (
        <div>
          <input
            type="password"
            autoComplete="off"
            placeholder="Enter API key"
            value={apiKeyInput.value}
            onChange={(e) => setApiKeyInput({ providerId: provider.id, value: e.target.value })}
            className="w-full bg-[var(--color-ink)] border border-[var(--color-hair)] rounded-md px-2.5 py-1.5 text-[13px] mb-2 font-mono focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
          />
          <div className="flex gap-2">
            <button
              onClick={onSaveApiKey}
              className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-[var(--color-ink)] text-[12.5px] font-medium hover:opacity-90 transition-opacity"
            >
              Save
            </button>
            <button
              onClick={() => setApiKeyInput(null)}
              className="px-3 py-1.5 rounded-md border border-[var(--color-hair-2)] text-[var(--color-text-dim)] text-[12.5px] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setApiKeyInput({ providerId: provider.id, value: '' })}
          className="text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          {provider.configured ? 'Update API key →' : 'Add API key →'}
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
    <div className="rounded-lg border border-[var(--color-hair)] bg-[var(--color-surface-2)]/50 p-4 space-y-3">
      <h4 className="text-[13.5px] font-medium">Add custom provider</h4>
      {error && <p className="text-[12.5px] text-[var(--color-error)]">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID" hint="lowercase, no spaces">
          <input
            type="text"
            value={draft.id}
            onChange={(e) => update({ id: e.target.value })}
            placeholder="local-llama"
            className="input-quiet"
          />
        </Field>
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Local Llama"
            className="input-quiet"
          />
        </Field>
      </div>
      <Field label="Base URL">
        <input
          type="text"
          value={draft.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="http://localhost:11434/v1"
          className="input-quiet"
        />
      </Field>
      <Field label="Kind">
        <select
          value={draft.kind}
          onChange={(e) => update({ kind: e.target.value as ProviderKind })}
          className="input-quiet"
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
          className="input-quiet"
        />
      </Field>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          className="px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-[var(--color-ink)] text-[12.5px] font-medium hover:opacity-90 transition-opacity"
        >
          Add provider
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md border border-[var(--color-hair-2)] text-[var(--color-text-dim)] text-[12.5px] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          Cancel
        </button>
      </div>
      <style>{`
        .input-quiet {
          width: 100%;
          background: var(--color-ink);
          border: 1px solid var(--color-hair);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          transition: border-color 150ms ease;
        }
        .input-quiet:focus {
          outline: none;
          border-color: rgba(255, 107, 53, 0.4);
        }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11.5px] text-[var(--color-text-muted)] block mb-1">
        {label}
        {hint && <span className="ml-1 text-[var(--color-text-faint)]">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
