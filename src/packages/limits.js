// Binary units, matching the registry's existing size conventions.
export const packageLimits = Object.freeze({
    archive: 300 * 1024 * 1024,
    expanded: 300 * 1024 * 1024,
    file: 300 * 1024 * 1024,
    manifest: 1024 * 1024,
    entries: 10000
});

export const manifestFilenames = Object.freeze([
    'module.json',
    'exporter.json',
    'template.json',
    'game.json'
]);
