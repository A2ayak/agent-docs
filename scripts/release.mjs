#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmRegistry = 'https://registry.npmjs.org/';

function run(command, args, { capture = false, shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 执行失败（退出码 ${result.status ?? '未知'}）`);
  }
  return capture ? result.stdout.trim() : undefined;
}

function git(args, options) {
  return run('git', args, options);
}

function npm(args, options) {
  // npm_execpath points to pnpm when invoked by `pnpm run release`.
  // Invoke npm itself so pack JSON and version/tag behavior stay consistent.
  return run('npm', args, { ...options, shell: process.platform === 'win32' });
}

function nextVersion(current, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error(`当前版本 ${current} 不是稳定版 x.y.z，请手动处理后再发布。`);
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function chooseVersion(rl, current) {
  const choices = [
    ['patch', nextVersion(current, 'patch')],
    ['minor', nextVersion(current, 'minor')],
    ['major', nextVersion(current, 'major')],
  ];
  console.log(`当前版本：${current}`);
  choices.forEach(([type, version], index) => console.log(`${index + 1}. ${type} → ${version}`));

  while (true) {
    const answer = (await rl.question('选择版本级别 [1]，输入 q 退出：')).trim().toLowerCase();
    if (answer === 'q') return null;
    if (answer === '' || answer === '1' || answer === '2' || answer === '3') {
      return choices[answer === '' ? 0 : Number(answer) - 1];
    }
    console.log('请输入 1、2、3 或 q。');
  }
}

function ensureReleaseReady(packageInfo, version) {
  if (!existsSync(resolve(root, 'LICENSE')) || !packageInfo.license) {
    throw new Error('缺少 LICENSE 文件或 package.json 的 license 字段。');
  }
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(packageInfo.name)) {
    throw new Error('package.json 中的包名不符合发布脚本要求。');
  }
  if (packageInfo.publishConfig?.registry !== npmRegistry) {
    throw new Error(`publishConfig.registry 必须是 ${npmRegistry}。`);
  }
  if (git(['branch', '--show-current'], { capture: true }) !== 'main') {
    throw new Error('请先切换到 main 分支。');
  }

  console.log('检查远端 main 和标签…');
  git(['fetch', 'origin', 'main', '--tags']);
  const base = spawnSync('git', [
    'merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD',
  ], { cwd: root, stdio: 'ignore' });
  if (base.error) throw base.error;
  if (base.status !== 0) {
    throw new Error('origin/main 含有本地没有的提交，请先拉取并处理差异。');
  }
  const tag = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/v${version}`], {
    cwd: root,
    stdio: 'ignore',
  });
  if (tag.error) throw tag.error;
  if (tag.status === 0) throw new Error(`标签 v${version} 已存在。`);
}

async function commitPendingChanges(rl, version) {
  const changes = git(['status', '--short', '--untracked-files=all'], { capture: true });
  if (!changes) return 'clean';

  console.log('\n以下本地改动尚未提交：');
  console.log(changes);
  const answer = (await rl.question('是否将以上全部改动提交到 main？输入 yes 确认：')).trim();
  if (answer !== 'yes') return 'cancelled';

  const defaultMessage = `chore: release v${version}`;
  const input = (await rl.question(`提交说明 [${defaultMessage}]：`)).trim();
  const message = input || defaultMessage;
  git(['add', '--all']);
  git(['commit', '-m', message]);
  return 'committed';
}

function verifyPackage(packageInfo, version) {
  console.log('\n检查 npm 官方 registry 中的版本…');
  const versions = JSON.parse(npm([
    'view', packageInfo.name, 'versions', '--json',
    `--registry=${npmRegistry}`,
  ], { capture: true }));
  if (versions.includes(version)) throw new Error(`${packageInfo.name}@${version} 已发布，不能重复发布。`);

  console.log('\n运行测试…');
  npm(['test']);

  console.log('\n检查 npm 包内容…');
  const [pack] = JSON.parse(npm(['pack', '--dry-run', '--json'], { capture: true }));
  if (!pack?.files?.some((file) => file.path === 'LICENSE')) {
    throw new Error('npm 包中没有 LICENSE 文件，请检查 files 配置。');
  }
  console.log(`打包检查通过：${pack.files.length} 个文件，包含 LICENSE。`);
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], { capture: true })) {
    throw new Error('检查过程产生了未提交的改动，请处理后重试。');
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('用法：npm run release\n交互选择 patch/minor/major，确认本地改动，再创建一个包含版本更新的发布提交和标签，推送 main 与标签以触发 GitHub Actions 发布 npm。');
    return;
  }
  if (process.argv.length > 2) throw new Error('不支持额外参数；请运行 npm run release。');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('发布需要交互式终端，请在本地终端运行 npm run release。');
  }

  const packageInfo = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let startedVersion = null;
  let preparedCommit = false;
  try {
    const selection = await chooseVersion(rl, packageInfo.version);
    if (!selection) {
      console.log('已取消发布。');
      return;
    }
    const [type, version] = selection;
    ensureReleaseReady(packageInfo, version);
    const commitResult = await commitPendingChanges(rl, version);
    if (commitResult === 'cancelled') {
      console.log('已取消发布，仓库未改变。');
      return;
    }
    preparedCommit = commitResult === 'committed';
    verifyPackage(packageInfo, version);

    console.log(`\n将执行：更新版本到 ${version} → 合并到发布提交 → 创建标签 v${version} → 推送 main 和标签`);
    console.log('推送标签会触发 GitHub Actions，自动发布到 npm。');
    const confirmation = (await rl.question(`输入 v${version} 确认发布，其他输入取消：`)).trim();
    if (confirmation !== `v${version}`) {
      console.log(preparedCommit
        ? '已取消发布；之前确认的本地提交已保留，未创建版本标签。'
        : '已取消发布，仓库未改变。');
      return;
    }

    startedVersion = version;
    npm(['version', type, '--no-git-tag-version']);
    if (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version !== version) {
      throw new Error(`版本更新结果与预期 ${version} 不一致，请检查本地仓库。`);
    }
    git(['add', '--all']);
    if (preparedCommit) {
      git(['commit', '--amend', '--no-edit']);
    } else {
      git(['commit', '-m', `chore: release v${version}`]);
    }
    git(['tag', '-a', `v${version}`, '-m', `v${version}`]);
    git(['push', 'origin', 'main']);
    git(['push', 'origin', `v${version}`]);
    console.log(`\n已推送 v${version}。请在 GitHub Actions 的 Publish to npm 中查看发布结果。`);
  } catch (error) {
    if (startedVersion) {
      console.error(`\n发布中止：${error.message}`);
      console.error(`本地可能已更新版本、生成提交或标签。请检查 git status、git log 和 git tag；如果提交与标签已创建，推送失败时可重试 git push origin main，再执行 git push origin v${startedVersion}。`);
      process.exitCode = 1;
      return;
    }
    if (preparedCommit) {
      console.error('已确认的本地提交仍保留；未创建版本标签或推送。');
    }
    throw error;
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\n发布中止：${error.message}`);
  process.exitCode = 1;
});
