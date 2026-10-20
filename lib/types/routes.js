/**
 * Pet HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints ('/api/codex-pet/*') and loads each pet's atlas
 * from the '/codex-pet/<id>/*' asset route (the same pattern as the
 * dsh-web-ui family's '/api/pet' + '/pet/<id>' routes). The asset route is one
 * prefix registration serving every registry entry, so adding a pet never
 * touches route wiring.
 * @module dsh-arya-pet/routes
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { petEntryView } from "./registry.js";
/** HTTP prefix for pet management requests. */
export const PET_API_PREFIX = '/api/codex-pet';
/** HTTP prefix serving installed pet assets. */
export const PET_ASSET_PREFIX = '/codex-pet';
const MANIFEST_FILE = 'pet.json';
/** HTTP route serving the configured pet sound. */
export const SOUND_ROUTE = '/codex-pet-sound';
const MIME_BY_EXT = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
};
/**
 * Content type for one file name.
 * @param file - a file name or path.
 * @returns the media type, defaulting to a binary stream.
 */
function mimeFor(file) {
    const dot = file.lastIndexOf('.');
    if (dot < 0)
        return 'application/octet-stream';
    return MIME_BY_EXT[file.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}
/**
 * Write one JSON response.
 * @param res - the response to write.
 * @param status - HTTP status code.
 * @param body - value to serialize.
 */
function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
/**
 * Require the request method, answering 405 when it differs.
 * @param req - the request.
 * @param res - the response, written to only on a mismatch.
 * @param method - the method the route accepts.
 * @returns whether the caller should continue.
 */
function requireMethod(req, res, method) {
    if (req.method === method)
        return true;
    json(res, 405, { ok: false, error: 'method-not-allowed' });
    return false;
}
/**
 * Read a bounded JSON request body.
 * @param req - the request to read.
 * @returns the parsed body, or an empty object for an empty body.
 */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 64 * 1024) {
                reject(new Error('body-too-large'));
                queueMicrotask(() => req.destroy());
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch {
                reject(new Error('invalid-json'));
            }
        });
        req.on('error', reject);
    });
}
/**
 * Read a bounded raw request body.
 * @param req - the request to read.
 * @param maxBytes - inclusive size bound.
 * @returns the request body.
 */
function readRawBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error('file-too-large'));
                queueMicrotask(() => req.destroy());
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => { resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
    });
}
/**
 * Wrap one service call as an exact GET JSON route.
 * @param path - absolute pathname.
 * @param run - the call, whose value becomes the response.
 * @returns the route registration.
 */
function getRoute(path, run) {
    return {
        kind: 'exact',
        path,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            Promise.resolve().then(run).then((value) => { json(res, 200, value); }, (error) => { json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }); });
        },
    };
}
/**
 * Wrap one service call as an exact POST JSON route, passing the body through.
 * @param path - absolute pathname.
 * @param run - the call, which receives the parsed body.
 * @returns the route registration.
 */
function postRoute(path, run) {
    return {
        kind: 'exact',
        path,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            return readJsonBody(req).then((body) => {
                const record = typeof body === 'object' && body !== null ? body : {};
                return Promise.resolve().then(() => run(record)).then((value) => { json(res, 200, value); }, (error) => { json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }); });
            }, (error) => {
                json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
            });
        },
    };
}
/**
 * Build the one asset handler behind the '/codex-pet' prefix.
 *
 * Serves exactly the files a manifest declares: `pet.json` and the declared
 * spritesheet path. An entry whose manifest file is absent gets a synthesized
 * `pet.json` built from its own definition.
 * @param service - the service owning the registry to serve from.
 * @returns the handler for the prefix registration.
 */
function assetHandler(service) {
    return (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405);
            res.end();
            return;
        }
        let pathname;
        try {
            pathname = new URL(req.url ?? '/', 'http://codex-pet.local').pathname;
        }
        catch {
            res.writeHead(400);
            res.end();
            return;
        }
        const segments = pathname.split('/').filter(segment => segment !== '');
        if (segments[0] !== 'codex-pet' || segments[1] === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        let id;
        try {
            id = decodeURIComponent(segments[1]);
        }
        catch {
            res.writeHead(400);
            res.end();
            return;
        }
        const entry = service.registry.byId(id);
        if (entry === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        const rest = [];
        for (const segment of segments.slice(2)) {
            let decoded;
            try {
                decoded = decodeURIComponent(segment);
            }
            catch {
                res.writeHead(400);
                res.end();
                return;
            }
            rest.push(decoded);
        }
        const rel = rest.join('/');
        let file;
        let synthesized = false;
        if (rest.length === 1 && rest[0] === MANIFEST_FILE) {
            const manifestFile = join(entry.dir, MANIFEST_FILE);
            if (existsSync(manifestFile))
                file = manifestFile;
            else
                synthesized = true;
        }
        else if (rest.length > 0 && rel === entry.spritesheetPath) {
            file = join(entry.dir, entry.spritesheetPath);
        }
        if (synthesized) {
            const body = Buffer.from(JSON.stringify(petEntryView(entry), null, 2), 'utf8');
            res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'content-length': String(body.byteLength),
                'cache-control': 'no-cache',
            });
            if (req.method === 'HEAD') {
                res.end();
                return;
            }
            res.end(body);
            return;
        }
        if (file === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        const resolved = file;
        readFile(resolved).then((body) => {
            res.writeHead(200, {
                'content-type': mimeFor(resolved),
                'content-length': String(body.byteLength),
                'cache-control': 'no-cache',
            });
            if (req.method === 'HEAD') {
                res.end();
                return;
            }
            res.end(body);
        }, () => {
            res.writeHead(404);
            res.end();
        });
    };
}
/**
 * Import one Arya atlas, uploaded as a raw body.
 * @param service - the service to import into.
 * @returns the route registration.
 */
function importRoute(service) {
    return {
        kind: 'exact',
        path: PET_API_PREFIX + '/import',
        handler: (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            let id = '';
            let name = '';
            try {
                const params = new URL(req.url ?? '/', 'http://codex-pet.local').searchParams;
                id = params.get('id') ?? '';
                name = params.get('name') ?? '';
            }
            catch {
                json(res, 400, { ok: false, error: 'invalid-url' });
                return;
            }
            return readRawBody(req, 20 * 1024 * 1024).then((buffer) => {
                json(res, 200, service.importPet(id, name, buffer));
            }, (error) => {
                json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
            });
        },
    };
}
/**
 * Stream the effective task-finished chime, the user override first and the
 * built-in asset second. no-cache so a freshly uploaded file takes effect at once.
 * @param service - the service owning the sound overrides.
 * @returns the route registration.
 */
function soundRoute(service) {
    return {
        kind: 'exact',
        path: SOUND_ROUTE,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            const track = trackParam(req);
            if (track === null) {
                json(res, 400, { ok: false, error: 'unknown-track' });
                return;
            }
            const file = service.trackFile(track);
            if (file === null) {
                json(res, 404, { ok: false, error: 'no-sound-file' });
                return;
            }
            return readFile(file).then((body) => {
                res.writeHead(200, {
                    'content-type': mimeFor(file),
                    'content-length': String(body.byteLength),
                    'cache-control': 'no-cache',
                });
                res.end(body);
            }, () => { json(res, 404, { ok: false, error: 'sound-file-unreadable' }); });
        },
    };
}
/**
 * Read the `track` query parameter.
 * @param req - the request.
 * @returns the track id; an absent value keeps the legacy `done` default, and
 * an unknown value yields null.
 */
function trackParam(req) {
    try {
        const value = new URL(req.url ?? '/', 'http://codex-pet.local').searchParams.get('track');
        if (value === null)
            return 'done';
        return value === 'done' || value === 'error' || value === 'interrupt' ? value : null;
    }
    catch {
        return null;
    }
}
/**
 * Store one uploaded chime as a track's override.
 * @param service - the service owning the sound overrides.
 * @returns the route registration.
 */
function uploadSoundRoute(service) {
    return {
        kind: 'exact',
        path: PET_API_PREFIX + '/sound',
        handler: (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            const track = trackParam(req);
            if (track === null) {
                json(res, 400, { ok: false, error: 'unknown-track' });
                return;
            }
            return readRawBody(req, 8 * 1024 * 1024)
                .then(buffer => service.saveSound(buffer, track))
                .then((state) => { json(res, 200, state); }, (error) => { json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }); });
        },
    };
}
/**
 * Drop one track's chime, so the built-in default takes over again.
 * @param service - the service owning the sound overrides.
 * @returns the route registration.
 */
function resetSoundRoute(service) {
    return {
        kind: 'exact',
        path: PET_API_PREFIX + '/reset-sound',
        handler: (req, res) => {
            if (!requireMethod(req, res, 'POST'))
                return;
            const track = trackParam(req);
            if (track === null) {
                json(res, 400, { ok: false, error: 'unknown-track' });
                return;
            }
            Promise.resolve().then(() => service.resetSound(track)).then((state) => { json(res, 200, state); }, (error) => { json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }); });
        },
    };
}
/**
 * Resolve the LLM service, refusing when the profile mounts no adapter.
 * @param getLlm - the resolver.
 * @returns the LLM service.
 */
function requireLlm(getLlm) {
    const llm = getLlm();
    if (llm === null || llm === undefined)
        throw new Error('no-llm-service');
    return llm;
}
/**
 * List every registered provider with its advisory model catalog. One
 * provider's listing failure degrades to an empty model list plus an error
 * field instead of failing the whole reply.
 * @param getLlm - the resolver.
 * @returns the route registration.
 */
function modelsRoute(getLlm) {
    return getRoute(PET_API_PREFIX + '/models', async () => {
        const llm = requireLlm(getLlm);
        const providers = [];
        for (const info of llm.listProviders()) {
            try {
                const models = await llm.listModels(info.id);
                providers.push({
                    id: info.id,
                    name: providerName(info),
                    models: (Array.isArray(models) ? models : []).map(m => ({ id: m.id, name: m.name })),
                });
            }
            catch (error) {
                providers.push({
                    id: info.id,
                    name: providerName(info),
                    models: [],
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return { providers };
    });
}
/**
 * Read a provider's display name.
 * @param info - the registered provider.
 * @returns its name, falling back to its id when the service reports none.
 */
function providerName(info) {
    return info.name ?? info.id;
}
/**
 * Summarize one batch of completed assistant model requests.
 * @param options - the service and the LLM resolver.
 * @returns the route registration.
 */
function summarizeRoute(options) {
    return postRoute(PET_API_PREFIX + '/summarize', body => options.service.summarizeRequests(requireLlm(options.getLlm), body));
}
/**
 * AI-view summaries for one session, as
 * `GET /journal?session=<id>&limit=<n>&all=1`.
 * @param service - the service owning the journal.
 * @returns the route registration.
 */
function journalRoute(service) {
    return {
        kind: 'exact',
        path: PET_API_PREFIX + '/journal',
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            let session = '';
            let limit = 50;
            let all = false;
            try {
                const params = new URL(req.url ?? '/', 'http://codex-pet.local').searchParams;
                session = params.get('session') ?? '';
                limit = Number(params.get('limit') ?? 50);
                all = params.get('all') === '1';
            }
            catch {
                json(res, 400, { ok: false, error: 'invalid-url' });
                return;
            }
            if (session.trim() === '') {
                json(res, 400, { ok: false, error: 'missing-session' });
                return;
            }
            const bound = Number.isFinite(limit) ? limit : 50;
            Promise.resolve().then(() => all ? service.journalRecords(session) : service.journalList(session, bound)).then((records) => { json(res, 200, { records }); }, (error) => { json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }); });
        },
    };
}
/**
 * Build the full route family (API and assets) for one service.
 * @param options - the service and the LLM resolver.
 * @returns every registration, in mount order.
 */
export function makeCodexPetRoutes(options) {
    const { service, getLlm } = options;
    const routes = [
        getRoute(PET_API_PREFIX + '/pets', () => ({ pets: service.pets() })),
        getRoute(PET_API_PREFIX + '/state', () => service.state()),
        postRoute(PET_API_PREFIX + '/set-pet', body => service.setPetId(body.petId)),
        postRoute(PET_API_PREFIX + '/set-config', body => service.setConfig(body)),
        postRoute(PET_API_PREFIX + '/set-visible', body => service.setVisible(body.visible)),
        importRoute(service),
        soundRoute(service),
        uploadSoundRoute(service),
        resetSoundRoute(service),
        { kind: 'prefix', path: PET_ASSET_PREFIX, handler: assetHandler(service) },
    ];
    // The LLM-backed routes resolve their service per request, so they mount
    // unconditionally and degrade to a clear error when no adapter is live.
    routes.push(modelsRoute(getLlm), summarizeRoute(options), journalRoute(service));
    return routes;
}
//# sourceMappingURL=routes.js.map