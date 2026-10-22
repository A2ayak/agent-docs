#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { applyInstall, planInstall } from '../src/install.mjs';
import { listPresets } from '../src/presets.mjs';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesDirectory = path.join(packageDirectory, 'templates');

function printHelp() {
  console.log(`用法：
  agent-docs init [--preset 名称] [--target 目录] [--dry-run] [--force]
  agent-docs list
  agent-docs --version

init 从安装包中选择预设，将 AGENTS.md 和 docs/ 复制到目标目录。
已有文件默认跳过；--force 覆盖预设中的同名普通文件。`);
}

function parseOptions(command, args) {
  const allowed = command === 'init'
    ? new Set(['preset', 'target', 'dry-run', 'force'])
    : new Set();
  const options = { target: process.cwd(), dryRun: false, force: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    const name = argument.slice(2);
    if (!allowed.has(name)) throw new Error(`${command} 不支持参数 ${argument}。`);
    if (name === 'preset' || name === 'target') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 需要一个值。`);
      options[name] = value;
      index += 1;
    } else {
      options[name === 'dry-run' ? 'dryRun' : name] = true;
    }
  }
  return options;
}

async function choosePreset(presets) {
  if (!presets.length) throw new Error('没有可用预设。');
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('非交互环境请使用 --preset 指定预设。');
  }

  const input = createInterface({ input: stdin, output: stdout });
  try {
    console.log('请选择预设：');
    presets.forEach((preset, index) => console.log(`  ${index + 1}. ${preset}`));
    while (true) {
      const answer = (await input.question('输入编号或名称（直接回车选择第 1 项）：')).trim();
      if (!answer) return presets[0];
      const number = Number(answer);
      if (Number.isInteger(number) && number >= 1 && number <= presets.length) return presets[number - 1];
      if (presets.includes(answer)) return answer;
      console.log('无效选项，请重新输入。');
    }
  } finally {
    input.close();
  }
}

function printPlan(plan, dryRun) {
  const labels = { create: '新增', overwrite: '覆盖', skip: '跳过', blocked: '阻止' };
  console.log(`预设：${plan.presetName}`);
  console.log(`目标：${plan.targetDirectory}`);
  if (dryRun) console.log('预览模式：不会写入文件。');
  for (const entry of plan.entries) {
    console.log(`[${labels[entry.action]}] ${entry.relativePath}${entry.reason ? `（${entry.reason}）` : ''}`);
  }
  const counts = {};
  for (const entry of plan.entries) counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  console.log(`汇总：${Object.entries(counts).map(([action, count]) => `${labels[action]} ${count}`).join('，') || '无文件'}。`);
}

async function runInit(options) {
  const available = await listPresets(templatesDirectory);
  const presetName = options.preset ?? await choosePreset(available);
  if (!available.includes(presetName)) throw new Error(`找不到预设 ${presetName}。可用预设：${available.join('、')}`);

  const plan = await planInstall({ templatesDirectory, presetName, targetDirectory: options.target, force: options.force });
  printPlan(plan, options.dryRun);
  if (plan.entries.some((entry) => entry.action === 'blocked')) throw new Error('请处理被阻止的路径后重试。');
  if (!options.dryRun) await applyInstall(plan);
}

async function main() {
  const [command = 'init', ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help' || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  if (command === '--version' || command === '-v') {
    const packageJson = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
    console.log(packageJson.version);
    return;
  }
  if (!['init', 'list'].includes(command)) throw new Error(`未知命令：${command}`);
  const options = parseOptions(command, args);
  if (command === 'list') {
    (await listPresets(templatesDirectory)).forEach((preset) => console.log(preset));
  } else {
    await runInit(options);
  }
}

main().catch((error) => {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
});
