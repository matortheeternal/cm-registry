import { Problem } from './Problem.js';

export class RegistryHTTPSRequired extends Problem {
    constructor() {
        super(
            400,
            'https_required',
            'Registry origin must use HTTPS (loopback HTTP is permitted)'
        );
    }
}

export class InvalidRegistryOrigin extends Problem {
    constructor() {
        super(400, 'registry_origin', 'Expected an origin without path or credentials');
    }
}

export class InvalidRegistryResponse extends Problem {
    constructor(status) {
        super(status, 'registry_response', 'Registry returned an invalid response');
    }
}

export class RegistryRequestFailed extends Problem {
    constructor(status, error) {
        super(
            status,
            error?.code ?? 'registry_error',
            error?.message ?? 'Registry request failed'
        );
    }
}

export class SubmissionRetryUnavailable extends Problem {
    constructor(state) {
        super(
            409,
            'submission_state',
            `Submission is ${state}; inspect its status before retrying`
        );
    }
}
