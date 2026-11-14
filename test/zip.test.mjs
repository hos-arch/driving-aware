import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipParts } from '../js/zip.js';

test('crc32: 既知の値と一致する', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zipParts: 別の道具（python の zipfile）で開けて、中身が同じ', () => {
  const files = [
    { name: 'a/0001.jpg', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: 'labels.json', data: new TextEncoder().encode('{"人":1}') },
    { name: 'empty.bin', data: new Uint8Array(0) },
  ];
  const zip = Buffer.concat(zipParts(files).map((p) => Buffer.from(p)));
  const path = join(mkdtempSync(join(tmpdir(), 'zip-')), 't.zip');
  writeFileSync(path, zip);
  const code =
    'import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({n:list(z.read(n)) for n in z.namelist()}))';
  const got = JSON.parse(execFileSync('python3', ['-c', code, path], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(got), files.map((f) => f.name));
  for (const f of files) assert.deepEqual(got[f.name], [...f.data]);
});
