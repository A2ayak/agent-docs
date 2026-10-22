import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyInstall, planInstall } from '../src/install.mjs';
import { listPresets } from '../src/presets.mjs';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesDirectory = path.join(packageDirectory, 'templates');
const binFile = path.join(packageDirectory, 'bin', 'agent-docs.mjs');

async function makeTempDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-docs-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('新增预设目录会自动出现并能直接安装', async (t) => {
  const root = await makeTempDirectory(t);
  const templates = path.join(root, 'templates');
  const presetDirectory = path.join(templates, 'backend');
  const targetDirectory = path.join(root, 'target');
  await mkdir(path.join(presetDirectory, 'docs', 'standards'), { recursive: true });
  await mkdir(targetDirectory);
  await writeFile(path.join(presetDirectory, 'AGENTS.md'), '# Backend\n');
  await writeFile(path.join(presetDirectory, 'docs', 'standards', 'backend.md'), '# 后端\n');

  assert.deepEqual(await listPresets(templates), ['backend']);
  const plan = await planInstall({ templatesDirectory: templates, presetName: 'backend', targetDirectory });
  await applyInstall(plan);
  assert.equal(await readFile(path.join(targetDirectory, 'AGENTS.md'), 'utf8'), '# Backend\n');
  assert.equal(await readFile(path.join(targetDirectory, 'docs', 'standards', 'backend.md'), 'utf8'), '# 后端\n');
});

test('首次安装复制完整模板，重复安装保护已有文件，force 显式覆盖', async (t) => {
  const targetDirectory = await makeTempDirectory(t);
  const sourceAgents = await readFile(path.join(templatesDirectory, 'default', 'AGENTS.md'), 'utf8');

  const initial = await planInstall({ templatesDirectory, presetName: 'default', targetDirectory });
  assert.equal(initial.entries.length, 12);
  assert.ok(initial.entries.every((entry) => entry.action === 'create'));
  await applyInstall(initial);
  assert.equal(await readFile(path.join(targetDirectory, 'AGENTS.md'), 'utf8'), sourceAgents);
  assert.equal((await readdir(path.join(targetDirectory, 'docs', 'standards'))).length, 11);

  const targetAgents = path.join(targetDirectory, 'AGENTS.md');
  await writeFile(targetAgents, '# 本地修改\n');
  const repeat = await planInstall({ templatesDirectory, presetName: 'default', targetDirectory });
  assert.ok(repeat.entries.every((entry) => entry.action === 'skip'));
  await applyInstall(repeat);
  assert.equal(await readFile(targetAgents, 'utf8'), '# 本地修改\n');

  const forced = await planInstall({ templatesDirectory, presetName: 'default', targetDirectory, force: true });
  assert.ok(forced.entries.every((entry) => entry.action === 'overwrite'));
  await applyInstall(forced);
  assert.equal(await readFile(targetAgents, 'utf8'), sourceAgents);
});

test('上级路径冲突会在写入前阻止整次安装', async (t) => {
  const targetDirectory = await makeTempDirectory(t);
  await writeFile(path.join(targetDirectory, 'docs'), '已有文件');

  const plan = await planInstall({ templatesDirectory, presetName: 'default', targetDirectory });
  assert.ok(plan.entries.some((entry) => entry.action === 'blocked'));
  await assert.rejects(applyInstall(plan), /未复制任何文件/);
  assert.deepEqual(await readdir(targetDirectory), ['docs']);
});

test('CLI 预览模式不写入文件', async (t) => {
  const targetDirectory = await makeTempDirectory(t);
  const result = spawnSync(process.execPath, [binFile, 'init', '--preset', 'default', '--target', targetDirectory, '--dry-run'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /预览模式/);
  assert.deepEqual(await readdir(targetDirectory), []);
});

test('CLI 重复 init 跳过已有文件且不写入额外文件', async (t) => {
  const targetDirectory = await makeTempDirectory(t);
  const args = [binFile, 'init', '--preset', 'default', '--target', targetDirectory];
  const installed = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual((await readdir(targetDirectory)).sort(), ['AGENTS.md', 'docs']);

  const repeated = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /跳过 12/);
  assert.deepEqual((await readdir(targetDirectory)).sort(), ['AGENTS.md', 'docs']);
});
