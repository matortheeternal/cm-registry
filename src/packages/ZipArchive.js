import { crc32, inflateRawSync } from 'node:zlib';
import {
    ArchiveChecksumMismatch,
    ArchiveEndRecordMissing,
    ArchiveExpansionLimitExceeded,
    ArchiveHeadersDiffer,
    ExecutableNotAllowed,
    InvalidArchiveDirectoryEntry,
    InvalidArchiveSize,
    ManifestTooLarge,
    SpecialArchiveFileNotAllowed,
    TrailingCompressedData,
    UnexpectedArchiveData,
    UnsafeArchivePath,
    UnsupportedArchiveEntries,
    UnsupportedArchiveLayout
} from '../errors.js';
import { packageLimits, manifestFilenames } from './limits.js';

const signatures = {
    endRecord: 0x06054b50,
    directoryEntry: 0x02014b50,
    localEntry: 0x04034b50
};
const headerSizes = { endRecord: 22, directoryEntry: 46, localEntry: 30 };
const limits = {
    comment: 65535,
    entries: packageLimits.entries,
    expanded: packageLimits.expanded,
    file: packageLimits.file,
    expansionRatio: 200,
    expansionAllowance: 1024 * 1024
};
const utf8Flag = 0x800;
const regularFileMode = 0x8000;

function safePathSegment(segment) {
    return (
        segment !== '.'
        && segment !== '..'
        && segment !== ''
        && !/[. ]$/.test(segment)
        && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    );
}

function safePath(name) {
    return (
        name.length <= 500
        && !name.includes('\\')
        && !/[\x00-\x1f\x7f]/.test(name)
        && !name.startsWith('/')
        && !name.includes(':')
        && name.split('/').every(safePathSegment)
    );
}

/** Validate both header sets before decompression; fflate alone loses duplicates. */
export default class ZipArchive {
    constructor(input, maxSize) {
        this.bytes = Buffer.isBuffer(input)
            ? input
            : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        this.entries = new Map();
        this.expandedSize = 0;
        if (this.bytes.length <= headerSizes.endRecord || !(this.bytes.length <= maxSize))
            throw new InvalidArchiveSize();
    }

    findEndRecord() {
        const lastOffset = this.bytes.length - headerSizes.endRecord;
        const firstOffset = Math.max(0, lastOffset - limits.comment);
        for (let offset = lastOffset; offset >= firstOffset; offset--) {
            if (this.bytes.readUInt32LE(offset) !== signatures.endRecord) continue;
            const commentSize = this.bytes.readUInt16LE(offset + 20);
            if (offset + headerSizes.endRecord + commentSize === this.bytes.length)
                return offset;
        }
        throw new ArchiveEndRecordMissing();
    }

    readDirectory() {
        const endOffset = this.findEndRecord();
        const directory = {
            endOffset,
            commentSize: this.bytes.readUInt16LE(endOffset + 20),
            disk: this.bytes.readUInt16LE(endOffset + 4),
            startDisk: this.bytes.readUInt16LE(endOffset + 6),
            diskEntryCount: this.bytes.readUInt16LE(endOffset + 8),
            entryCount: this.bytes.readUInt16LE(endOffset + 10),
            size: this.bytes.readUInt32LE(endOffset + 12),
            offset: this.bytes.readUInt32LE(endOffset + 16)
        };
        if (
            directory.commentSize !== 0
            || directory.entryCount <= 0
            || directory.entryCount > limits.entries
            || directory.disk !== 0
            || directory.startDisk !== 0
            || directory.diskEntryCount !== directory.entryCount
            || directory.offset + directory.size !== endOffset
        )
            throw new UnsupportedArchiveLayout();
        return directory;
    }

    readDirectoryEntry(offset) {
        if (this.bytes.readUInt32LE(offset) !== signatures.directoryEntry)
            throw new InvalidArchiveDirectoryEntry();
        const nameLength = this.bytes.readUInt16LE(offset + 28);
        const extraLength = this.bytes.readUInt16LE(offset + 30);
        const commentLength = this.bytes.readUInt16LE(offset + 32);
        const nameStart = offset + headerSizes.directoryEntry;
        const name = new TextDecoder('utf-8', { fatal: true }).decode(
            this.bytes.subarray(nameStart, nameStart + nameLength)
        );
        return {
            name,
            flags: this.bytes.readUInt16LE(offset + 8),
            method: this.bytes.readUInt16LE(offset + 10),
            crc: this.bytes.readUInt32LE(offset + 16),
            compressedSize: this.bytes.readUInt32LE(offset + 20),
            size: this.bytes.readUInt32LE(offset + 24),
            fileMode: (this.bytes.readUInt32LE(offset + 38) >>> 16) & 0xf000,
            localOffset: this.bytes.readUInt32LE(offset + 42),
            nextOffset: nameStart + nameLength + extraLength + commentLength
        };
    }

    validateEntryPath(entry) {
        const isManifest = manifestFilenames.includes(entry.name.split('/').at(-1));
        if (isManifest && entry.size > packageLimits.manifest)
            throw new ManifestTooLarge();

        if (!safePath(entry.name) || this.entries.has(entry.name))
            throw new UnsafeArchivePath();
        if (/\.(exe|dll|so|dylib|com|bat|cmd|ps1|sh)$/i.test(entry.name))
            throw new ExecutableNotAllowed();
        if (![0, regularFileMode].includes(entry.fileMode))
            throw new SpecialArchiveFileNotAllowed();
    }

    validateLocalEntry(entry, expectedOffset, directoryOffset) {
        const offset = entry.localOffset;
        if (
            (entry.flags & ~utf8Flag) !== 0
            || ![0, 8].includes(entry.method)
            || offset !== expectedOffset
            || offset + headerSizes.localEntry > directoryOffset
            || this.bytes.readUInt32LE(offset) !== signatures.localEntry
        )
            throw new UnsupportedArchiveEntries();

        const local = this.readLocalEntry(offset);
        this.validateMatchingHeaders(local, entry);
        return local.dataStart + entry.compressedSize;
    }

    readLocalEntry(offset) {
        const nameLength = this.bytes.readUInt16LE(offset + 26);
        const extraLength = this.bytes.readUInt16LE(offset + 28);
        const nameStart = offset + headerSizes.localEntry;
        return {
            flags: this.bytes.readUInt16LE(offset + 6),
            method: this.bytes.readUInt16LE(offset + 8),
            crc: this.bytes.readUInt32LE(offset + 14),
            compressedSize: this.bytes.readUInt32LE(offset + 18),
            size: this.bytes.readUInt32LE(offset + 22),
            name: this.bytes.subarray(nameStart, nameStart + nameLength).toString('utf8'),
            dataStart: nameStart + nameLength + extraLength
        };
    }

    validateMatchingHeaders(local, entry) {
        if (
            local.flags !== entry.flags
            || local.method !== entry.method
            || local.crc !== entry.crc
            || local.compressedSize !== entry.compressedSize
            || local.size !== entry.size
            || local.name !== entry.name
        )
            throw new ArchiveHeadersDiffer();
    }

    validateExpansion(entry, localEnd, directoryOffset) {
        this.expandedSize += entry.size;
        const allowedExpansion = Math.max(
            limits.expansionAllowance,
            entry.compressedSize * limits.expansionRatio
        );
        if (
            localEnd > directoryOffset
            || this.expandedSize > limits.expanded
            || entry.size > limits.file
            || entry.size > allowedExpansion
        )
            throw new ArchiveExpansionLimitExceeded();
    }

    validate() {
        const directory = this.readDirectory();
        let cursor = directory.offset;
        let localEnd = 0;
        for (let index = 0; index < directory.entryCount; index++) {
            const entry = this.readDirectoryEntry(cursor);
            this.validateEntryPath(entry);
            localEnd = this.validateLocalEntry(entry, localEnd, directory.offset);
            entry.dataEnd = localEnd;
            entry.dataStart = localEnd - entry.compressedSize;
            this.validateExpansion(entry, localEnd, directory.offset);
            this.entries.set(entry.name, entry);
            cursor = entry.nextOffset;
        }
        if (cursor !== directory.endOffset || localEnd !== directory.offset)
            throw new UnexpectedArchiveData();
    }

    decodeEntry(entry) {
        const compressed = this.bytes.subarray(entry.dataStart, entry.dataEnd);
        if (entry.method === 0) return compressed;
        // Unlike a fixed output buffer, this aborts instead of silently truncating.
        const result = inflateRawSync(compressed, {
            maxOutputLength: entry.size + 1,
            info: true
        });
        if (result.engine.bytesWritten !== entry.compressedSize)
            throw new TrailingCompressedData();
        return result.buffer;
    }

    extract() {
        this.validate();
        const files = Object.create(null);
        for (const [name, entry] of this.entries) {
            const decoded = this.decodeEntry(entry);
            if (decoded.length !== entry.size || crc32(decoded) !== entry.crc)
                throw new ArchiveChecksumMismatch();
            files[name] = decoded;
        }
        return files;
    }
}
