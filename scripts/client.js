import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadOrCreateKey, RegistryClient } from '../src/client.js';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        registry: { type: 'string', default: 'http://127.0.0.1:8787' },
        'key-dir': { type: 'string', default: join(homedir(), '.config', 'cm-registry') },
        name: { type: 'string' },
        description: { type: 'string' },
        email: { type: 'string' }
    }
});

function requestAccess(client) {
    return client.requestAccess({
        displayName: values.name,
        description: values.description,
        ...(values.email ? { email: values.email } : {})
    });
}

function accessStatus(client, key, requestId) {
    if (!requestId) throw new Error('Provide the request ID printed by request-access');
    return client.accessStatus(requestId);
}

function publish(client, key, packagePath) {
    if (!packagePath) throw new Error('Provide a packaged .cmpkg file');
    return client.publish(new Uint8Array(readFileSync(packagePath)));
}

const commands = {
    'request-access': requestAccess,
    'access-status': accessStatus,
    publish,
    'key-show': (client, key) => ({ fingerprint: key.fingerprint, path: key.path })
};
const statusMessages = {
    pending:
        'Application is pending administrator review. Use access-status with '
        + 'the request ID; the same key will work after approval.',
    pending_review:
        'Artifact is private and awaiting human review. '
        + 'No release has been published.'
};
const usage
    = 'Usage: npm run client -- request-access --name NAME --description TEXT '
    + '[--email EMAIL] | access-status REQUEST_ID | publish FILE.cmpkg | key-show '
    + '[--registry ORIGIN] [--key-dir DIRECTORY]';

try {
    const [commandName, argument] = positionals;
    const command = Object.hasOwn(commands, commandName) ? commands[commandName] : null;
    if (!command) throw new Error(usage);
    const key = await loadOrCreateKey(values['key-dir']);
    const client = new RegistryClient({ origin: values.registry, key });
    const result = await command(client, key, argument);
    console.log(JSON.stringify(result, null, 2));
    if (statusMessages[result.state]) console.log(statusMessages[result.state]);
} catch (error) {
    console.error(`${error.code ?? 'client_error'}: ${error.message}`);
    process.exitCode = 1;
}
