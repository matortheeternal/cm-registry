import * as extensionVersions from '../database/extensionVersions.js';
import * as extensions from '../database/extensions.js';
import * as publishers from '../database/publishers.js';
import * as submissionQueries from '../database/submissions.js';
import { transaction } from '../database/connection.js';
import { z } from 'zod';
import semver from 'semver';
import { notesSchema, hashSchema } from '../schemas.js';
import { jsonBody } from '../http.js';
import { sha256 } from '../storage.js';
import {
    ApprovalPublisherSuspended,
    ArtifactPromotionFailed,
    ReleaseRevocationPermanent,
    ReleaseVersionExists,
    ReviewedHashMismatch,
    SubmissionNotApprovable,
    SubmissionNotFound,
    SubmissionNotRejectable,
    VersionNotFound
} from '../errors.js';

const versionSchema = z.object({
    state: z.enum(['deprecated', 'revoked']),
    notes: z.string().max(4000).default('')
}).strict();

export function registerReviewRoutes(app, { storage, admin, submissions }) {
    app.get('/v1/admin/submissions/:id/artifact',
        context => downloadSubmission(context, submissions));
    app.post('/v1/admin/submissions/:id/reject',
        context => rejectSubmission(context, admin));
    app.post('/v1/admin/submissions/:id/approve',
        context => approveSubmission(context, storage, admin, submissions));
    app.post('/v1/admin/versions/:id/:version', context => setVersionState(context, admin));
}

function downloadSubmission(context, submissions) {
    const row = submissionQueries.findById(context.req.param('id'));
    if (!row) throw new SubmissionNotFound();
    const { bytes } = submissions.verifyArtifact(row);
    return context.body(bytes, 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${row.id}.cmpkg"`
    });
}

function rejectSubmission(context, admin) {
    const { notes } = jsonBody(context, notesSchema);
    return transaction(() => {
        const id = context.req.param('id');
        const row = submissionQueries.findById(id);
        if (!row) throw new SubmissionNotFound();
        if (!['pending_review', 'rejected'].includes(row.state))
            throw new SubmissionNotRejectable();
        submissionQueries.reject({ id, notes, reviewedBy: admin.id });
        admin.audit('submission.reject', id);
        return context.json({ state: 'rejected' });
    });
}

function approveSubmission(context, storage, admin, submissions) {
    const { notes, reviewedHash } = jsonBody(
        context,
        notesSchema.extend({ reviewedHash: hashSchema })
    );
    return transaction(() => {
        const id = context.req.param('id');
        const row = submissionQueries.findById(id);
        if (!row) throw new SubmissionNotFound();
        if (reviewedHash !== row.verified_hash)
            throw new ReviewedHashMismatch();
        if (row.state === 'approved')
            return context.json({ id, state: 'approved' });
        if (row.state !== 'pending_review') throw new SubmissionNotApprovable();
        validateRelease(row, submissions);
        const { bytes, inspection } = submissions.verifyArtifact(row);
        const objectKey = promoteArtifact(storage, row, bytes, reviewedHash);
        recordRelease(row, inspection.metadata, objectKey);
        updateLatestMetadata(row.extension_id);
        submissionQueries.approve({ id, notes, reviewedBy: admin.id });
        admin.audit('submission.approve', id, { sha256: row.expected_hash, notes });
        return context.json({ id, state: 'approved' });
    });
}

function validateRelease(row, submissions) {
    const owner = publishers.findState(row.publisher_id);
    if (owner?.state !== 'active') throw new ApprovalPublisherSuspended();
    submissions.checkOwnership(row.publisher_id, row.extension_id, row.type);
    if (extensionVersions.exists(row.extension_id, row.version))
        throw new ReleaseVersionExists();
}

function promoteArtifact(storage, row, bytes, reviewedHash) {
    const objectKey = `releases/${row.id}`;
    storage.put(objectKey, bytes);
    const promoted = storage.get(objectKey);
    if (!promoted || promoted.length !== row.size || sha256(promoted) !== reviewedHash)
        throw new ArtifactPromotionFailed();
    return objectKey;
}

function recordRelease(row, inspectedMetadata, objectKey) {
    const metadata = JSON.stringify(inspectedMetadata);
    extensions.createIfAbsent({
        id: row.extension_id,
        publisherId: row.publisher_id,
        type: row.type,
        metadata
    });
    extensionVersions.create({
        extensionId: row.extension_id,
        version: row.version,
        submissionId: row.id,
        metadata,
        objectKey,
        sha256: row.expected_hash,
        size: row.size,
        published: Date.now()
    });
}

function updateLatestMetadata(id) {
    // Catalog metadata follows semver precedence, not approval order.
    const latest = extensionVersions.listPublishedMetadata(id)
        .sort((a, b) => semver.rcompare(a.version, b.version))[0];
    extensions.updateMetadata({ metadata: latest.metadata, id });
}

function setVersionState(context, admin) {
    const { state, notes } = jsonBody(context, versionSchema);
    return transaction(() => {
        const id = context.req.param('id');
        const version = context.req.param('version');
        const row = extensionVersions.findState(id, version);
        if (!row) throw new VersionNotFound();
        if (row.state === 'revoked' && state !== 'revoked')
            throw new ReleaseRevocationPermanent();
        extensionVersions.setState({ extensionId: id, state, notes, version });
        admin.audit(`release.${state}`, `${id}@${version}`, { notes });
        return context.json({ state, notes });
    });
}
