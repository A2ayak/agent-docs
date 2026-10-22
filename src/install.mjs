import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectPresetFiles } from './presets.mjs';

function validRelativePath(relativePath) {
  return typeof relativePath === 'string'
    && relativePath.length > 0
    && !path.posix.isAbsolute(relativePath)
    && !relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    && !relativePath.includes('\\');
}

export async function lstatIfExists(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function blockedParent(targetDirectory, relativePath) {
  let current = targetDirectory;
  const segments = relativePath.split('/').slice(0, -1);

  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstatIfExists(current);
    if (!stat) return null;
    if (!stat.isDirectory()) return current;
  }
  return null;
}

export async function validateTarget(targetDirectory) {
  const target = path.resolve(targetDirectory);
  const targetStat = await lstatIfExists(target);
  if (!targetStat?.isDirectory()) {
    throw new Error(`目标目录不存在或不是普通目录：${target}`);
  }
  return target;
}

export async function planInstallFiles({ files, presetName, targetDirectory, force = false }) {
  const target = await validateTarget(targetDirectory);
  const seen = new Set();
  for (const file of files) {
    const normalizedPath = typeof file.relativePath === 'string' ? file.relativePath.toLowerCase() : '';
    if (!validRelativePath(file.relativePath) || !Buffer.isBuffer(file.content) || seen.has(normalizedPath)) {
      throw new Error(`预设包含无效或重复的文件路径：${file.relativePath}`);
    }
    seen.add(normalizedPath);
  }

  const entries = [];

  for (const file of files) {
    const destination = path.join(target, ...file.relativePath.split('/'));
    const parentConflict = await blockedParent(target, file.relativePath);
    let action;
    let reason;

    if (parentConflict) {
      action = 'blocked';
      reason = `上级路径不是目录：${parentConflict}`;
    } else {
      const destinationStat = await lstatIfExists(destination);
      if (!destinationStat) {
        action = 'create';
      } else if (!destinationStat.isFile()) {
        action = 'blocked';
        reason = '目标路径已存在且不是普通文件';
      } else {
        action = force ? 'overwrite' : 'skip';
      }
    }
    entries.push({ ...file, destination, action, reason });
  }

  return { presetName, targetDirectory: target, entries };
}

export async function planInstall({ templatesDirectory, presetName, targetDirectory, force = false }) {
  const sourceFiles = await collectPresetFiles(templatesDirectory, presetName);
  const files = await Promise.all(sourceFiles.map(async (file) => ({
    relativePath: file.relativePath,
    content: await readFile(file.source),
  })));
  return planInstallFiles({ files, presetName, targetDirectory, force });
}

export async function applyInstall(plan) {
  if (plan.entries.some((entry) => entry.action === 'blocked')) {
    throw new Error('存在无法写入的目标路径，未复制任何文件。');
  }

  for (const entry of plan.entries) {
    if (entry.action === 'skip') continue;
    await mkdir(path.dirname(entry.destination), { recursive: true });
    await writeFile(entry.destination, entry.content, { flag: entry.action === 'create' ? 'wx' : 'w' });
  }
}
