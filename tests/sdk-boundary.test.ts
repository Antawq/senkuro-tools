import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SHIPPED_DIRS = ['entrypoints', 'utils'];
const STATEMENT = /\b(import|export)\s+(type\s+)?[^;]*?from\s+['"]@antawq\/senkuro['"]/g;
const BARE = /\b(?:import|require)\s*\(?\s*['"]@antawq\/senkuro['"]/;

const valueUses = (source: string): number => [...source.matchAll(STATEMENT)].filter((match) => !match[2]).length + (BARE.test(source) ? 1 : 0);

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesIn(path);
    return /\.(ts|js)$/.test(entry.name) ? [path] : [];
  });

describe('senkuro sdk boundary', () => {
  it('keeps the sdk out of the code the extension ships', () => {
    const offenders = SHIPPED_DIRS.flatMap(sourcesIn).filter((file) => valueUses(readFileSync(file, 'utf8')) > 0);
    expect(offenders).toEqual([]);
  });

  it.each([
    ["import type { A } from '@antawq/senkuro';", 0],
    ["import type {\n  A,\n  B,\n} from '@antawq/senkuro';", 0],
    ["export type { A } from '@antawq/senkuro';", 0],
    ["import { A } from '@antawq/senkuro';", 1],
    ["import { type A } from '@antawq/senkuro';", 1],
    ["import * as sdk from '@antawq/senkuro';", 1],
    ["export { A } from '@antawq/senkuro';", 1],
    ["import '@antawq/senkuro';", 1],
    ["const sdk = await import('@antawq/senkuro');", 1],
    ["const sdk = require('@antawq/senkuro');", 1],
    ["import { A } from './senkuro';", 0],
  ])('tells value uses of the sdk from type-only ones in %j', (source, expected) => {
    expect(valueUses(source)).toBe(expected);
  });
});
