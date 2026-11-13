import { describe, expect, it } from 'vitest';
import seaGlass from '../examples/extensions/sea-glass.style.json';
import wideJournal from '../examples/extensions/wide-journal.template.json';
import { createArtwork, type ArtworkDocument } from '../src/domain';
import { applyLayoutProposal, solveLayout } from '../src/composition';
import { getDesignManifest, getStyle, getTemplate, installDesignManifest, mapRecipe, resolveStyle, resolveTemplate, STYLES, TEMPLATES, templateSize } from '../src/design-packages';

function artwork(photoCount = 2): ArtworkDocument {
  installDesignManifest(wideJournal);
  const art = createArtwork(undefined, '海边旅行', { templateId: wideJournal.id, templateVersion: wideJournal.version, embeddedTemplate: structuredClone(wideJournal) });
  Object.assign(art.artboard, templateSize(wideJournal.id));
  art.artboard.physicalHeightMm = 150 / 1.8;
  art.metadata = { title: '海边的片刻', date: '2026-07-21', message: '带着海风回来。' };
  art.frozenPhotoBindings = Array.from({ length: photoCount }, (_, i) => ({ photoId: `p${i}`, assetId: String(i).repeat(64), width: 1200, height: 800, name: `Photo ${i}` }));
  return art;
}

describe('declarative style integration and immutable versions', () => {
  it('turns the example into a complete immutable drawing and map palette', () => {
    const manifest = structuredClone(seaGlass), style = installDesignManifest(manifest);
    expect(style.id).toBe(seaGlass.id);
    const resolved = getStyle(seaGlass.id, 'default', '1.0.0');
    expect(Object.isFrozen(resolved)).toBe(true); expect(Object.isFrozen(resolved.palettes[0])).toBe(true);
    expect(resolved.palette.paper).toBe('#f2f5ed'); expect(resolved.palette.route).toBe('#dc815d');
    expect(resolved.palette.label).toBe(resolved.palette.ink); expect(resolved.palette.roadCase).toBe(resolved.palette.paper);
    expect(Object.values(mapRecipe(seaGlass.id)).filter(value => value === undefined)).toEqual([]);
    expect(resolved.font).toContain('Noto Sans SC');
    manifest.recipe.palette.paper = '#000000'; expect(resolved.palette.paper).toBe('#f2f5ed');
    expect(() => { resolved.palette.paper = '#000000'; }).toThrow();
    expect(Object.isFrozen(STYLES)).toBe(true);
  });
  it('retains exact versions and refuses same-version replacement', () => {
    const v1 = { ...structuredClone(seaGlass), id: 'test.versioned-style' };
    installDesignManifest(v1);
    const v2 = { ...structuredClone(v1), version: '2.0.0' }; v2.recipe.palette.paper = '#eeeeee'; installDesignManifest(v2);
    expect(getStyle(v1.id).version).toBe('2.0.0'); expect(getStyle(v1.id, undefined, v1.version).palette.paper).toBe(v1.recipe.palette.paper);
    expect(installDesignManifest(structuredClone(v1)).version).toBe('1.0.0');
    const changed = structuredClone(v1); changed.recipe.palette.water = '#ffffff';
    expect(() => installDesignManifest(changed)).toThrow('同版本');
    expect(() => getStyle(v1.id, undefined, '9.0.0')).toThrow('缺少风格');
    expect(STYLES.filter(style => style.id === v1.id)).toHaveLength(1);
  });
  it('resolves an uninstalled embedded style without changing the global registry', () => {
    const embedded = { ...structuredClone(seaGlass), id: 'test.portable-style', version: '3.1.0' };
    const art = createArtwork(undefined, 'frozen', { styleId: embedded.id, styleVersion: embedded.version, paletteId: 'default', embeddedStyle: embedded });
    const before = STYLES.length; expect(resolveStyle(art).palette.water).toBe('#a7d2cc'); expect(STYLES.length).toBe(before);
    expect(mapRecipe(art.styleId, art.paletteId, art.styleVersion, art.embeddedStyle).water).toBe('#a7d2cc');
    art.styleVersion = '4.0.0'; expect(() => resolveStyle(art)).toThrow('版本不一致');
  });
  it('embeds every built-in palette and layout recipe without changing built-in output', () => {
    for (const style of STYLES.filter(style => !style.id.includes('.'))) {
      const snapshot = getDesignManifest('style', style.id, style.version); installDesignManifest(snapshot);
      for (const palette of style.palettes) {
        const art = createArtwork(undefined, 'trip', { styleId: style.id, styleVersion: style.version, paletteId: palette.id, embeddedStyle: snapshot });
        expect(resolveStyle(art)).toEqual(getStyle(style.id, palette.id, style.version));
      }
    }
    for (const template of TEMPLATES.filter(template => template.family !== 'extension')) {
      const art = createArtwork(undefined, 'trip', { templateId: template.id, templateVersion: template.version }); Object.assign(art.artboard, templateSize(template.id));
      const before = solveLayout(art).nodes; art.embeddedTemplate = getDesignManifest('template', template.id, template.version); installDesignManifest(art.embeddedTemplate);
      expect(resolveTemplate(art).ratio).toEqual(template.ratio); expect(solveLayout(art).nodes).toEqual(before);
    }
  });
});

describe('functional normalized template slots', () => {
  it.each([0, 1, 2])('renders the wide-journal recipe with %i photos and retained metadata', count => {
    const art = artwork(count), proposal = solveLayout(art);
    expect(proposal.conflicts).toEqual([]);
    const solved = applyLayoutProposal(art, proposal), map = solved.nodes.find(node => node.kind === 'map')!;
    expect(map.transform).toEqual({ x: .04 * art.artboard.width, y: .14 * art.artboard.height, width: .58 * art.artboard.width, height: .7 * art.artboard.height, rotation: 0 });
    const photos = solved.nodes.filter(node => node.kind === 'photo' && node.visible);
    expect(photos).toHaveLength(count);
    for (let i = 0; i < photos.length; i++) {
      const slot = wideJournal.recipe.slots.filter(slot => slot.kind === 'photo')[i];
      expect(photos[i].transform).toEqual({ x: slot.x * art.artboard.width, y: slot.y * art.artboard.height, width: slot.width * art.artboard.width, height: slot.height * art.artboard.height, rotation: 0 });
    }
    for (const role of ['title', 'date', 'message']) expect(solved.nodes.find(node => node.role === role)?.visible).toBe(true);
    const attribution = solved.nodes.find(node => node.kind === 'attribution')!;
    expect(attribution.transform.y).toBe(.9 * art.artboard.height); expect(attribution.locked).toBe(true);
    expect(getTemplate(wideJournal.id).slots).toHaveLength(5);
    expect(Object.isFrozen(getTemplate(wideJournal.id).slots)).toBe(true);
  });
  it('reports capacity before applying and retains every frozen photo', () => {
    const art = artwork(3), before = structuredClone(art), proposal = solveLayout(art);
    expect(proposal.conflicts.some(conflict => conflict.code === 'TEMPLATE_CAPACITY')).toBe(true);
    expect(proposal.nodes.filter(node => node.kind === 'photo')).toHaveLength(3);
    expect(() => applyLayoutProposal(art, proposal)).toThrow('照片槽位'); expect(art).toEqual(before);
    art.layout.photoCapacity = 2; expect(solveLayout(art).conflicts).toEqual([]);
  });
  it('keeps photo crop and position constraints through extension group toggles', () => {
    let art = artwork(); art = applyLayoutProposal(art, solveLayout(art));
    const photo = art.nodes.find(node => node.kind === 'photo')!; photo.crop = { x: .25, y: .7, zoom: 2, rotation: 0 }; photo.constraint = { position: 'pinned', size: 'fixed', crop: 'fixed' };
    const before = structuredClone(photo);
    art.visibility.photos = false; art = applyLayoutProposal(art, solveLayout(art));
    art.visibility.photos = true; art = applyLayoutProposal(art, solveLayout(art));
    const restored = art.nodes.find(node => node.id === before.id)!;
    expect(restored.crop).toEqual(before.crop); expect(restored.transform).toEqual(before.transform); expect(restored.visible).toBe(true);
  });
  it('reports fixed text overflow and attribution obstruction', () => {
    const art = artwork(); art.metadata.title = '标题'.repeat(60);
    expect(solveLayout(art).conflicts.some(conflict => conflict.code === 'TEXT_OVERFLOW')).toBe(true);
    const valid = artwork(); let solved = applyLayoutProposal(valid, solveLayout(valid));
    const photo = solved.nodes.find(node => node.kind === 'photo')!, attribution = solved.nodes.find(node => node.kind === 'attribution')!;
    photo.transform = { ...attribution.transform }; photo.constraint.position = 'pinned'; photo.constraint.size = 'fixed';
    expect(solveLayout(solved).conflicts.some(conflict => conflict.code === 'ATTRIBUTION_COLLISION')).toBe(true);
  });
});

describe('design trust boundary', () => {
  it('rejects prototype data, accessors, scripts, external resources and non-finite numbers', () => {
    expect(() => installDesignManifest(JSON.parse(JSON.stringify(seaGlass).replace('"recipe":', '"__proto__":{},"recipe":')))).toThrow();
    let called = false; const access = { ...seaGlass, get recipe() { called = true; return seaGlass.recipe; } };
    expect(() => installDesignManifest(access)).toThrow('访问器'); expect(called).toBe(false);
    for (const extra of [{ script: 'alert(1)' }, { font: 'https://example.org/font.woff' }, { roadWidth: NaN }]) expect(() => installDesignManifest({ ...structuredClone(seaGlass), id: 'test.invalid-style', recipe: { ...seaGlass.recipe, ...extra } })).toThrow();
    expect(() => installDesignManifest({ ...structuredClone(seaGlass), id: 'test.invalid-style', permissions: ['network-map-data'] })).toThrow('网络权限');
  });
  it('rejects missing attribution, duplicate ids, empty dimensions and content overlap', () => {
    const test = (slots: unknown[]) => installDesignManifest({ ...structuredClone(wideJournal), id: 'test.invalid-template', recipe: { aspectRatio: 1.8, slots } });
    const slots = structuredClone(wideJournal.recipe.slots);
    expect(() => test(slots.filter(slot => slot.kind !== 'attribution'))).toThrow('署名');
    expect(() => test([...slots, slots[0]])).toThrow('重复');
    expect(() => test(slots.map(slot => slot.kind === 'map' ? { ...slot, width: 0 } : slot))).toThrow();
    expect(() => test(slots.map(slot => slot.kind === 'attribution' ? { ...slot, y: .7 } : slot))).toThrow('重叠');
  });
  it('refuses same-version built-in substitutions while permitting exact portable copies', () => {
    const snapshot = getDesignManifest('style', 'ink', '1.0.0');
    expect(installDesignManifest(snapshot).id).toBe('ink');
    const changed = structuredClone(snapshot); changed.name = 'replacement';
    expect(() => installDesignManifest(changed)).toThrow('同版本');
    expect(() => getDesignManifest('style', 'missing.extension', '1.0.0')).toThrow();
  });
});
