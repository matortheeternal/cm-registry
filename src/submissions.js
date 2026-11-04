import * as extensions from './database/extensions.js';
import * as submissionQueries from './database/submissions.js';
import { activePublisher } from './auth.js';
import { inspectPackage } from './package.js';
import { sha256 } from './storage.js';
import {
    ExtensionOwnershipConflict,
    ExtensionReserved,
    ExtensionTypeImmutable,
    StagedArtifactMismatch,
    SubmissionManifestMismatch,
    SubmissionNotFound,
    UploadMissing
} from './errors.js';

export function safeSubmission(row) {
    return {
        id: row.id,
        extensionId: row.extension_id,
        version: row.version,
        type: row.type,
        sha256: row.expected_hash,
        verifiedHash: row.verified_hash,
        size: row.size,
        state: row.state,
        notes: row.notes,
        expires: row.expires,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
}

export class Submissions {
    constructor({ storage }) {
        this.storage = storage;
    }

    getOwned(fingerprint, id) {
        const publisherId = activePublisher(fingerprint);
        const submission = submissionQueries.findById(id);
        if (!submission || submission.publisher_id !== publisherId)
            throw new SubmissionNotFound();
        return submission;
    }

    checkOwnership(publisherId, id, type) {
        validateExtensionOwnership(extensions.findById(id), publisherId, type);
        validateReservationOwnership(submissionQueries.findReservation(id), publisherId, type);
    }

    verifyArtifact(submission) {
        const bytes = this.storage.get(`staging/${submission.id}`);
        if (!bytes) throw new UploadMissing();
        if (
            bytes.length !== submission.size
            || sha256(bytes) !== submission.expected_hash
        )
            throw new StagedArtifactMismatch();
        const inspection = inspectPackage(bytes);
        if (
            inspection.id !== submission.extension_id
            || inspection.type !== submission.type
            || inspection.version !== submission.version
        )
            throw new SubmissionManifestMismatch();
        return { bytes, inspection };
    }
}

function validateExtensionOwnership(extension, publisherId, type) {
    if (!extension) return;
    if (extension.publisher_id !== publisherId) throw new ExtensionOwnershipConflict();
    if (extension.type !== type) throw new ExtensionTypeImmutable();
}

function validateReservationOwnership(reservation, publisherId, type) {
    if (!reservation) return;
    if (reservation.publisher_id !== publisherId) throw new ExtensionReserved();
    if (reservation.type !== type) throw new ExtensionTypeImmutable();
}
