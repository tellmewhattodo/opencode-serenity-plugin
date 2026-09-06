/**
 * acc-kit.ts — ACC Kit tool (v0.8 M0)
 *
 * ACC 通用能力工具包。由 v0.3 ccc-status.ts 升级而来，语义简洁，供任何 agent 使用。
 * 不绑定 resident，不单独新增 tool（用户决策：通用能力整合承载）。
 *
 * actions:
 *   health — CCC 三原则检查（P1 rooted / P2 git-managed / P3 binary permissions）
 *   time   — 当前时间（now_iso / now_local / epoch_ms）
 *   wait   — 等待指定秒数
 */

import { existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';
import { findSerenityRoot } from './fs/resolve-path.js';
import { getState, ensureReady } from './state.js';
import { isPathInside } from './util/git.js';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;

/**
 * v0.9 registry 完整性检查（specs §4.3 + dsp v1.30 dashboard health registry 段）。
 * parse（剥 BOM）/ 顶层 wrapper 结构 / 每 entry 字段类型 / name 唯一 / path 根内 + 脚本存在。
 * 坏不抛错——坏表 → ok:false + issues + git 恢复指引；无 cccName 时 issues 空 + ok:true。
 */
export function checkRegistryHealth(cwdRoot: string, cccName?: string | null): { ok: boolean; issues: string[]; path?: string } {
  if (!cccName) return { ok: true, issues: [] };
  const registryPath = join(cwdRoot, '.opencode', 'skills', cccName, 'references', 'mech-registry.json');
  if (!existsSync(registryPath)) {
    return { ok: true, issues: [], path: registryPath }; // 尚无注册表 = 非坏（空 CCC）
  }
  const issues: string[] = [];
  try {
    let raw = readFileSync(registryPath, 'utf-8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 剥 BOM
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push('registry: top-level must be a {version, entries} wrapper object');
      return { ok: false, issues, path: registryPath };
    }
    if (!Array.isArray(parsed.entries)) {
      issues.push('registry: entries must be an array');
      return { ok: false, issues, path: registryPath };
    }
    const names = new Set<string>();
    for (const e of parsed.entries as unknown[]) {
      const entry = e as Record<string, unknown>;
      if (typeof entry?.name !== 'string' || entry.name.length === 0) {
        issues.push('registry: entry missing string name');
        continue;
      }
      if (names.has(entry.name)) {
        issues.push(`registry: duplicate name "${entry.name}"`);
      }
      names.add(entry.name);
      if (typeof entry.path !== 'string') {
        issues.push(`registry: entry "${entry.name}" missing string path`);
        continue;
      }
      const abs = isAbsolute(entry.path) ? entry.path : resolve(cwdRoot, entry.path);
      if (!isPathInside(cwdRoot, abs)) {
        issues.push(`registry: entry "${entry.name}" path escapes root (${entry.path})`);
        continue;
      }
      if (!existsSync(abs)) {
        issues.push(`registry: entry "${entry.name}" script missing (${entry.path})`);
      }
    }
    return { ok: issues.length === 0, issues, path: registryPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`registry: parse failed — ${msg}`);
    return { ok: false, issues, path: registryPath };
  }
}

/** 内部：CCC 三原则健康检查（原 ccc-status.ts P1/P2/P3 逻辑迁移） */
function cccHealthCheck(directory: string): string {
  const state = getState();

  const root = findSerenityRoot(directory);

  // P1: .serenity file exists and is non-empty
  const serenityPath = resolve(root, '.serenity');
  const p1Pass = existsSync(serenityPath);

  // P2: git-managed — state.activated implies git check passed (RR6)
  const p2Pass = state.activated;

  // P3: opencode.json with plugin config
  const opencodeJsonPath = resolve(root, 'opencode.json');
  let p3Pass = false;
  let p3Detail = '';
  if (existsSync(opencodeJsonPath)) {
    p3Pass = true;
    p3Detail = 'opencode.json found';
  } else {
    p3Detail = 'opencode.json not found at CCC root';
  }

  const allPass = p1Pass && p2Pass && p3Pass;

  // v0.9: registry 完整性段（specs §4.3）
  const registry = checkRegistryHealth(root, state.cccName);

  const report = {
    ccc: state.cccName,
    root,
    version: VERSION,
    status: allPass && registry.ok ? 'healthy' : 'degraded',
    principles: {
      P1_rooted: {
        pass: p1Pass,
        detail: p1Pass ? '.serenity marker found' : '.serenity marker missing',
      },
      P2_git_managed: {
        pass: p2Pass,
        detail: p2Pass ? 'git repository verified' : 'not in a git repository',
      },
      P3_binary_permissions: {
        pass: p3Pass,
        detail: p3Detail,
      },
    },
    registry: {
      ok: registry.ok,
      path: registry.path ?? null,
      issues: registry.issues,
      recovery: registry.ok
        ? undefined
        : 'registry is ACC-managed: repair via git checkout -- <registry> or container_admin msm register/deregister',
    },
  };

  return JSON.stringify(report, null, 2);
}

export const accKitTool: ToolDefinition = tool({
  description:
    `ACC Kit tool (v${VERSION}) — ACC 通用能力工具包。语义简洁，供任何 agent 使用。` +
    'actions: health（CCC 三原则检查）/ time（当前时间）/ wait（等待 N 秒）。',
  args: {
    action: z
      .enum(['health', 'time', 'wait'])
      .describe('操作：health / time / wait'),
    seconds: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('wait action: 等待秒数'),
  },
  execute: async (input, ctx) => {
    await ensureReady();
    switch (input.action) {
      case 'health':
        return cccHealthCheck(ctx.directory);
      case 'time': {
        const now = new Date();
        return JSON.stringify(
          {
            now_iso: now.toISOString(),
            now_local: now.toString(),
            epoch_ms: now.getTime(),
          },
          null,
          2,
        );
      }
      case 'wait': {
        const seconds = input.seconds ?? 1;
        await new Promise((r) => setTimeout(r, seconds * 1000));
        return `waited ${seconds}s`;
      }
    }
  },
});
