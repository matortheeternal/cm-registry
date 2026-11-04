import { Problem } from './Problem.js';

export class AdminTokenRequired extends Problem {
    constructor() {
        super(
            500,
            'configuration',
            'A separate admin token of at least 32 characters is required'
        );
    }
}

export class RequestBodyTooLarge extends Problem {
    constructor() {
        super(413, 'body_size', 'Request exceeds size limit');
    }
}

export class JSONContentTypeRequired extends Problem {
    constructor() {
        super(415, 'content_type', 'Expected application/json');
    }
}

export class InvalidJSONBody extends Problem {
    constructor() {
        super(400, 'json', 'Invalid JSON body');
    }
}

export class RateLimitExceeded extends Problem {
    constructor() {
        super(429, 'rate_limit', 'Too many requests; retry in a minute');
    }
}

export class HTTPSRequired extends Problem {
    constructor() {
        super(400, 'https_required', 'HTTPS is required');
    }
}

export class CrossOriginWriteForbidden extends Problem {
    constructor() {
        super(403, 'origin', 'Cross-origin writes are forbidden');
    }
}

export class RemoteAdminUnconfigured extends Problem {
    constructor() {
        super(
            403,
            'admin_unconfigured',
            'Remote administrator authentication is not configured'
        );
    }
}

export class AdminCredentialRequired extends Problem {
    constructor() {
        super(401, 'admin_auth', 'Administrator credential required');
    }
}
