import * as accessRequests from '../database/accessRequests.js';
import * as auditEvents from '../database/auditEvents.js';
import * as extensionVersions from '../database/extensionVersions.js';
import * as publisherKeys from '../database/publisherKeys.js';
import * as publishers from '../database/publishers.js';
import * as submissionQueries from '../database/submissions.js';
import { transaction } from '../database/connection.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { publicIdentity } from '../auth.js';
import { notesSchema } from '../schemas.js';
import { jsonBody } from '../http.js';
import {
    ApplicationAlreadyReviewed,
    KeyAssociatedWithApplication,
    PublisherNotFound,
    PublishingKeyNotFound,
    ReviewRequestNotFound
} from '../errors.js';
import { adminHTML, adminJS } from '../admin-ui.js';
import { registerReviewRoutes } from './reviews.js';

const JS_CONTENT = {
    'Content-Type': 'text/javascript; charset=utf-8'
};

const stateSchema = z.object({ state: z.enum(['active', 'suspended']) }).strict();
const keySchema = z.object({
    publicKey: z.string().max(100),
    notes: z.string().min(10).max(4000)
}).strict();

export function registerAdminRoutes(app, { storage, admin, submissions }) {
    app.get('/admin', showAdmin);
    app.get('/admin/app.js', showAdminScript);
    app.use('/v1/admin/*', admin.middleware);
    app.get('/v1/admin/overview', overview);
    app.post('/v1/admin/access-requests/:id/approve',
        context => approveApplication(context, admin));
    app.post('/v1/admin/access-requests/:id/reject',
        context => rejectApplication(context, admin));
    app.post('/v1/admin/publishers/:id',
        context => setPublisherState(context, admin));
    app.post('/v1/admin/keys/:fingerprint/revoke', context => revokeKey(context, admin));
    app.post('/v1/admin/publishers/:id/keys', context => recoverKey(context, admin));
    registerReviewRoutes(app, { storage, admin, submissions });
}

function showAdmin(context) {
    context.header(
        'Content-Security-Policy',
        [
            `default-src 'none'`,
            `script-src 'self'`,
            `style-src 'unsafe-inline'`,
            `connect-src 'self'`,
            `base-uri 'none'`,
            `frame-ancestors 'none'`,
            `form-action 'self'`
        ].join('; ')
    );
    return context.html(adminHTML);
}

function showAdminScript(context) {
    return context.body(adminJS, 200, JS_CONTENT);
}

function overview(context) {
    return context.json({
        accessRequests: accessRequests.listRecent(),
        publishers: publishers.listRecent(),
        keys: publisherKeys.listRecent(),
        submissions: submissionQueries.listRecent(),
        versions: extensionVersions.listRecent(),
        audit: auditEvents.listRecent()
    });
}

function approveApplication(context, admin) {
    const state = 'approved';
    const { notes } = jsonBody(context, notesSchema);
    return transaction(() => {
        const id = context.req.param('id');
        const row = accessRequests.findById(id);
        if (!row) throw new ReviewRequestNotFound();
        if (row.state === state)
            return context.json({ id, state, publisherId: row.publisher_id });
        if (row.state !== 'pending') throw new ApplicationAlreadyReviewed();
        const publisherId = randomUUID();
        publishers.create({
            id: publisherId,
            displayName: row.display_name,
            email: row.email
        });
        publisherKeys.createInitial({
            fingerprint: row.fingerprint,
            publisherId,
            publicKey: row.public_key
        });
        accessRequests.review({ id, state, publisherId, notes });
        admin.audit(`access.approve`, id, { publisherId });
        return context.json({ id, state, publisherId });
    });
}

function rejectApplication(context, admin) {
    const state = 'rejected';
    const { notes } = jsonBody(context, notesSchema);
    return transaction(() => {
        const id = context.req.param('id');
        const row = accessRequests.findById(id);
        if (!row) throw new ReviewRequestNotFound();
        if (row.state === state)
            return context.json({ id, state, publisherId: row.publisher_id });
        if (row.state !== 'pending') throw new ApplicationAlreadyReviewed();
        const publisherId = null;
        accessRequests.review({ id, state, publisherId, notes, });
        admin.audit(`access.reject`, id, { publisherId });
        return context.json({ id, state, publisherId });
    });
}

function setPublisherState(context, admin) {
    const details = jsonBody(context, stateSchema);
    return transaction(() => {
        const id = context.req.param('id');
        const result = publishers.setState({ id, state: details.state });
        if (!result.changes) throw new PublisherNotFound();
        admin.audit(`publisher.${details.state}`, id);
        return context.json(details);
    });
}

function revokeKey(context, admin) {
    return transaction(() => {
        const fingerprint = context.req.param('fingerprint');
        const result = publisherKeys.revoke({ revoked: Date.now(), fingerprint });
        if (!result.changes) throw new PublishingKeyNotFound();
        admin.audit('key.revoke', fingerprint);
        return context.json({ revoked: true });
    });
}

async function recoverKey(context, admin) {
    const { publicKey, notes } = jsonBody(context, keySchema);
    const identity = await publicIdentity(publicKey);
    const fingerprint = identity.fingerprint;
    const publisherId = context.req.param('id');
    return transaction(() => {
        if (!publishers.exists(publisherId))
            throw new PublisherNotFound();
        if (accessRequests.exists(fingerprint))
            throw new KeyAssociatedWithApplication();
        const label = 'Admin recovery';
        publisherKeys.create({ fingerprint, publisherId, publicKey, label });
        admin.audit('key.recover', fingerprint, { publisherId, notes });
        return context.json({ fingerprint }, 201);
    });
}
