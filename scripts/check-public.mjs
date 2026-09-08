// Defense in depth, not a replacement for a dedicated secret scanner and review.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const excludedDirectories = new Set([
  '.git',
  '.impeccable',
  'node_modules',
  'site',
  '.venv',
  '__pycache__',
]);
const failures = [];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
];
async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(directory, entry.name),
      relative = path.relative(root, file).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      failures.push(`${relative}: symlinks are not allowed in release inputs`);
      continue;
    }
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) continue;
      await walk(file);
      continue;
    }
    if (
      /^(\.env|credentials|account_info|id_rsa|id_ed25519)/i.test(entry.name) ||
      /\.(pdf|p12|pfx|key|pem|sqlite|db)$/i.test(entry.name)
    )
      failures.push(`${relative}: unexpected private/document file`);
    if (
      !/\.(m?js|cjs|json|md|html|css|txt|py|yml|yaml|ts|mts|cts|xml|svg)$/.test(
        entry.name,
      )
    )
      continue;
    const content = await readFile(file, 'utf8');
    if (secretPatterns.some((pattern) => pattern.test(content)))
      failures.push(`${relative}: possible credential`);
    if (/[A-Z]:[\\/]Users[\\/]|\/Users\/[^/]+\/|\/home\/[^/]+\//.test(content))
      failures.push(`${relative}: absolute user directory`);
  }
}
await walk(root);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Release inputs: no detected credentials, private document files, symlinks, or absolute user directories.',
  );
