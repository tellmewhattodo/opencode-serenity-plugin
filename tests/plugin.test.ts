/**
 * plugin 入口单测 — smoke test
 *
 * v1.9：default export 改为 { id, server } 对象形式
 * （readV1Plugin 强制 server/tui 二选一，对象形状是 opencode SDK 契约）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import plugin from '../src/index.js';
import { resetState } from '../src/state.js';
import type { PluginInput } from '@opencode-ai/plugin';

function fakeInput(directory: string): PluginInput {
  return {
    directory,
    worktree: directory,
    client: {} as PluginInput['client'],
    project: {} as PluginInput['project'],
    serverUrl: new URL('http://localhost:0'),
    $: {} as PluginInput['$'],
    experimental_workspace: { register: () => {} },
  };
}

function makeSerenityRepo(name = 'home-serenity'): string {
  const tmp = mkdtempSync(join(tmpdir(), 'serenity-repob-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp, stdio: 'ignore' });
  writeFileSync(join(tmp, '.serenity'), name);
  const skillDir = join(tmp, '.opencode', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '# skill');
  return tmp;
}

describe('plugin entry', () => {
  beforeEach(() => {
    resetState();
  });

  it('plugin default export 是 { id, server } 对象', () => {
    expect(typeof plugin).toBe('object');
    expect(plugin).not.toBeNull();
    expect(typeof (plugin as { server?: unknown }).server).toBe('function');
    expect(typeof (plugin as { id?: unknown }).id).toBe('string');
  });

  it('不激活时返回空 Hooks', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'serenity-inactive-'));
    const hooks = await (plugin as { server: (input: PluginInput) => Promise<unknown> }).server(
      fakeInput(tmp)
    );
    expect(hooks).toEqual({});
    rmSync(tmp, { recursive: true });
  });

  it('激活时返回带 tool/hook 的 Hooks', async () => {
    const tmp = makeSerenityRepo('home-serenity');
    const hooks = (await (plugin as { server: (input: PluginInput) => Promise<any> }).server(
      fakeInput(tmp)
    )) as Record<string, any>;
    expect(hooks.tool).toBeDefined();
    if (hooks.tool) {
      // v0.9: specs v1.4.0 契约名（ccc_admin → container_admin 等）
      expect(hooks.tool['container_fs']).toBeDefined();
      expect(hooks.tool['container_git']).toBeDefined();
      expect(hooks.tool['logbook']).toBeDefined();
      expect(hooks.tool['dashboard']).toBeDefined();
      expect(hooks.tool['container_admin']).toBeDefined();
    }
    expect(hooks['tool.execute.before']).toBeDefined();
    expect(hooks['experimental.chat.system.transform']).toBeDefined();
    rmSync(tmp, { recursive: true });
  });
});
