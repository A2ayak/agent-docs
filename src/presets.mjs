import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

const presetNamePattern = /^[a-z0-9][a-z0-9-]*$/;

export async function listPresets(templatesDirectory) {
  const entries = await readdir(templatesDirectory, { withFileTypes: true });
  const names = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!presetNamePattern.test(entry.name)) {
      throw new Error(`预设目录名无效：${entry.name}。请使用小写字母、数字和连字符。`);
    }

    const agentsFile = path.join(templatesDirectory, entry.name, 'AGENTS.md');
    let agentsStat;
    try {
      agentsStat = await lstat(agentsFile);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`预设 ${entry.name} 缺少 AGENTS.md。`);
      }
      throw error;
    }
    if (!agentsStat.isFile()) {
      throw new Error(`预设 ${entry.name} 的 AGENTS.md 必须是普通文件。`);
    }
    names.push(entry.name);
  }

  if (names.length === 0) throw new Error('templates/ 下没有可用预设。');
  names.sort((a, b) => a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b));
  return names;
}

export async function collectPresetFiles(templatesDirectory, presetName) {
  if (!presetNamePattern.test(presetName)) {
    throw new Error(`预设名无效：${presetName}`);
  }
  const presetDirectory = path.join(templatesDirectory, presetName);
  const files = [];

  async function visit(relativeDirectory) {
    const directory = path.join(presetDirectory, relativeDirectory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile()) {
        files.push({
          source: path.join(presetDirectory, relativePath),
          relativePath: relativePath.split(path.sep).join('/'),
        });
      } else {
        throw new Error(`预设 ${presetName} 包含不支持的文件类型：${relativePath}`);
      }
    }
  }

  await visit('');
  return files;
}
