import {
    setDefaultDatabase,
    clearDefaultDatabase,
    withDatabase
} from './database/connection.js';
import * as auditEvents from './database/auditEvents.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, chmodSync } from 'node:fs';

export class Database {
    constructor(filename = ':memory:') {
        this.raw = new DatabaseSync(filename);
        if (filename !== ':memory:') chmodSync(filename, 0o600);
        this.raw.exec(
            'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'
        );
        this.raw.exec(
            readFileSync(
                new URL('../migrations/001-initial.sql', import.meta.url),
                'utf8'
            )
        );
    }

    get(sql, ...params) {
        return this.raw.prepare(sql).get(...params);
    }

    all(sql, ...params) {
        return this.raw.prepare(sql).all(...params);
    }

    run(sql, ...params) {
        return this.raw.prepare(sql).run(...params);
    }

    transaction(fn) {
        this.raw.exec('BEGIN IMMEDIATE');
        try {
            const result = withDatabase(this, fn);
            this.raw.exec('COMMIT');
            return result;
        } catch (error) {
            this.raw.exec('ROLLBACK');
            throw error;
        }
    }

    audit(actor, action, target, details = {}) {
        return withDatabase(this, () =>
            auditEvents.record(actor, action, target, details)
        );
    }

    backup(filename) {
        return this.run('VACUUM INTO ?', filename);
    }

    close() {
        this.raw.close();
        clearDefaultDatabase(this);
    }
}

export function initializeDatabase(filename) {
    const database = new Database(filename);
    try {
        setDefaultDatabase(database);
        return database;
    } catch (error) {
        database.close();
        throw error;
    }
}
