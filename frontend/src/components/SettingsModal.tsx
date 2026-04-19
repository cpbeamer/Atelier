// frontend/src/components/SettingsModal.tsx
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { invoke } from '../lib/ipc';

interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  configured: boolean;
  models: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: Props) {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<{ providerId: string; value: string } | null>(null);

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
    const updated = providers.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    );
    setProviders(updated);
    const p = updated.find(x => x.id === id)!;
    await invoke('settings.modelConfig:set', { id, enabled: p.enabled, models: p.models });
  }

  async function handleModelSelect(providerId: string, model: string) {
    const p = providers.find(x => x.id === providerId)!;
    await invoke('settings.modelConfig:set', { id: providerId, enabled: p.enabled, models: [model] });
    setProviders(prev => prev.map(x => x.id === providerId ? { ...x, models: [model] } : x));
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput) return;
    await invoke('settings.apiKey:set', { providerId: apiKeyInput.providerId, apiKey: apiKeyInput.value });
    setApiKeyInput(null);
    await loadConfig();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Model Providers</h3>

          {loading && <p className="text-muted-foreground">Loading...</p>}
          {error && <p className="text-red-500">{error}</p>}

          <div className="space-y-4">
            {providers.map(provider => (
              <div key={provider.id} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{provider.name}</span>
                    {provider.configured && (
                      <span className="text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Configured</span>
                    )}
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Enabled</span>
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={() => handleToggle(provider.id)}
                      className="w-4 h-4"
                    />
                  </label>
                </div>

                {provider.configured && provider.models.length > 0 && (
                  <div className="mb-3">
                    <label className="text-xs text-muted-foreground block mb-1">Model</label>
                    <select
                      value={provider.models[0]}
                      onChange={(e) => handleModelSelect(provider.id, e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                    >
                      {provider.models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* API Key management */}
                {apiKeyInput?.providerId === provider.id ? (
                  <div className="mt-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="Enter API key"
                      value={apiKeyInput.value}
                      onChange={(e) => setApiKeyInput({ ...apiKeyInput, value: e.target.value })}
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm mb-2"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveApiKey}
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
                    className="mt-2 text-sm text-muted-foreground hover:text-foreground underline"
                  >
                    {provider.configured ? 'Update API Key' : 'Add API Key'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
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