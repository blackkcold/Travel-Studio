import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { createTravelServer } from '../server/serve.mjs';

const servers: Server[] = [], directories: string[] = [];
async function start(ai: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), 'travel-server-')); directories.push(directory);
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Travel Studio</title>');
  const server = createTravelServer({ directory, ai: { key: '', ...ai }, fetchImpl }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); })));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
describe('local static server and optional AI boundary', () => {
  it('serves static app with security headers and no secret exposure', async () => {
    const url = await start(); const response = await fetch(url);
    expect(response.status).toBe(200); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('Travel Studio');
    const status = await (await fetch(url + '/api/ai/status')).json(); expect(status.enabled).toBe(false); expect(status).not.toHaveProperty('key');
  });
  it('refuses cross-origin or missing explicit application headers before any upstream call', async () => {
    let called = false; const url = await start({ key: 'not-real-key' }, (async () => { called = true; throw new Error('should not call'); }) as typeof fetch);
    expect((await fetch(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Travel-Studio-Request': '1' } })).status).toBe(403);
    expect((await fetch(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: url } })).status).toBe(403);
    expect(called).toBe(false);
  });
  it('reports missing key without affecting local application', async () => {
    const url = await start();
    const response = await fetch(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: url, 'X-Travel-Studio-Request': '1' } });
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('AI_NOT_CONFIGURED');
    expect((await fetch(url)).status).toBe(200);
  });
  it('rejects non-loopback Host and sensitive/traversal paths', async () => {
    const url = await start();
    const hostStatus = await new Promise<number>((resolve, reject) => { const req = request(url + '/', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!); }); req.on('error', reject); req.end(); });
    expect(hostStatus).toBe(403);
    expect((await fetch(url + '/.env')).status).toBe(400);
    const status = await new Promise<number>((resolve, reject) => { const req = request(url + '/', { path: '/%2e%2e/package.json' }, res => { res.resume(); resolve(res.statusCode!); }); req.on('error', reject); req.end(); });
    expect(status).toBe(400);
  });
  it('rejects arbitrary endpoint/body fields and invalid MIME', async () => {
    let calls = 0; const url = await start({ key: 'not-real-key' }, (async () => { calls++; throw new Error('not expected'); }) as typeof fetch);
    const form = new FormData(); form.set('image', new Blob(['not-an-image']), 'fake.png'); form.set('prompt', 'Style'); form.set('providerId', 'configured-ai'); form.set('inputHash', 'a'.repeat(64)); form.set('url', 'https://evil.example');
    const response = await fetch(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: url, 'X-Travel-Studio-Request': '1' }, body: form });
    expect(response.status).toBe(400); expect(calls).toBe(0);
  });
  it('rejects oversized bodies before parsing multipart or calling the provider', async () => {
    let calls = 0; const url = await start({ key: 'not-real-key' }, (async () => { calls++; throw new Error('not expected'); }) as typeof fetch);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: url, 'X-Travel-Studio-Request': '1', 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '20000001' } }, res => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(413); expect(calls).toBe(0);
  });
  it('returns only validated inline image bytes and configured model', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=', 'base64');
    const url = await start({ key: 'server-only', model: 'test-image' }, (async () => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch);
    const form = new FormData(); form.set('image', new Blob([bytes], { type: 'image/png' }), 'input.png'); form.set('prompt', 'Ink'); form.set('providerId', 'configured-ai'); form.set('inputHash', 'b'.repeat(64));
    const response = await fetch(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: url, 'X-Travel-Studio-Request': '1' }, body: form });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/png'); expect(response.headers.get('x-model')).toBe('test-image'); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
  it('keeps base origin server-configured and rejects result URL fetches', async () => {
    const received: string[] = [];
    const url = await start({ key: 'secret-server-only', baseURL: 'https://provider.example/v1' }, (async (endpoint: string | URL | Request, options?: RequestInit) => {
      received.push(String(endpoint)); expect(options?.redirect).toBe('error'); expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer secret-server-only');
      return new Response(JSON.stringify({ data: [{ url: 'https://untrusted.example/image' }] }), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch);
    const form = new FormData(); form.set('image', new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }), 'input.png'); form.set('prompt', 'Ink'); form.set('providerId', 'configured-ai'); form.set('inputHash', 'b'.repeat(64));
    const response = await fetch(url + '/api/ai/stylize', { method: 'POST', headers: { Origin: url, 'X-Travel-Studio-Request': '1' }, body: form });
    expect(response.status).toBe(502); expect(received).toEqual(['https://provider.example/v1/images/edits']);
    expect(await response.text()).not.toContain('secret-server-only');
  });
  it('rejects HTTP/private configuration immediately', () => {
    expect(() => createTravelServer({ ai: { baseURL: 'http://provider.example' } })).toThrow('HTTPS');
    expect(() => createTravelServer({ ai: { baseURL: 'https://127.0.0.1' } })).toThrow('HTTPS');
  });
});
