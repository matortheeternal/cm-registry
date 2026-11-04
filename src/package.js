import semver from 'semver';
import { z } from 'zod';
import {
    InvalidPackage,
    InvalidPackageRoot,
    InvalidSemanticVersion,
    ManifestTooLarge,
    Problem,
    SingleManifestRequired,
    VersionMustBeString
} from './errors.js';
import ZipArchive from './packages/ZipArchive.js';
import { packageLimits } from './packages/limits.js';

export const MAX_PACKAGE = packageLimits.archive;
const idExpr = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export const idSchema = z.string().max(180).regex(idExpr);
export const typeSchema = z.enum(['cardpart', 'exporter', 'template', 'game']);

const manifests = {
    'module.json': { type: 'cardpart', folder: 'cardparts' },
    'exporter.json': { type: 'exporter', folder: 'exporters' },
    'template.json': { type: 'template', folder: 'templates' },
    'game.json': { type: 'game', folder: 'games' }
};
const metadataSchema = z
    .object({
        id: idSchema,
        version: z.string().max(80),
        name: z.string().max(200).optional(),
        label: z.string().max(200).optional(),
        description: z.string().max(4000).optional(),
        gameId: idSchema.optional(),
        compatibility: z.record(z.string(), z.string().max(200)).optional()
    })
    .passthrough();

export function versionOf(input) {
    if (typeof input !== 'string') throw new VersionMustBeString();
    const version = /^\d+\.\d+$/.test(input) ? `${input}.0` : input;
    if (!semver.valid(version) || version !== semver.valid(version))
        throw new InvalidSemanticVersion();
    return version;
}

function readManifest(files) {
    const candidates = Object.keys(files).filter(path =>
        Object.hasOwn(manifests, path.split('/').at(-1))
    );
    if (candidates.length !== 1) throw new SingleManifestRequired();
    const path = candidates[0];
    const filename = path.split('/').at(-1);
    const { type, folder } = manifests[filename];
    if (files[path].length > packageLimits.manifest) throw new ManifestTooLarge();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(files[path]);
    const metadata = metadataSchema.parse(JSON.parse(text));
    return { path, filename, type, folder, metadata };
}

function validatePackageRoot(manifest, paths) {
    const { metadata, folder, filename } = manifest;
    const gamePrefix = metadata.gameId ? metadata.gameId + '/' : '';
    const root = `${gamePrefix}${folder}/${metadata.id}/`;
    if (manifest.path !== root + filename || !paths.every(path => path.startsWith(root)))
        throw new InvalidPackageRoot();
}

export function inspectPackage(input) {
    try {
        const archive = new ZipArchive(input, MAX_PACKAGE);
        const files = archive.extract();
        const manifest = readManifest(files);
        const paths = Object.keys(files);
        validatePackageRoot(manifest, paths);
        return {
            id: manifest.metadata.id,
            type: manifest.type,
            version: versionOf(manifest.metadata.version),
            metadata: manifest.metadata,
            files: paths,
            expandedSize: archive.expandedSize
        };
    } catch (error) {
        if (error instanceof Problem) throw error;
        throw new InvalidPackage();
    }
}
