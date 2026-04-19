import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BINARIES_DIR = path.join(process.cwd(), 'src-tauri', 'binaries');
fs.mkdirSync(BINARIES_DIR, { recursive: true });

async function downloadTemporal() {
  const url = 'https://temporal.download/cli/archive/latest?platform=windows&arch=amd64';
  console.log(`Downloading Temporal CLI from ${url}...`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Temporal CLI: ${response.statusText}`);
  }
  
  const destFile = path.join(BINARIES_DIR, 'temporal.zip');
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destFile, Buffer.from(buffer));
  console.log('Download complete, extracting...');
  
  spawnSync('powershell', ['-Command', `Expand-Archive -Path '${destFile}' -DestinationPath '${BINARIES_DIR}' -Force`], { stdio: 'inherit' });
  
  // The temporal CLI binary is temporal.exe
  const targetBinary = path.join(BINARIES_DIR, 'temporal-x86_64-pc-windows-msvc.exe');
  fs.renameSync(path.join(BINARIES_DIR, 'temporal.exe'), targetBinary);
  fs.unlinkSync(destFile);
  
  console.log(`Successfully installed Temporal binary at ${targetBinary}`);
}

downloadTemporal().catch(console.error);
