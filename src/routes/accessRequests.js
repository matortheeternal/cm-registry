import * as accessRequests from '../database/accessRequests.js';
import * as auditEvents from '../database/auditEvents.js';
import * as publisherKeys from '../database/publisherKeys.js';
import { transaction } from '../database/connection.js';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../auth.js';
import { applicationSchema } from '../schemas.js';
import { jsonBody, rate } from '../http.js';
import {
    AccessRequestNotFound,
    ApplicationQueueFull,
    KeyAlreadyRegistered,
    PublishingKeyRevoked
} from '../errors.js';

export function registerAccessRequestsRoutes(app, { signed }) {
    app.post('/v1/access-requests', async context => {
        // The local server supplies the socket address; never trust client forwarding headers.
        rate('applications:global', 20);
        const details = jsonBody(context, applicationSchema);
        const fingerprint = await authenticate(
            context.req.raw,
            context.get('body'),
            details.publicKey
        );
        return transaction(() => {
            const previous = accessRequests.findSummary(fingerprint);
            if (previous) return context.json(previous);
            if (publisherKeys.exists(fingerprint)) throw new KeyAlreadyRegistered();
            if (accessRequests.countPending() >= 500) throw new ApplicationQueueFull();
            const id = randomUUID();
            accessRequests.create({
                id,
                fingerprint,
                publicKey: details.publicKey,
                displayName: details.displayName,
                email: details.email ?? null,
                description: details.description
            });
            auditEvents.record(fingerprint, 'access.request', id);
            return context.json({ id, state: 'pending' }, 201);
        });
    });

    app.get('/v1/access-requests/:id', signed, context => {
        const row = accessRequests.findStatus(
            context.req.param('id'),
            context.get('fingerprint')
        );
        if (!row) throw new AccessRequestNotFound();
        const key = publisherKeys.findRevocation(context.get('fingerprint'));
        if (key?.revoked) throw new PublishingKeyRevoked();
        return context.json(row);
    });
}
