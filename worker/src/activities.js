export async function spawnAgent(prompt: string): Promise<string> {
  console.log(`Activity: spawnAgent called with prompt: ${prompt}`);
  
  // Since we are running outside Tauri in a separate Bun process,
  // we cannot directly call Tauri IPC here. The actual spawning of PTY
  // will be handled by the frontend calling Tauri for the MVP.
  // This activity just simulates the temporal workflow progressing.
  
  return `Agent spawned for prompt: ${prompt}`;
}
