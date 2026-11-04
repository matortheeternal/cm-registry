import { getDatabase } from './connection.js';

export function increment({ scope, window }) {
    return getDatabase().get(
        `INSERT INTO rate_limits (scope, window, count)
            VALUES (?, ?, 1)
            ON CONFLICT (scope, window) DO UPDATE
            SET count = count + 1
            RETURNING count`,
        scope,
        window
    );
}

export function pruneBefore({ window }) {
    return getDatabase().run('DELETE FROM rate_limits WHERE window<?', window);
}
