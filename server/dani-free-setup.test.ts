import { describe, it, expect } from 'vitest';
import { DANI_FREE_TOOLS, installDaniFreeTools, daniFreeInstalled } from './dani-free-setup.ts';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
describe('Dani Free tools setup', () => {
  it('installs all required fixed tools once across repeated clicks without starting a model service', async () => {
    const seen: string[] = []; let release!: () => void;
    const gate = new Promise<void>(r => release=r);
    const install = async (r: typeof DANI_FREE_TOOLS[number]) => { seen.push(r.engine); await gate; };
    const a=installDaniFreeTools(install), b=installDaniFreeTools(install); expect(a).toBe(b); release();
    expect(await a).toMatchObject({phase:'installed',modelReady:false});
    expect(seen).toEqual(DANI_FREE_TOOLS.map(r=>r.engine));
  });
  it('reports setup failure honestly, never model-ready', async () => {
    expect(await installDaniFreeTools(async()=>{throw Error('synthetic download failure');})).toMatchObject({phase:'failed',modelReady:false});
  });
  it('can retry after a synchronously thrown installation error', async () => {
    await installDaniFreeTools(() => { throw Error('synchronous failure'); });
    const seen: string[] = [];
    expect(await installDaniFreeTools(async r => { seen.push(r.engine); })).toMatchObject({phase:'installed',modelReady:false});
    expect(seen).toHaveLength(3);
  });
  it('does not trust a missing or unsupported install',()=>{
    expect(daniFreeInstalled(mkdtempSync(join(tmpdir(),'dani-free-test-')))).toBe(false);
    expect(daniFreeInstalled('/not-installed','linux-arm64')).toBe(false);
  });
});
