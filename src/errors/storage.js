import { Problem } from './Problem.js';

export class InvalidStorageKey extends Problem {
    constructor() {
        super(500, 'storage_key', 'Invalid storage key');
    }
}

export class ImmutableArtifact extends Problem {
    constructor() {
        super(409, 'immutable_artifact', 'Artifact already exists with different bytes');
    }
}
