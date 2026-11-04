import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { inspectPackage, versionOf } from '../src/package.js';
import { archive } from './helpers.js';
const text = s => new TextEncoder().encode(s);
const base = { 'games/demo/game.json': text('{"id":"demo","version":"1.0.0"}') };
function bad(entries, code) {
    assert.throws(
        () => inspectPackage(zipSync(entries)),
        e => !code || e.code === code
    );
}
test('supports all four existing extension types, legacy versions and compatibility metadata', () => {
    for (const type of ['game', 'cardpart', 'template', 'exporter']) {
        const r = inspectPackage(
            archive('magic/M15/Card', '0.1', type, { compatibility: { app: '>=0.1.0' } })
        );
        assert.equal(r.type, type);
        assert.equal(r.version, '0.1.0');
        assert.equal(r.metadata.compatibility.app, '>=0.1.0');
    }
    for (const version of ['1', 'v1.0.0', '1.02', '1.0.0.0', 'nonsense'])
        assert.throws(() => versionOf(version));
    assert.equal(versionOf('1.0.0-beta.1'), '1.0.0-beta.1');
});
test('rejects traversal, absolute paths, wrong roots, multi-extension archives, executable content', () => {
    for (const name of [
        '../escape',
        '/escape',
        'games/demo/../escape',
        'games\\demo\\x',
        'C:/escape',
        'games/demo//escape',
        'games/demo/NUL.txt',
        'games/demo/trailing.',
        'games/demo/control\nname'
    ])
        bad({ ...base, [name]: text('x') }, 'archive_path');
    bad({ ...base, 'elsewhere/file': text('x') }, 'package_root');
    bad(
        { ...base, 'games/other/game.json': text('{"id":"other","version":"1.0.0"}') },
        'manifest'
    );
    bad({ ...base, 'games/demo/payload.exe': text('x') }, 'executable');
    bad({ 'games/demo/game.json': text('{"id":"demo","version":1}') }, 'invalid_package');
    bad({ 'games/demo/game.json': text('invalid JSON') }, 'invalid_package');
    bad({ 'games/demo/a.js': text('x') }, 'manifest');
});
test('rejects expansion bombs, duplicate entries, mismatched local headers, symlinks, corrupt ZIPs', () => {
    bad(
        { ...base, 'games/demo/bomb': new Uint8Array(2 * 1024 * 1024) },
        'archive_expansion'
    );
    const bytes = Buffer.from(archive());
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const symlink = Buffer.from(bytes);
    symlink.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38);
    assert.throws(
        () => inspectPackage(symlink),
        e => e.code === 'symlink'
    );
    const mismatch = Buffer.from(bytes);
    mismatch[30] ^= 1;
    assert.throws(
        () => inspectPackage(mismatch),
        e => e.code === 'archive'
    );
    const equalNames = Buffer.from(
        zipSync({
            ...base,
            'games/demo/aaaa.js': text('a'),
            'games/demo/bbbb.js': text('b')
        })
    );
    const needle = Buffer.from('games/demo/bbbb.js');
    const replacement = Buffer.from('games/demo/aaaa.js');
    let pos = 0;
    while ((pos = equalNames.indexOf(needle, pos)) !== -1) {
        replacement.copy(equalNames, pos);
        pos += replacement.length;
    }
    assert.throws(
        () => inspectPackage(equalNames),
        e => e.code === 'archive_path'
    );
    for (const b of [new Uint8Array(), bytes.subarray(0, bytes.length - 10)])
        assert.throws(() => inspectPackage(b));
});

test('rejects corrupt file payload even when ZIP structure is intact', () => {
    const bytes = Buffer.from(
        zipSync(
            { 'games/demo/game.json': text('{"id":"demo","version":"1.0.0"}') },
            { level: 0 }
        )
    );
    const offset = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
    bytes[offset] ^= 1;
    assert.throws(
        () => inspectPackage(bytes),
        e => e.code === 'archive_checksum'
    );
});
