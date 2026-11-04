const element = id => document.getElementById(id);

async function api(path, body, raw = false) {
    const options = {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + element('token').value }
    };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const response = await fetch('/v1/admin/' + path, options);
    if (!response.ok) throw new Error((await response.json()).error.message);
    return raw ? response.blob() : response.json();
}

function addButton(parent, label, action) {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = async () => {
        try {
            await action();
            element('status').textContent = 'Saved';
            await loadRecords();
        } catch (error) {
            element('status').textContent = error.message;
        }
    };
    parent.append(button);
}

function accessRequestActions(parent, request) {
    if (request.state !== 'pending') return;
    const path = 'access-requests/' + request.id;
    addButton(parent, 'Approve', () => api(path + '/approve', {}));
    addButton(parent, 'Reject', () =>
        api(path + '/reject', {
            notes: prompt('Review notes') || ''
        })
    );
}

function publisherActions(parent, publisher) {
    const isActive = publisher.state === 'active';
    const path = 'publishers/' + publisher.id;
    addButton(parent, isActive ? 'Suspend' : 'Activate', () =>
        api(path, {
            state: isActive ? 'suspended' : 'active'
        })
    );
    const keyInput = document.createElement('input');
    keyInput.placeholder = 'Recovery: verified raw public key (base64)';
    parent.append(keyInput);
    addButton(parent, 'Register recovery key', () => {
        if (!confirm('Have you independently verified the publisher identity?')) return;
        return api(path + '/keys', {
            publicKey: keyInput.value,
            notes: prompt('Identity verification evidence') || ''
        });
    });
}

function keyActions(parent, key) {
    if (key.revoked) return;
    addButton(parent, 'Revoke key', () => api('keys/' + key.fingerprint + '/revoke', {}));
}

async function downloadArtifact(submission) {
    const blob = await api('submissions/' + submission.id + '/artifact', null, true);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = submission.id + '.cmpkg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function submissionActions(parent, submission) {
    if (submission.state !== 'pending_review') return;
    const path = 'submissions/' + submission.id;
    addButton(parent, 'Download exact artifact', () => downloadArtifact(submission));
    const hashInput = document.createElement('input');
    hashInput.placeholder = 'SHA-256 of artifact inspected locally';
    hashInput.size = 68;
    parent.append(hashInput);
    addButton(parent, 'Approve reviewed bytes', () =>
        api(path + '/approve', {
            reviewedHash: hashInput.value,
            notes: prompt('Review notes') || ''
        })
    );
    addButton(parent, 'Reject', () =>
        api(path + '/reject', {
            notes: prompt('Reason') || ''
        })
    );
}

function versionActions(parent, version) {
    const path
        = 'versions/' + encodeURIComponent(version.extension_id) + '/' + version.version;
    for (const state of ['deprecated', 'revoked']) {
        addButton(parent, state, () =>
            api(path, {
                state,
                notes: prompt('Reason') || ''
            })
        );
    }
}

const recordActions = {
    accessRequests: accessRequestActions,
    publishers: publisherActions,
    keys: keyActions,
    submissions: submissionActions,
    versions: versionActions
};

function renderRecord(kind, record) {
    const article = document.createElement('article');
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(record, null, 2);
    article.append(details);
    recordActions[kind]?.(article, record);
    return article;
}

async function loadRecords() {
    try {
        const overview = await api('overview');
        const records = element('records');
        records.replaceChildren();
        for (const [kind, rows] of Object.entries(overview)) {
            const heading = document.createElement('h2');
            heading.textContent = kind;
            records.append(heading);
            for (const row of rows) records.append(renderRecord(kind, row));
        }
    } catch (error) {
        element('status').textContent = error.message;
    }
}

element('load').onclick = loadRecords;
