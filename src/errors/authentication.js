import { Problem } from './Problem.js';

export class InvalidPublicKey extends Problem {
    constructor() {
        super(400, 'public_key', 'Expected a base64 raw Ed25519 public key');
    }
}

export class BodyDigestMismatch extends Problem {
    constructor() {
        super(401, 'invalid_signature', 'Body digest does not match');
    }
}

export class InvalidIdempotencyKey extends Problem {
    constructor() {
        super(
            400,
            'idempotency_key',
            'A signed idempotency-key of 8–128 characters is required'
        );
    }
}

export class NonceAlreadyUsed extends Problem {
    constructor() {
        super(401, 'replay', 'Nonce already used; retry with a fresh signature');
    }
}

export class InvalidRequestSignature extends Problem {
    constructor() {
        super(401, 'invalid_signature', 'Invalid, unknown, or expired request signature');
    }
}

export class PublishingAccessUnavailable extends Problem {
    constructor(state = 'unknown') {
        super(403, `access_${state}`, `Publishing access is ${state}`);
    }
}

export class PublishingKeyRevoked extends Problem {
    constructor() {
        super(403, 'key_revoked', 'Publishing key has been revoked');
    }
}

export class PublisherSuspended extends Problem {
    constructor() {
        super(403, 'publisher_suspended', 'Publisher is suspended');
    }
}

export class InvalidKeyDirectory extends Problem {
    constructor() {
        super(400, 'key_directory', 'Key directory must be a real directory');
    }
}

export class InvalidKeyFile extends Problem {
    constructor() {
        super(400, 'key_file', 'Key must be a regular file');
    }
}

export class KeyPairMismatch extends Problem {
    constructor() {
        super(400, 'key_pair', 'Stored key pair does not match');
    }
}

export class KeyAlreadyRegistered extends Problem {
    constructor() {
        super(409, 'key_registered', 'Key is already registered');
    }
}

export class ApplicationQueueFull extends Problem {
    constructor() {
        super(429, 'pending_limit', 'Application queue is full');
    }
}

export class AccessRequestNotFound extends Problem {
    constructor() {
        super(404, 'request_not_found', 'Access request not found');
    }
}

export class ReviewRequestNotFound extends Problem {
    constructor() {
        super(404, 'request_not_found', 'Request not found');
    }
}

export class ApplicationAlreadyReviewed extends Problem {
    constructor() {
        super(409, 'request_state', 'Application has already been reviewed');
    }
}

export class PublisherNotFound extends Problem {
    constructor() {
        super(404, 'publisher_not_found', 'Publisher not found');
    }
}

export class PublishingKeyNotFound extends Problem {
    constructor() {
        super(404, 'key_not_found', 'Key not found');
    }
}

export class KeyAssociatedWithApplication extends Problem {
    constructor() {
        super(409, 'key_registered', 'Key is associated with an application');
    }
}

export class InvalidNewKeyProof extends Problem {
    constructor() {
        super(401, 'new_key_proof', 'New key possession proof is invalid');
    }
}

export class KeyAlreadyAssociatedWithApplication extends Problem {
    constructor() {
        super(409, 'key_registered', 'Key is already associated with an application');
    }
}
