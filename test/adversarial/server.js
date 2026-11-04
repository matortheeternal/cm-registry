import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signRequest } from '../../src/auth.js';
import { token } from '../helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** A test-only watchdog, not a production resource-isolation architecture. */
export async function startServer(t) {
    const directory = mkdtempSync(join(tmpdir(), 'registry-adversarial-'));
    const child = spawn(process.execPath, ['--max-old-space-size=96', 'src/server.js'], {
        cwd: root,
        env: {
            ...process.env,
            PORT: '0',
            REGISTRY_DATA: directory,
            REGISTRY_ADMIN_TOKEN: token
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let failure;
    let stderr = '';
    let peakRSS = 0;
    child.stderr.on('data', bytes => {
        stderr = (stderr + bytes).slice(-4096);
    });
    const watchdog = setInterval(() => {
        try {
            const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
            const match = status.match(/^VmRSS:\s+(\d+) kB/m);
            if (match) peakRSS = Math.max(peakRSS, Number(match[1]));
            if (peakRSS > 256 * 1024) {
                failure = 'Adversarial server exceeded the 256 MiB test RSS budget';
                child.kill('SIGKILL');
            }
        } catch (error) {
            // /proc is optional. Fixtures remain bounded; the timeout applies everywhere.
            if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
        }
    }, 25);
    const deadline = setTimeout(() => {
        failure = 'Adversarial server exceeded its 30-second test deadline';
        child.kill('SIGKILL');
    }, 30000);
    t.after(async () => {
        clearInterval(watchdog);
        clearTimeout(deadline);
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGKILL');
            await exited;
        }
        rmSync(directory, { recursive: true, force: true });
    });
    const origin = await new Promise((resolve, reject) => {
        const startup = setTimeout(
            () => reject(new Error('Server startup timed out')),
            5000
        );
        child.once('error', error => {
            clearTimeout(startup);
            reject(error);
        });
        child.once('exit', () => {
            clearTimeout(startup);
            reject(new Error(stderr));
        });
        child.stdout.on('data', bytes => {
            const match = bytes.toString().match(/Registry: (http:\/\/127\.0\.0\.1:\d+)/);
            if (!match) return;
            clearTimeout(startup);
            resolve(match[1]);
        });
    });

    async function request(path, { method = 'GET', body, key, admin = false } = {}) {
        if (failure) throw new Error(failure);
        const headers = {};
        if (admin) headers.authorization = 'Bearer ' + token;
        const options = { method, headers };
        if (body !== undefined) {
            const isBinary = body instanceof Uint8Array;
            headers['content-type'] = isBinary
                ? 'application/octet-stream'
                : 'application/json';
            options.body = isBinary ? body : JSON.stringify(body);
        }
        let message = new Request(origin + path, options);
        if (key) message = await signRequest(message, key.privateKey, key.fingerprint);
        const response = await fetch(message, { signal: AbortSignal.timeout(3000) });
        // Consume responses before asserting liveness or ending the subprocess.
        const text = await response.text();
        if (failure) throw new Error(failure);
        return { status: response.status, text, data: text ? JSON.parse(text) : null };
    }
    return { origin, request, child, failure: () => failure, peakRSS: () => peakRSS };
}
