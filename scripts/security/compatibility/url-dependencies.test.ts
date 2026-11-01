import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

function runNode(source: string) {
  // A subprocess timeout bounds CPU regressions that would otherwise hang Vitest.
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 2000,
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

it('keeps the CommonJS query-string API with valid and malformed URL values', () => {
  expect(
    runNode(`
    const query = require('query-string');
    console.log(JSON.stringify({
      parsed: query.parse('name=Ada+Lovelace&unicode=%E2%9C%93&literal=%2B&broken=%E0%A4%A'),
      encoded: query.stringify({ name: 'Ada Lovelace', unicode: '✓' }),
      oneLevel: query.parse('value=%25C2%zz').value
    }));
  `)
  ).toEqual({
    parsed: {
      name: 'Ada Lovelace',
      unicode: '✓',
      literal: '+',
      broken: '%E0%A4%A',
    },
    encoded: 'name=Ada%20Lovelace&unicode=%E2%9C%93',
    oneLevel: '%C2%zz',
  })
})

it('decodes many distinct malformed runs without blocking the event loop', () => {
  expect(
    runNode(`
    const query = require('query-string');
    let payload = '';
    for (let i = 0; i < 32000; i++) {
      payload += '%' + Math.floor(i / 256).toString(16).padStart(2, '0')
        + '%' + (i % 256).toString(16).padStart(2, '0') + 'x';
    }
    const value = query.parse('value=' + payload + '%zz').value;
    console.log(JSON.stringify({ complete: value.endsWith('%zz') }));
  `)
  ).toEqual({ complete: true })
})

it('strips cross-realm custom credentials on cross-origin redirects for object and array headers', () => {
  expect(
    runNode(`
    const http = require('node:http');
    const vm = require('node:vm');
    const redirects = require('follow-redirects');
    const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const received = [];
    const target = http.createServer((req, res) => {
      received.push({ credential: req.headers['x-api-key'] ?? null, harmless: req.headers['x-harmless'] });
      res.end('ok');
    });
    const source = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'http://127.0.0.1:' + target.address().port });
      res.end();
    });
    (async () => {
      try {
        await listen(target);
        await listen(source);
        for (const headers of [
          { 'X-API-Key': 'test-only-value', 'X-Harmless': 'kept' },
          ['X-API-Key', 'test-only-value', 'X-Harmless', 'kept']
        ]) {
          await new Promise((resolve, reject) => {
            redirects.http.get('http://127.0.0.1:' + source.address().port + '/', {
              sensitiveHeaders: vm.runInNewContext("['X-API-Key']"), headers
            }, res => { res.resume(); res.on('end', resolve); }).on('error', reject);
          });
        }
        console.log(JSON.stringify(received));
      } finally { source.close(); target.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `)
  ).toEqual([
    { credential: null, harmless: 'kept' },
    { credential: null, harmless: 'kept' },
  ])
})
