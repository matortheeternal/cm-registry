import { Problem } from './Problem.js';

export class ExtensionNotFound extends Problem {
    constructor() {
        super(404, 'extension_not_found', 'Extension not found');
    }
}

export class VersionNotFound extends Problem {
    constructor() {
        super(404, 'version_not_found', 'Version not found');
    }
}

export class PackageNotFound extends Problem {
    constructor() {
        super(404, 'package_not_found', 'Package not found');
    }
}

export class ReleaseArtifactUnavailable extends Problem {
    constructor() {
        super(503, 'artifact_unavailable', 'Release artifact is unavailable');
    }
}

export class SubmissionNotFound extends Problem {
    constructor() {
        super(404, 'submission_not_found', 'Submission not found');
    }
}

export class SubmissionNotRejectable extends Problem {
    constructor() {
        super(409, 'submission_state', 'Only pending submissions can be rejected');
    }
}

export class ReviewedHashMismatch extends Problem {
    constructor() {
        super(409, 'review_hash', 'Reviewed SHA-256 differs from the finalized artifact');
    }
}

export class SubmissionNotApprovable extends Problem {
    constructor() {
        super(409, 'submission_state', 'Only pending submissions can be approved');
    }
}

export class ApprovalPublisherSuspended extends Problem {
    constructor() {
        super(409, 'publisher_suspended', 'Publisher is suspended');
    }
}

export class ReleaseVersionExists extends Problem {
    constructor() {
        super(409, 'duplicate_version', 'Version already exists');
    }
}

export class ArtifactPromotionFailed extends Problem {
    constructor() {
        super(
            503,
            'promotion_failed',
            'Promoted artifact verification failed; retry approval'
        );
    }
}

export class ReleaseRevocationPermanent extends Problem {
    constructor() {
        super(409, 'release_revoked', 'Revocation is permanent');
    }
}

export class IdempotencyConflict extends Problem {
    constructor() {
        super(
            409,
            'idempotency_conflict',
            'Idempotency key was used with different input'
        );
    }
}

export class VersionAlreadyReleased extends Problem {
    constructor() {
        super(409, 'duplicate_version', 'Version has already been released');
    }
}

export class SubmissionQuotaExceeded extends Problem {
    constructor() {
        super(429, 'submission_quota', 'At most 100 submissions may be outstanding');
    }
}

export class SubmissionNotAwaitingUpload extends Problem {
    constructor() {
        super(409, 'submission_state', 'Submission is not awaiting upload');
    }
}

export class UploadSlotExpired extends Problem {
    constructor() {
        super(
            410,
            'upload_expired',
            'Upload authorization expired; withdraw and create a new submission'
        );
    }
}

export class UploadArtifactMismatch extends Problem {
    constructor() {
        super(
            409,
            'artifact_mismatch',
            'Artifact digest or size differs from submission'
        );
    }
}

export class SubmissionNotFinalizable extends Problem {
    constructor() {
        super(409, 'submission_state', 'Submission cannot be finalized');
    }
}

export class UploadExpired extends Problem {
    constructor() {
        super(410, 'upload_expired', 'Upload authorization expired');
    }
}

export class SubmissionNotWithdrawable extends Problem {
    constructor() {
        super(409, 'submission_state', 'Submission cannot be withdrawn');
    }
}

export class ExtensionOwnershipConflict extends Problem {
    constructor() {
        super(403, 'ownership', 'Extension belongs to another publisher');
    }
}

export class ExtensionTypeImmutable extends Problem {
    constructor() {
        super(409, 'extension_type', 'Extension type cannot change');
    }
}

export class ExtensionReserved extends Problem {
    constructor() {
        super(409, 'extension_reserved', 'Extension ID is reserved by another publisher');
    }
}

export class UploadMissing extends Problem {
    constructor() {
        super(409, 'upload_missing', 'Upload the package before finalizing');
    }
}

export class StagedArtifactMismatch extends Problem {
    constructor() {
        super(
            409,
            'artifact_mismatch',
            'Uploaded bytes do not match the submission digest and size'
        );
    }
}

export class SubmissionManifestMismatch extends Problem {
    constructor() {
        super(
            409,
            'manifest_mismatch',
            'Package manifest does not match the requested extension, type, and version'
        );
    }
}
