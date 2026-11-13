import { describe, expect, it } from 'vitest';
import { TaskScheduler, ResourceLeases, redactDiagnostic } from '../src/runtime';
import { ExtensionRegistry, validateExtension } from '../src/plugins';
import { getDesignManifest, STYLES, TEMPLATES } from '../src/design-packages';

const target = { projectId: 'p', artworkId: 'a', inputHash: 'first' };
describe('task isolation and resource ownership', () => {
  it('serializes heavy tasks and only emits real stages', async () => {
    const scheduler = new TaskScheduler(1), events: string[] = [], order: string[] = [];
    scheduler.subscribe(event => events.push(`${event.label}:${event.stage}`));
    const first = scheduler.submit({ key: 'one', label: 'one', target, run: async context => { order.push('one:start'); context.onStage?.('解码'); await Promise.resolve(); order.push('one:end'); return 1; } });
    const second = scheduler.submit({ key: 'two', label: 'two', target, run: async () => { order.push('two:start'); return 2; } });
    expect(await Promise.all([first.promise, second.promise])).toEqual([1, 2]);
    expect(order).toEqual(['one:start', 'one:end', 'two:start']);
    expect(events).toContain('one:解码');
    scheduler.dispose();
  });
  it('does not deliver a late old result after replacement', async () => {
    const scheduler = new TaskScheduler();
    let finish!: () => void;
    const first = scheduler.submit({ key: 'preview', label: 'old', target, run: async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'old'; } });
    const observed = first.promise.catch(error => error.name);
    await Promise.resolve();
    const second = scheduler.submit({ key: 'preview', label: 'new', target: { ...target, inputHash: 'second' }, run: async () => 'new' });
    finish();
    expect(await observed).toBe('AbortError');
    expect(await second.promise).toBe('new');
    expect(scheduler.list().find(event => event.label === 'old')?.state).toBe('cancelled');
    scheduler.dispose();
  });
  it('keeps hidden/history resources and makes lease release idempotent', () => {
    const leases = new ResourceLeases();
    leases.setRoot('undo:1', ['original']);
    const release = leases.acquire(['frame', 'frame']);
    expect(leases.collectable(['original', 'frame', 'orphan'])).toEqual(['orphan']);
    release(); release();
    expect(leases.stats().leases).toBe(0);
    expect(leases.retained('original')).toBe(true);
    leases.removeRoot('undo:1'); expect(leases.retained('original')).toBe(false);
  });
  it('redacts sensitive diagnostics', () => {
    const redacted = redactDiagnostic('api_key=secret123 Bearer abc123 https://provider.example/search?q=secret 135.772411');
    expect(redacted).not.toContain('secret123'); expect(redacted).not.toContain('q='); expect(redacted).not.toContain('135.772411');
  });
});

const style = { id: 'example.sea', version: '1.0.0', sdkRange: '1.x', kind: 'style', name: 'Sea', capabilities: ['palette'], permissions: [], licenses: [{ name: 'Own palette', license: 'MIT' }], recipe: { palette: { paper: '#ffffff', ink: '#333333', water: '#227799', land: '#eeeecc', road: '#999999', accent: '#bb4466' } } };
describe('declarative extension boundaries', () => {
  it('validates/registers/activates and does not destroy in-use recipes', () => {
    const registry = new ExtensionRegistry();
    registry.register(style); registry.activate(style.id, style.version); registry.retain(style.id, style.version, 'artwork');
    expect(() => registry.dispose(style.id, style.version)).toThrow('作品引用');
    expect(registry.snapshot(style.id, style.version).recipe).toEqual(style.recipe);
    registry.release(style.id, style.version, 'artwork'); registry.dispose(style.id, style.version); expect(registry.list()).toHaveLength(0);
  });
  it('rejects arbitrary code, foreign SVG and accidental networking', () => {
    expect(() => validateExtension({ ...style, script: 'fetch("https://example.com")' })).toThrow();
    expect(() => validateExtension({ ...style, recipe: { ...style.recipe, asset: '<svg onload="alert(1)"></svg>' } })).toThrow();
    expect(() => validateExtension({ ...style, permissions: ['network-map-data'] })).toThrow();
    expect(() => validateExtension({ ...style, recipe: { ...style.recipe, texture: 'https://example.com/image.png' } })).toThrow();
  });
  it('accepts all frozen built-in design manifests without permitting unknown layout engines', () => {
    for (const definition of STYLES) expect(validateExtension(getDesignManifest('style', definition.id)).id).toBe(definition.id);
    for (const definition of TEMPLATES) expect(validateExtension(getDesignManifest('template', definition.id)).id).toBe(definition.id);
    const manifest = getDesignManifest('template', 'card-split');
    expect(() => validateExtension({ ...manifest, recipe: { ...manifest.recipe, layoutEngine: 'arbitrary-code' } })).toThrow();
    expect(() => validateExtension({ ...manifest, recipe: { ...manifest.recipe, layoutId: 'uninstalled-layout' } })).toThrow();
    expect(() => validateExtension({ ...manifest, recipe: { ...manifest.recipe, family: 'T06' } })).toThrow();
    expect(() => validateExtension({ ...manifest, recipe: { ...manifest.recipe, ratio: [0, 2] } })).toThrow();
  });
});
