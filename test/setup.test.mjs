import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../mcp-server.mjs', import.meta.url));
const postinstall = fileURLToPath(new URL('../src/postinstall.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, args, {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: '', Path: '' },
});

test('installation guidance succeeds without native tools and provides recovery commands', () => {
  const response = run([postinstall]);
  assert.equal(response.status, 0, response.stderr);
  assert.equal(response.stderr, '');
  for (const command of ['PANDOC_PATH', 'IMAGEMAGICK_PATH', 'FFMPEG_PATH', 'FFPROBE_PATH', '--doctor', '--setup'])
    assert.ok(response.stdout.includes(command), command);
});

test('setup is available without a workspace or native tools and matches the installation notice', () => {
  const response = run([cli, '--setup']);
  assert.equal(response.status, 0, response.stderr);
  assert.equal(response.stderr, '');
  assert.equal(response.stdout, run([postinstall]).stdout);
});
