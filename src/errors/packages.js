import { Problem } from './Problem.js';

export class VersionMustBeString extends Problem {
    constructor() {
        super(400, 'version', 'Version must be a string');
    }
}

export class InvalidSemanticVersion extends Problem {
    constructor() {
        super(
            400,
            'version',
            'Expected a semantic version (legacy major.minor also accepted)'
        );
    }
}

export class SingleManifestRequired extends Problem {
    constructor() {
        super(400, 'manifest', 'Submit exactly one extension manifest per package');
    }
}

export class ManifestTooLarge extends Problem {
    constructor() {
        super(400, 'manifest', 'Manifest is too large');
    }
}

export class InvalidPackageRoot extends Problem {
    constructor() {
        super(
            400,
            'package_root',
            'Files must belong to the canonical extension directory'
        );
    }
}

export class InvalidPackage extends Problem {
    constructor() {
        super(400, 'invalid_package', 'Malformed ZIP or invalid extension manifest');
    }
}

export class InvalidArchiveSize extends Problem {
    constructor() {
        super(400, 'archive_size', 'Invalid package size');
    }
}

export class ArchiveEndRecordMissing extends Problem {
    constructor() {
        super(400, 'archive', 'ZIP end record missing');
    }
}

export class UnsupportedArchiveLayout extends Problem {
    constructor() {
        super(400, 'archive', 'Unsupported ZIP layout');
    }
}

export class InvalidArchiveDirectoryEntry extends Problem {
    constructor() {
        super(400, 'archive', 'Invalid directory entry');
    }
}

export class UnsafeArchivePath extends Problem {
    constructor() {
        super(400, 'archive_path', 'Unsafe or duplicate archive path');
    }
}

export class ExecutableNotAllowed extends Problem {
    constructor() {
        super(400, 'executable', 'Native executables and shell scripts are not accepted');
    }
}

export class SpecialArchiveFileNotAllowed extends Problem {
    constructor() {
        super(400, 'symlink', 'Symbolic links and special file entries are not accepted');
    }
}

export class UnsupportedArchiveEntries extends Problem {
    constructor() {
        super(400, 'archive', 'Unsupported ZIP features or overlapping entries');
    }
}

export class ArchiveHeadersDiffer extends Problem {
    constructor() {
        super(400, 'archive', 'Local and directory headers differ');
    }
}

export class ArchiveExpansionLimitExceeded extends Problem {
    constructor() {
        super(400, 'archive_expansion', 'Archive expansion limit exceeded');
    }
}

export class UnexpectedArchiveData extends Problem {
    constructor() {
        super(400, 'archive', 'Unexpected archive data');
    }
}

export class TrailingCompressedData extends Problem {
    constructor() {
        super(400, 'archive', 'Unexpected trailing compressed data');
    }
}

export class ArchiveChecksumMismatch extends Problem {
    constructor() {
        super(400, 'archive_checksum', 'Archive entry checksum or size mismatch');
    }
}
