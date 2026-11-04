import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();
let defaultDatabase;

export function setDefaultDatabase(database) {
    if (defaultDatabase && defaultDatabase !== database)
        throw new Error('The default database is already initialized.');
    defaultDatabase = database;
}

export function clearDefaultDatabase(database) {
    if (defaultDatabase === database) defaultDatabase = undefined;
}

export function getDatabase() {
    const database = scope.getStore() ?? defaultDatabase;
    if (!database) throw new Error('Initialize the database before querying it.');
    return database;
}

// An app binds its connection once; awaits retain that scope without changing globals.
export function withDatabase(database, action) {
    return scope.run(database, action);
}

export function transaction(action) {
    return getDatabase().transaction(action);
}
