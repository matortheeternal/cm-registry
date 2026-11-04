import * as extensionVersions from '../database/extensionVersions.js';
import * as extensions from '../database/extensions.js';
import { z } from 'zod';
import semver from 'semver';
import { typeSchema } from '../package.js';
import { sha256 } from '../storage.js';
import {
    ExtensionNotFound,
    PackageNotFound,
    ReleaseArtifactUnavailable,
    VersionNotFound
} from '../errors.js';

export function registerCatalogRoutes(app, { storage }) {
    app.get('/v1/extensions', listExtensions);
    app.get('/v1/extensions/:id', getExtension);
    app.get('/v1/extensions/:id/versions', listVersions);
    app.get('/v1/extensions/:id/versions/:version', getVersion);
    app.get('/v1/packages/:id', context => downloadPackage(context, storage));
}

function cacheJSON(context, data) {
    const body = JSON.stringify(data);
    const etag = `"${sha256(body)}"`;
    context.header('Cache-Control', 'public, max-age=0, must-revalidate');
    context.header('ETag', etag);
    if (context.req.header('if-none-match') === etag) return context.body(null, 304);
    return context.body(body, 200, {
        'Content-Type': 'application/json; charset=utf-8'
    });
}

function publicExtension(id) {
    const extension = extensions.findPublic(id);
    if (!extension) throw new ExtensionNotFound();
    return extension;
}

function publicVersion(context, row) {
    return {
        version: row.version,
        metadata: JSON.parse(row.metadata),
        sha256: row.sha256,
        size: row.size,
        state: row.state,
        published: row.published,
        notes: row.notes,
        downloadUrl:
            row.state === 'revoked'
                ? null
                : `${new URL(context.req.url).origin}/v1/packages/${row.submission_id}`
    };
}

function listExtensions(context) {
    const type = context.req.query('type');
    if (type) typeSchema.parse(type);
    const q = z
        .string()
        .max(200)
        .parse(context.req.query('q') ?? '');
    const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(context.req.query('offset') ?? 0);
    const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(context.req.query('limit') ?? 30);
    const rows = extensions.searchPublished({
        type: type ?? '',
        query: q,
        limit: limit + 1,
        offset
    });
    return cacheJSON(context, {
        extensions: rows
            .slice(0, limit)
            .map(r => ({ id: r.id, type: r.type, metadata: JSON.parse(r.metadata) })),
        nextOffset: rows.length > limit ? offset + limit : null
    });
}

function getExtension(context) {
    const row = publicExtension(context.req.param('id'));
    return cacheJSON(context, {
        id: row.id,
        type: row.type,
        metadata: JSON.parse(row.metadata)
    });
}

function listVersions(context) {
    publicExtension(context.req.param('id'));
    const rows = extensionVersions
        .listForExtension(context.req.param('id'))
        .sort((a, b) => semver.rcompare(a.version, b.version));
    return cacheJSON(context, { versions: rows.map(r => publicVersion(context, r)) });
}

function getVersion(context) {
    const row = extensionVersions.findVersion(
        context.req.param('id'),
        context.req.param('version')
    );
    if (!row) throw new VersionNotFound();
    return cacheJSON(context, publicVersion(context, row));
}

function downloadPackage(context, storage) {
    const row = extensionVersions.findBySubmission(context.req.param('id'));
    if (!row || row.state === 'revoked') throw new PackageNotFound();
    const bytes = storage.get(row.object_key);
    if (!bytes || sha256(bytes) !== row.sha256)
        throw new ReleaseArtifactUnavailable();
    // Revalidate even immutable bytes so revocation takes effect on subsequent requests.
    context.header('Cache-Control', 'public, max-age=0, must-revalidate');
    context.header('ETag', `"${row.sha256}"`);
    if (context.req.header('if-none-match') === `"${row.sha256}"`)
        return context.body(null, 304);
    return context.body(bytes, 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${row.submission_id}.cmpkg"`
    });
}
