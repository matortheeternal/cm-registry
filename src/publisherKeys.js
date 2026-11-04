import { mkdirSync, lstatSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { publicIdentity } from './auth.js';
import { InvalidKeyDirectory, InvalidKeyFile, KeyPairMismatch } from './errors.js';

function prepareDirectory(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InvalidKeyDirectory();
    chmodSync(directory, 0o700);
}

function readKey(path) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new InvalidKeyFile();
    chmodSync(path, 0o600);
    return JSON.parse(readFileSync(path, 'utf8'));
}

async function generateKey() {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    return {
        publicKey: Buffer.from(
            await crypto.subtle.exportKey('raw', pair.publicKey)
        ).toString('base64'),
        privateKey: Buffer.from(
            await crypto.subtle.exportKey('pkcs8', pair.privateKey)
        ).toString('base64')
    };
}

async function createKey(path) {
    const saved = await generateKey();
    try {
        writeFileSync(path, JSON.stringify(saved) + '\n', { flag: 'wx', mode: 0o600 });
        return saved;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return readKey(path);
    }
}

async function readOrCreateKey(path) {
    try {
        return readKey(path);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return createKey(path);
    }
}

async function importKey(saved, path) {
    const identity = await publicIdentity(saved.publicKey);
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        Buffer.from(saved.privateKey, 'base64'),
        'Ed25519',
        false,
        ['sign']
    );
    const challenge = new TextEncoder().encode('cm-registry:key-pair-check');
    if (
        !(await crypto.subtle.verify(
            'Ed25519',
            identity.key,
            await crypto.subtle.sign('Ed25519', privateKey, challenge),
            challenge
        ))
    )
        throw new KeyPairMismatch();
    return {
        privateKey,
        publicKey: saved.publicKey,
        fingerprint: identity.fingerprint,
        path
    };
}

export async function loadOrCreateKey(directory) {
    directory = resolve(directory);
    prepareDirectory(directory);
    const path = join(directory, 'publishing-key.json');
    return importKey(await readOrCreateKey(path), path);
}
