import * as auditEvents from '../database/auditEvents.js';
import * as extensionVersions from '../database/extensionVersions.js';
import * as submissionQueries from '../database/submissions.js';
import { transaction } from '../database/connection.js';
import { randomUUID } from 'node:crypto';
import { activePublisher } from '../auth.js';
import { versionOf } from '../package.js';
import { slotSchema } from '../schemas.js';
import { jsonBody } from '../http.js';
import { safeSubmission } from '../submissions.js';
import { sha256 } from '../storage.js';
import {
    IdempotencyConflict,
    SubmissionNotAwaitingUpload,
    SubmissionNotFinalizable,
    SubmissionNotWithdrawable,
    SubmissionQuotaExceeded,
    UploadArtifactMismatch,
    UploadExpired,
    UploadSlotExpired,
    VersionAlreadyReleased
} from '../errors.js';

export function registerSubmissionsRoutes(app, { storage, signed, publisher, submissions }) {
    app.use('/v1/submissions/*', signed, publisher);
    app.post('/v1/submissions', context => createSubmission(context, submissions));
    app.get('/v1/submissions', listSubmissions);
    app.get('/v1/submissions/:id', context => getSubmission(context, submissions));
    app.put('/v1/submissions/:id/artifact',
        context => uploadArtifact(context, storage, submissions));
    app.post('/v1/submissions/:id/finalize',
        context => finalizeSubmission(context, submissions));
    app.post('/v1/submissions/:id/withdraw',
        context => withdrawSubmission(context, submissions));
}

function createSubmission(context, submissions) {
    const details = jsonBody(context, slotSchema);
    details.version = versionOf(details.version);
    return transaction(() => {
        const publisherId = activePublisher(context.get('fingerprint'));
        const requestHash = sha256(JSON.stringify(details));
        const prior = submissionQueries.findRetry(
            publisherId,
            context.req.header('idempotency-key')
        );
        if (prior) {
            if (prior.request_hash !== requestHash) throw new IdempotencyConflict();
            return context.json({
                ...safeSubmission(prior),
                uploadPath: `/v1/submissions/${prior.id}/artifact`
            });
        }
        submissions.checkOwnership(publisherId, details.extensionId, details.type);
        if (extensionVersions.exists(details.extensionId, details.version))
            throw new VersionAlreadyReleased();
        if (submissionQueries.countOutstanding(publisherId) >= 20)
            throw new SubmissionQuotaExceeded();
        const slot = createUploadSlot(publisherId, details, {
            idempotencyKey: context.req.header('idempotency-key'), requestHash
        });
        return context.json(slot, 201);
    });
}

function createUploadSlot(publisherId, details, retry) {
    const id = randomUUID();
    const expires = Date.now() + 3600000;
    submissionQueries.create({
        id,
        publisherId,
        extensionId: details.extensionId,
        version: details.version,
        type: details.type,
        expectedHash: details.sha256,
        size: details.size,
        ...retry,
        expires
    });
    auditEvents.record(publisherId, 'submission.create', id);
    return {
        id,
        state: 'awaiting_upload',
        uploadPath: `/v1/submissions/${id}/artifact`,
        expires
    };
}

function listSubmissions(context) {
    return context.json({
        submissions: submissionQueries
            .listForPublisher(context.get('publisherId'))
            .map(safeSubmission)
    });
}

function getSubmission(context, submissions) {
    return context.json(
        safeSubmission(
            submissions.getOwned(context.get('fingerprint'), context.req.param('id'))
        )
    );
}

function uploadArtifact(context, storage, submissions) {
    return transaction(() => {
        const row = submissions.getOwned(
            context.get('fingerprint'),
            context.req.param('id')
        );
        const bytes = context.get('body');
        if (row.state !== 'awaiting_upload') throw new SubmissionNotAwaitingUpload();
        if (row.expires <= Date.now()) throw new UploadSlotExpired();
        if (bytes.length !== row.size || sha256(bytes) !== row.expected_hash)
            throw new UploadArtifactMismatch();
        storage.put(`staging/${row.id}`, bytes);
        return context.json({ id: row.id, uploaded: true });
    });
}

function finalizeSubmission(context, submissions) {
    return transaction(() => {
        const row = submissions.getOwned(
            context.get('fingerprint'),
            context.req.param('id')
        );
        if (['pending_review', 'approved'].includes(row.state))
            return context.json(safeSubmission(row));
        if (row.state !== 'awaiting_upload') throw new SubmissionNotFinalizable();
        if (row.expires <= Date.now()) throw new UploadExpired();
        const { inspection } = submissions.verifyArtifact(row);
        submissions.checkOwnership(row.publisher_id, row.extension_id, row.type);
        submissionQueries.finalize({
            metadata: JSON.stringify(inspection.metadata),
            verifiedHash: row.expected_hash,
            id: row.id
        });
        auditEvents.record(row.publisher_id, 'submission.finalize', row.id);
        return context.json(safeSubmission(submissionQueries.findById(row.id)));
    });
}

function withdrawSubmission(context, submissions) {
    return transaction(() => {
        const row = submissions.getOwned(
            context.get('fingerprint'),
            context.req.param('id')
        );
        if (!['awaiting_upload', 'pending_review', 'withdrawn'].includes(row.state))
            throw new SubmissionNotWithdrawable();
        submissionQueries.withdraw({ id: row.id });
        auditEvents.record(row.publisher_id, 'submission.withdraw', row.id);
        return context.json({ id: row.id, state: 'withdrawn' });
    });
}
