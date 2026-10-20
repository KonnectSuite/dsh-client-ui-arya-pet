/**
 * Pet registry — the Arya spritesheet-atlas contract. One pet is a directory
 * holding a 'pet.json' manifest plus one atlas image; nothing else is required,
 * and no host or client code changes when a pet is added. The registry scans
 * two sources, later sources overriding earlier ones on an id collision:
 *
 *   1. the package's own 'assets' subdirectories (built-in pets);
 *   2. '${DSH_HOME:-~/.dsh}/pets' subdirectories (user pets, highest precedence).
 *
 * The manifest is the Arya pet shape: id / displayName / description /
 * spritesheetPath, with optional spriteVersionNumber (auto-detected from the
 * image dimensions when omitted), size and pin defaults.
 *
 * Atlas geometry is fixed by the Arya pet contract: 8 columns of 192x208 cells,
 * 9 rows (v1) or 11 rows (v2, adds the 16 mouse-tracking "look" cells).
 * @module dsh-arya-pet/registry
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;
export const COLUMNS = 8;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
/**
 * Absolute package root, resolved from a module URL.
 * @param importMetaUrl - the importing module's `import.meta.url`.
 * @returns the package root, one level above `src/` or `lib/`.
 */
export function petPackageRoot(importMetaUrl) {
    return fileURLToPath(new URL('../', importMetaUrl));
}
/**
 * DSH home directory.
 * @param env - environment to read; defaults to `process.env`.
 * @param home - the account home directory.
 * @returns `$DSH_HOME` when set and non-blank, otherwise `<home>/.dsh`.
 */
export function dshHome(env = process.env, home = homedir()) {
    const raw = env.DSH_HOME;
    return raw !== undefined && raw.trim() !== '' ? raw.trim() : join(home, '.dsh');
}
/**
 * The user pets directory.
 * @param env - environment to read; defaults to `process.env`.
 * @param home - the account home directory.
 * @returns `${DSH_HOME:-~/.dsh}/pets`.
 */
export function userPetsDir(env = process.env, home = homedir()) {
    return join(dshHome(env, home), 'pets');
}
/**
 * Read image dimensions from a WebP, PNG, or GIF header without decoding.
 * @param buffer - the leading bytes of an image file.
 * @returns the dimensions, or null when the format is unrecognized.
 */
export function detectDimensions(buffer) {
    if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = buffer.toString('ascii', 12, 16);
        if (chunk === 'VP8X' && buffer.length >= 30) {
            return {
                width: 1 + (buffer.readUInt8(24) | (buffer.readUInt8(25) << 8) | (buffer.readUInt8(26) << 16)),
                height: 1 + (buffer.readUInt8(27) | (buffer.readUInt8(28) << 8) | (buffer.readUInt8(29) << 16)),
            };
        }
        if (chunk === 'VP8L' && buffer.length >= 25) {
            const b0 = buffer.readUInt8(21);
            const b1 = buffer.readUInt8(22);
            const b2 = buffer.readUInt8(23);
            const b3 = buffer.readUInt8(24);
            return {
                width: ((b1 & 0x3f) << 8 | b0) + 1,
                height: ((b3 & 0x0f) << 10 | (b2 << 2) | (b1 >> 6)) + 1,
            };
        }
        if (chunk === 'VP8 ' && buffer.length >= 27) {
            return {
                width: (buffer.readUInt8(23) | (buffer.readUInt8(24) << 8)) & 0x3fff,
                height: (buffer.readUInt8(25) | (buffer.readUInt8(26) << 8)) & 0x3fff,
            };
        }
    }
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length >= 10) {
        const sig = buffer.toString('ascii', 0, 6);
        if (sig === 'GIF87a' || sig === 'GIF89a') {
            return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
        }
    }
    return null;
}
/**
 * Auto-detect the Arya atlas version from the image dimensions.
 * @param buffer - the leading bytes of an atlas image.
 * @returns 1 or 2, or null when the dimensions match neither contract.
 */
export function detectSpriteVersion(buffer) {
    const dim = detectDimensions(buffer);
    if (dim === null)
        return null;
    if (dim.width === 1536 && dim.height === 1872)
        return 1;
    if (dim.width === 1536 && dim.height === 2288)
        return 2;
    return null;
}
/**
 * Detect the image file extension from its header.
 * @param buffer - the leading bytes of an image file.
 * @returns the extension including the dot, or null when unrecognized.
 */
export function detectImageExt(buffer) {
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
        return '.webp';
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
        return '.png';
    if (buffer.length >= 6) {
        const sig = buffer.toString('ascii', 0, 6);
        if (sig === 'GIF87a' || sig === 'GIF89a')
            return '.gif';
    }
    return null;
}
/**
 * Build the browser URL of one pet asset.
 * @param prefix - URL prefix the assets are served under.
 * @param id - pet id.
 * @param file - path relative to the pet directory.
 * @returns the absolute asset URL.
 */
function assetUrl(prefix, id, file) {
    const rel = file.split('/').filter(segment => segment !== '').join('/');
    return prefix + '/' + encodeURIComponent(id) + '/' + rel;
}
/**
 * Read a bounded integer, falling back when the value is not one.
 * @param value - the manifest value to check.
 * @param fallback - value used when the check fails.
 * @param max - inclusive upper bound.
 * @returns the value, or the fallback.
 */
function finiteInt(value, fallback, max) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}
/** One manifest field read as a trimmed, non-blank string. */
function trimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Normalize one parsed manifest into a renderable pet entry.
 * @param raw - parsed `pet.json`, from a file rather than from this process.
 * @param dir - absolute directory holding the manifest.
 * @param options - asset prefix and the warning collector.
 * @returns the entry, or undefined after recording why the manifest was refused.
 */
export function resolvePetManifest(raw, dir, options = {}) {
    const { assetPrefix = '/codex-pet', warnings = [] } = options;
    const warn = (message) => { warnings.push(message); };
    if (typeof raw !== 'object' || raw === null) {
        warn('manifest is not an object');
        return undefined;
    }
    const manifest = raw;
    const id = trimmedString(manifest.id);
    if (!ID_PATTERN.test(id)) {
        warn('manifest id ' + JSON.stringify(String(manifest.id)) + ' is not a lowercase kebab id');
        return undefined;
    }
    const displayName = trimmedString(manifest.displayName) !== ''
        ? trimmedString(manifest.displayName).slice(0, 80)
        : id;
    const description = trimmedString(manifest.description);
    const spritesheet = trimmedString(manifest.spritesheetPath) !== ''
        ? trimmedString(manifest.spritesheetPath)
        : 'spritesheet.webp';
    const segments = spritesheet.split('/').filter(segment => segment !== '');
    if (segments.length === 0
        || spritesheet.includes('\\')
        || segments.some(segment => segment === '..' || !SEGMENT_PATTERN.test(segment))) {
        warn('manifest ' + id + ': spritesheetPath ' + JSON.stringify(spritesheet) + ' is not a safe relative path');
        return undefined;
    }
    // Sprite version: explicit 1|2 wins; otherwise auto-detect from the atlas
    // image header; otherwise fall back to v2 (11 rows).
    let spriteVersionNumber = manifest.spriteVersionNumber === 1 || manifest.spriteVersionNumber === 2
        ? manifest.spriteVersionNumber
        : null;
    if (spriteVersionNumber === null) {
        const atlasFile = join(dir, segments.join('/'));
        if (existsSync(atlasFile)) {
            try {
                spriteVersionNumber = detectSpriteVersion(readFileSync(atlasFile));
            }
            catch {
                // An unreadable atlas is not fatal: the fallback below still renders.
            }
        }
    }
    if (spriteVersionNumber === null)
        spriteVersionNumber = 2;
    const size = finiteInt(manifest.size, 120, 512);
    const pin = typeof manifest.pin === 'string' ? manifest.pin : 'bottom-right';
    return {
        id,
        displayName,
        description,
        spriteVersionNumber,
        size,
        pin,
        cell: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
        columns: COLUMNS,
        rows: spriteVersionNumber === 2 ? 11 : 9,
        atlasUrl: assetUrl(assetPrefix, id, spritesheet),
        manifestUrl: assetUrl(assetPrefix, id, 'pet.json'),
        dir,
        spritesheetPath: segments.join('/'),
    };
}
/**
 * Scan one directory of pet folders.
 * @param dir - directory whose child folders may each hold a `pet.json`.
 * @param options - asset prefix and the warning collector.
 * @returns entries in directory-name order; a missing or unreadable directory yields none.
 */
function scanPetDir(dir, options) {
    if (!existsSync(dir))
        return [];
    let names = [];
    try {
        names = readdirSync(dir).filter(name => !name.startsWith('.'));
    }
    catch {
        // An unlistable directory contributes no pets; the caller still loads the rest.
        return [];
    }
    names.sort();
    const entries = [];
    for (const name of names) {
        const manifestFile = join(dir, name, 'pet.json');
        if (!existsSync(manifestFile))
            continue;
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(manifestFile, 'utf8'));
        }
        catch (error) {
            options.warnings.push('skipping ' + manifestFile + ': ' + (error instanceof Error ? error.message : String(error)));
            continue;
        }
        const entry = resolvePetManifest(parsed, join(dir, name), options);
        if (entry !== undefined)
            entries.push(entry);
    }
    return entries;
}
/**
 * Load the pet registry, built-in pets first and user pets overriding them.
 *
 * A malformed manifest is skipped with a recorded warning; loading never throws
 * for one, so a bad user pet cannot stop the built-in pets from loading.
 * @param options - package root, asset prefix, and user pets directory.
 * @returns the registry, its warnings, and runtime-add support.
 */
export function loadPetRegistry(options) {
    const { packageRoot, assetPrefix = '/codex-pet', petsDir } = options;
    const warnings = [];
    const byId = new Map();
    for (const entry of scanPetDir(join(packageRoot, 'assets'), { assetPrefix, warnings })) {
        if (!byId.has(entry.id))
            byId.set(entry.id, entry);
    }
    const dir = petsDir !== undefined ? petsDir : userPetsDir();
    for (const entry of scanPetDir(dir, { assetPrefix, warnings })) {
        if (byId.has(entry.id))
            warnings.push('user pet ' + entry.id + ' overrides the built-in one');
        byId.set(entry.id, entry);
    }
    const entries = [...byId.values()];
    return {
        entries,
        warnings,
        byId: id => byId.get(id),
        defaultEntry: () => entries[0],
        add(entry) {
            byId.set(entry.id, entry);
            entries.splice(0, entries.length, ...byId.values());
        },
    };
}
/**
 * Strip host-only fields, leaving the client-visible definition.
 * @param entry - the host-side entry.
 * @returns the same pet without `dir` and `spritesheetPath`.
 */
export function petEntryView(entry) {
    return {
        id: entry.id,
        displayName: entry.displayName,
        description: entry.description,
        spriteVersionNumber: entry.spriteVersionNumber,
        size: entry.size,
        pin: entry.pin,
        cell: entry.cell,
        columns: entry.columns,
        rows: entry.rows,
        atlasUrl: entry.atlasUrl,
        manifestUrl: entry.manifestUrl,
    };
}
//# sourceMappingURL=registry.js.map