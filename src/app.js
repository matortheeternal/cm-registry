import { getDatabase, withDatabase } from './database/connection.js';
import { Hono } from 'hono';
import { AdminTokenRequired } from './errors.js';
import { createErrorHandler } from './http.js';
import {
    createRequestMiddleware,
    createSignedMiddleware,
    createPublisherMiddleware,
    createAdminMiddleware
} from './middleware.js';
import { Submissions } from './submissions.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerAccessRequestsRoutes } from './routes/accessRequests.js';
import { registerSubmissionsRoutes } from './routes/submissions.js';
import { registerKeysRoutes } from './routes/keys.js';
import { registerAdminRoutes } from './routes/admin.js';
import { createAuditor } from './database/auditEvents.js';

export function createApp({
    db = getDatabase(),
    storage,
    adminToken,
    allowLocalHTTP = false,
    adminId = 'local-admin',
    onError = () => {}
}) {
    if (typeof adminToken !== 'string' || adminToken.length < 32)
        throw new AdminTokenRequired();
    const app = new Hono();
    app.onError(createErrorHandler(onError));
    app.use('*', (context, next) => withDatabase(db, next));
    app.use('*', createRequestMiddleware({ allowLocalHTTP }));
    const signed = createSignedMiddleware();
    const publisher = createPublisherMiddleware();
    const admin = {
        id: adminId,
        middleware: createAdminMiddleware({ adminToken, allowLocalHTTP }),
        audit: createAuditor(adminId)
    };

    const submissions = new Submissions({ storage });
    const dependencies = { storage, signed, publisher, admin, submissions };
    registerCatalogRoutes(app, dependencies);
    registerAccessRequestsRoutes(app, dependencies);
    registerSubmissionsRoutes(app, dependencies);
    registerKeysRoutes(app, dependencies);
    registerAdminRoutes(app, dependencies);
    app.notFound(context =>
        context.json({
            error: { code: 'not_found', message: 'Route not found' },
            requestId: context.get('requestId')
        }, 404)
    );
    return app;
}
