import { readFileSync } from 'node:fs';

export const adminHTML = readFileSync(
    new URL('./admin/index.html', import.meta.url),
    'utf8'
);
export const adminJS = readFileSync(new URL('./admin/app.js', import.meta.url), 'utf8');
