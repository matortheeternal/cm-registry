// Real ZIP fixtures with small payloads. Never generate a full-size bomb.
import { zipSync } from 'fflate';
import { crc32 } from 'node:zlib';

const encode = text => new TextEncoder().encode(text);
const manifest = encode(JSON.stringify({ id: 'demo', version: '1.0.0' }));
export const sizeLimit = 300 * 1024 * 1024;
export const manifestLimit = 1024 * 1024;

export function packageWith(entries = {}, options = {}) {
    return Buffer.from(
        zipSync({ 'games/demo/game.json': manifest, ...entries }, options)
    );
}

export function directoryEntries(bytes) {
    const end = bytes.length - 22;
    let offset = bytes.readUInt32LE(end + 16);
    const entries = [];
    for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
        const nameLength = bytes.readUInt16LE(offset + 28);
        entries.push({
            directory: offset,
            local: bytes.readUInt32LE(offset + 42),
            name: bytes.subarray(offset + 46, offset + 46 + nameLength).toString()
        });
        offset
            += 46
            + nameLength
            + bytes.readUInt16LE(offset + 30)
            + bytes.readUInt16LE(offset + 32);
    }
    return entries;
}

function payloadEntry(bytes) {
    return directoryEntries(bytes).find(entry => entry.name !== 'games/demo/game.json');
}

function setSize(bytes, entry, size) {
    bytes.writeUInt32LE(size, entry.directory + 24);
    bytes.writeUInt32LE(size, entry.local + 22);
}

export function forgedSize() {
    const payload = Buffer.alloc(2 * 1024 * 1024, 65);
    const bytes = packageWith({ 'games/demo/main.js': payload });
    const entry = payloadEntry(bytes);
    setSize(bytes, entry, 1024);
    const prefixCRC = crc32(payload.subarray(0, 1024));
    bytes.writeUInt32LE(prefixCRC, entry.directory + 16);
    bytes.writeUInt32LE(prefixCRC, entry.local + 14);
    return bytes;
}

export function forgedManifest() {
    const payload = Buffer.alloc(2 * 1024 * 1024, 32);
    Buffer.from(manifest).copy(payload);
    const bytes = Buffer.from(zipSync({ 'games/demo/game.json': payload }));
    const entry = directoryEntries(bytes)[0];
    setSize(bytes, entry, manifest.length);
    const prefixCRC = crc32(manifest);
    bytes.writeUInt32LE(prefixCRC, entry.directory + 16);
    bytes.writeUInt32LE(prefixCRC, entry.local + 14);
    return bytes;
}

export function trailingDeflate() {
    const bytes = packageWith({ 'games/demo/main.js': encode('export default {};') });
    const end = bytes.length - 22;
    const start = bytes.readUInt32LE(end + 16);
    const entry = payloadEntry(bytes);
    const suffix = encode('ignored trailing data');
    const combined = Buffer.concat([
        bytes.subarray(0, start),
        suffix,
        bytes.subarray(start)
    ]);
    const compressedSize = bytes.readUInt32LE(entry.directory + 20) + suffix.length;
    combined.writeUInt32LE(compressedSize, entry.local + 18);
    combined.writeUInt32LE(compressedSize, entry.directory + suffix.length + 20);
    combined.writeUInt32LE(start + suffix.length, combined.length - 6);
    return combined;
}

export function alternateDirectory() {
    const bytes = packageWith({ 'games/demo/main.js': encode('export default {};') });
    const end = bytes.length - 22;
    const start = bytes.readUInt32LE(end + 16);
    const directory = Buffer.from(bytes.subarray(start, end));
    const entry = payloadEntry(bytes);
    // The alternative directory requests only 4 MiB, even on a vulnerable decoder.
    directory.writeUInt32LE(4 * 1024 * 1024, entry.directory - start + 24);
    const alternateEnd = Buffer.from(bytes.subarray(end));
    alternateEnd.writeUInt32LE(bytes.length, 16);
    const comment = Buffer.concat([directory, alternateEnd, Buffer.alloc(32)]);
    const combined = Buffer.concat([bytes, comment]);
    combined.writeUInt16LE(comment.length, end + 20);
    return combined;
}

export function entryCount(count) {
    const entries = {};
    for (let index = 1; index < count; index++)
        entries[`games/demo/assets/${index}.txt`] = new Uint8Array();
    return packageWith(entries, { level: 0 });
}

export function paddedManifest(size) {
    const prefix = '{"id":"demo","version":"1.0.0","padding":"';
    const text = prefix + 'x'.repeat(size - prefix.length - 2) + '"}';
    return Buffer.from(zipSync({ 'games/demo/game.json': encode(text) }, { level: 0 }));
}

export function hostileArchives() {
    const corruptCRC = packageWith(
        { 'games/demo/main.js': encode('safe bytes') },
        { level: 0 }
    );
    const crcEntry = payloadEntry(corruptCRC);
    const payloadOffset
        = crcEntry.local
        + 30
        + corruptCRC.readUInt16LE(crcEntry.local + 26)
        + corruptCRC.readUInt16LE(crcEntry.local + 28);
    corruptCRC[payloadOffset] ^= 1;

    const overlap = packageWith({ 'games/demo/main.js': encode('x') });
    overlap.writeUInt32LE(0, payloadEntry(overlap).directory + 42);
    const symlink = packageWith({ 'games/demo/link': encode('/outside') });
    symlink.writeUInt32LE((0xa1ff << 16) >>> 0, payloadEntry(symlink).directory + 38);
    const oversized = packageWith({ 'games/demo/main.js': encode('x') }, { level: 0 });
    setSize(oversized, payloadEntry(oversized), sizeLimit + 1);
    const inflatedTotal = packageWith(
        { 'games/demo/a': encode('x'), 'games/demo/b': encode('y') },
        { level: 0 }
    );
    for (const entry of directoryEntries(inflatedTotal).slice(1))
        setSize(inflatedTotal, entry, 160 * 1024 * 1024);
    const duplicate = packageWith({
        'games/demo/aaaa': encode('a'),
        'games/demo/bbbb': encode('b')
    });
    let offset = 0;
    while ((offset = duplicate.indexOf('games/demo/bbbb', offset)) !== -1) {
        duplicate.write('games/demo/aaaa', offset);
        offset += 'games/demo/bbbb'.length;
    }
    const zip64 = packageWith({ 'games/demo/main.js': encode('x') });
    zip64.writeUInt32LE(0xffffffff, payloadEntry(zip64).directory + 20);
    zip64.writeUInt32LE(0xffffffff, payloadEntry(zip64).local + 18);
    const malformedDeflate = packageWith({
        'games/demo/main.js': encode('x'.repeat(100))
    });
    const deflateEntry = payloadEntry(malformedDeflate);
    const deflateStart
        = deflateEntry.local + 30 + malformedDeflate.readUInt16LE(deflateEntry.local + 26);
    malformedDeflate[deflateStart] = 7; // Reserved DEFLATE block type.
    const prototypeName = packageWith({ _________: encode('outside root') });
    let nameOffset = 0;
    while ((nameOffset = prototypeName.indexOf('_________', nameOffset)) !== -1) {
        prototypeName.write('__proto__', nameOffset);
        nameOffset += 9;
    }
    const benign = packageWith();
    return [
        { name: 'forged expanded size and prefix CRC', bytes: forgedSize() },
        {
            name: 'forged-small manifest with large decoded suffix',
            bytes: forgedManifest()
        },
        { name: 'trailing data after DEFLATE stream', bytes: trailingDeflate() },
        { name: 'alternate directory in ZIP comment', bytes: alternateDirectory() },
        {
            name: '2 MiB high-ratio expansion bomb',
            bytes: packageWith({ 'games/demo/bomb': Buffer.alloc(2 * 1024 * 1024) })
        },
        { name: '10,001 entries', bytes: entryCount(10001) },
        { name: 'manifest above 1 MiB', bytes: paddedManifest(manifestLimit + 1) },
        { name: 'declared per-file size above 300 MiB', bytes: oversized },
        { name: 'declared total above 300 MiB', bytes: inflatedTotal },
        { name: 'overlapping local entries', bytes: overlap },
        { name: 'duplicate paths', bytes: duplicate },
        { name: 'prototype-named file outside package root', bytes: prototypeName },
        { name: 'symlink entry', bytes: symlink },
        { name: 'ZIP64 sentinel without extra field', bytes: zip64 },
        { name: 'invalid DEFLATE block', bytes: malformedDeflate },
        { name: 'corrupt stored bytes', bytes: corruptCRC },
        { name: 'truncated end record', bytes: benign.subarray(0, benign.length - 10) },
        {
            name: 'directory beyond archive',
            bytes: (() => {
                const bytes = Buffer.from(benign);
                bytes.writeUInt32LE(0xfffffff0, bytes.length - 6);
                return bytes;
            })()
        },
        {
            name: 'traversal',
            bytes: packageWith({ 'games/demo/../../outside': encode('x') })
        },
        {
            name: 'malformed manifest JSON',
            bytes: Buffer.from(zipSync({ 'games/demo/game.json': encode('{not JSON') }))
        }
    ];
}
