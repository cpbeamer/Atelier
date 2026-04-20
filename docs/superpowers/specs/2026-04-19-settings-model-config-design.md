# Settings Modal — Model Configuration

## Goal

Add a Settings modal to configure AI model providers and their API keys. Users can add, enable, and select models for each provider. API keys are stored securely in the OS keychain.

## Architecture

### Overview

A `SettingsModal` component renders as an overlay in `App.tsx`. It communicates with the backend via IPC channels for model configuration and keychain operations. The backend uses `node-keytar` for OS keychain access and SQLite for storing provider configs.

### Data Model

```typescript
interface ModelProvider {
  id: string;           // e.g. 'minimax', 'openrouter'
  name: string;         // Display name
  baseUrl: string;      // API base URL
  apiKeyId: string;    // Keychain key for the API key
  enabled: boolean;
  models: string[];     // Available model IDs for this provider
}

interface ModelConfig {
  defaultProvider: string;
  providers: ModelProvider[];
}
```

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `settings:modelConfig` | get/set | Read/write full model config (minus keys) |
| `settings:apiKey:get` | get | Retrieve API key from keychain by keyId |
| `settings:apiKey:set` | set | Store API key to keychain |

### Storage

- **Provider configs** (baseUrl, enabled, models) → `backend/src/db.ts` (SQLite)
- **API keys** → OS Keychain via `node-keytar`, keys namespaced as `atelier.provider.<providerId>.apiKey`

## UI Design

### Settings Modal

- **Trigger**: Settings button in sidebar footer
- **Layout**: Centered overlay modal with dark backdrop
- **Header**: "Settings" title + X close button
- **Content**: Tabbed or single-section layout

#### Models Tab

- List of provider cards (one per supported provider)
- Each card displays:
  - Provider icon/name
  - Enabled/disabled toggle
  - Model selector dropdown (populated from provider's model list)
  - "Add API Key" / "Update Key" button
- Footer: Save / Cancel buttons

### Provider Card States

| State | Appearance |
|-------|------------|
| Not configured | Provider name, "Configure" button, no model selector |
| Configured | Provider name, enabled toggle, model dropdown, "Update Key" button |
| Error | Red error message below provider name |

### Adding an API Key Flow

1. User clicks "Add API Key" on a provider card
2. Password input appears (type=password, no browser autocomplete)
3. User enters key and clicks Save
4. IPC `settings:apiKey.set(provider + '.apiKey', value)` → stores to keychain
5. Card updates to "Configured" state

Keys are **never** stored in component state or React DevTools.

## Provider Configuration

### MiniMax

- **Base URL**: `https://api.minimax.chat/v1`
- **Auth**: Bearer token — inject `Authorization: Bearer <token>` header automatically
- **Default models**: `MiniMax/Abab6.5s-chat`, `MiniMax/Abab6.5-chat`

### OpenRouter

- **Base URL**: `https://openrouter.ai/api/v1`
- **Auth**: API key in `Authorization` header
- **Extra header**: `OpenRouter-Referer: Atelier` — injected automatically
- **Default models**: `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`

### Adding Future Providers

To add a new provider:
1. Add provider config to `ModelProvider` defaults in `backend/src/db.ts`
2. Update frontend provider list in `SettingsModal`
3. No changes needed to IPC channels

## Files to Create/Modify

- **Create**: `frontend/src/components/SettingsModal.tsx` — Modal UI
- **Modify**: `frontend/src/App.tsx` — Render modal, wire to state
- **Modify**: `frontend/src/components/Sidebar.tsx` — Wire Settings button to open modal
- **Modify**: `backend/src/ipc-handlers.ts` — Add settings IPC handlers
- **Modify**: `backend/src/db.ts` — Add model config table and queries
- **Modify**: `package.json` — Add `node-keytar` dependency

## Testing

1. **IPC handlers**: Mock keytar in unit tests
2. **Keychain round-trip**: `set` then `get` verifies keychain storage
3. **Modal isolation**: Keys never appear in component state or React DevTools
4. **UI flow**: Manual test add key → toggle provider → select model → save
