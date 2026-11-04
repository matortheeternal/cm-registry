import * as accessRequests from '../database/accessRequests.js';
import * as auditEvents from '../database/auditEvents.js';
import * as publisherKeys from '../database/publisherKeys.js';
import { transaction } from '../database/connection.js';
import { z } from 'zod';
import { activePublisher, publicIdentity } from '../auth.js';
import { jsonBody } from '../http.js';
import {
    InvalidNewKeyProof,
    KeyAlreadyAssociatedWithApplication,
    PublishingKeyNotFound
} from '../errors.js';

const keySchema = z.object({
    publicKey: z.string().max(100),
    proof: z.string().max(200),
    label: z.string().max(100).default('')
}).strict();

async function verify(publisherId, publicKey, proof) {
    const identity = await publicIdentity(publicKey);
    const challengeText = `cm-registry:add-key:${publisherId}:${identity.fingerprint}`;
    const challenge = new TextEncoder().encode(challengeText);
    const proofBuffer = Buffer.from(proof, 'base64');
    const verified = await crypto.subtle.verify('Ed25519', identity.key, proofBuffer, challenge);
    if (!verified) throw new InvalidNewKeyProof();
    return identity;
}

export function registerKeysRoutes(app, { signed, publisher }) {
    app.use('/v1/keys/*', signed, publisher);
    app.post('/v1/keys', async context => {
        const details = jsonBody(context, keySchema);
        const publisherId = context.get('publisherId');
        const identity = await verify(publisherId, details.publicKey, details.proof);
        return transaction(() => {
            const publisherId = activePublisher(context.get('fingerprint'));
            if (accessRequests.exists(identity.fingerprint))
                throw new KeyAlreadyAssociatedWithApplication();
            publisherKeys.create({
                fingerprint: identity.fingerprint,
                publisherId,
                publicKey: details.publicKey,
                label: details.label
            });
            auditEvents.record(publisherId, 'key.add', identity.fingerprint);
            return context.json({ fingerprint: identity.fingerprint }, 201);
        });
    });

    app.post('/v1/keys/:fingerprint/revoke', context =>
        transaction(() => {
            const publisherId = activePublisher(context.get('fingerprint'));
            const key = publisherKeys.findOwned(
                context.req.param('fingerprint'),
                publisherId
            );
            if (!key) throw new PublishingKeyNotFound();
            publisherKeys.revoke({ revoked: Date.now(), fingerprint: key.fingerprint });
            auditEvents.record(publisherId, 'key.revoke', key.fingerprint);
            return context.json({ revoked: true });
        })
    );
}
