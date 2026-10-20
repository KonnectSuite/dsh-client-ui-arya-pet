/**
 * Pet service — owns the persisted selection + display config and exposes the
 * read/update methods the JSON routes call. State persists to
 * '${DSH_HOME:-~/.dsh}/codex-pet.json' so a drag or resize survives a restart.
 *
 * Two feature sections live beside the original display config:
 * - summary: periodic model-request summaries (interval, model route, bubble).
 * - sound:   the task-finished chime (enabled/volume); the audio file itself
 *            lives on disk ('~/.dsh/pets/sounds/done.*' overrides the built-in
 *            assets/sounds/done.wav) so users can replace it freely.
 * @module dsh-arya-pet/service
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { detectImageExt, detectSpriteVersion, dshHome, petEntryView, resolvePetManifest, userPetsDir } from "./registry.js";
const PERSIST_FILE = 'codex-pet.json';
const DEFAULT_DISPLAY = {
    visible: true,
    size: 120,
    pin: 'bottom-right',
    left: null,
    top: null,
    bubbleTheme: 'gray',
    bubbleOpacity: 94,
    // v2 atlases only: the pet's eyes track the pointer (the 16 "look" cells).
    // v1 atlases have no look cells, so this setting has no effect on them.
    mouseTracking: true,
};
/** Periodic request-summary defaults. A route must be selected before enabling. */
const DEFAULT_SUMMARY = {
    enabled: false,
    intervalRequests: 5,
    provider: '',
    model: '',
    maxChars: 220,
    bubbleSeconds: 12,
};
/** Scenario voice defaults; volume is 0..100. */
const DEFAULT_SOUND = {
    enabled: true,
    volume: 60,
    // Per-scenario switches and relative volume (final = master x track).
    tracks: {
        done: { enabled: true, volume: 100 },
        error: { enabled: true, volume: 100 },
        interrupt: { enabled: true, volume: 100 },
    },
};
/**
 * User-replaceable chime directory.
 * @param env - environment carrying `DSH_HOME`.
 * @returns `${DSH_HOME:-~/.dsh}/pets/sounds`.
 */
export function userSoundsDir(env = process.env) {
    return join(dshHome(env), 'pets', 'sounds');
}
const SOUND_EXTS = ['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.webm'];
/** Scenario tracks that can each carry an override file and their own volume. */
const TRACK_IDS = ['done', 'error', 'interrupt'];
/**
 * Round a value into a bounded integer.
 * @param value - candidate, from untrusted input.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @param fallback - value used when `value` is not a finite number.
 * @returns the bounded integer.
 */
function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
/** Read an untrusted value as a plain object, or an empty one. */
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : {};
}
/**
 * Normalize one untrusted summary section into the persisted snapshot.
 * @param raw - the section as read from disk or supplied by the browser.
 * @returns a section whose fields are all in range.
 */
function sanitizeSummary(raw) {
    const src = asRecord(raw);
    const interval = src.intervalRequests ?? src.intervalTurns;
    const provider = typeof src.provider === 'string' ? src.provider.trim().slice(0, 120) : '';
    const model = typeof src.model === 'string' ? src.model.trim().slice(0, 160) : '';
    return {
        enabled: src.enabled === true && provider !== '' && model !== '',
        intervalRequests: clampInt(interval, 1, 50, DEFAULT_SUMMARY.intervalRequests),
        provider,
        model,
        maxChars: clampInt(src.maxChars, 60, 800, DEFAULT_SUMMARY.maxChars),
        bubbleSeconds: clampInt(src.bubbleSeconds, 3, 120, DEFAULT_SUMMARY.bubbleSeconds),
    };
}
/**
 * Normalize one untrusted sound section into the persisted snapshot.
 * @param raw - the section as read from disk or supplied by the browser.
 * @returns a section whose fields are all in range, with the legacy `events`
 * switches migrated onto the per-track ones.
 */
function sanitizeSound(raw) {
    const src = asRecord(raw);
    const rawTracks = asRecord(src.tracks);
    const rawEvents = asRecord(src.events);
    const tracks = {};
    for (const id of TRACK_IDS) {
        const track = asRecord(rawTracks[id]);
        const legacyEnabled = rawEvents[id] !== undefined ? rawEvents[id] !== false : undefined;
        tracks[id] = {
            enabled: track.enabled !== undefined ? track.enabled !== false : (legacyEnabled ?? true),
            volume: clampInt(track.volume, 0, 100, 100),
        };
    }
    return {
        enabled: src.enabled !== false,
        volume: clampInt(src.volume, 0, 100, DEFAULT_SOUND.volume),
        tracks,
    };
}
/**
 * The persisted snapshot's path.
 * @param env - environment carrying `DSH_HOME`.
 * @returns the absolute path of the persistence file.
 */
export function persistPath(env = process.env) {
    return join(dshHome(env), PERSIST_FILE);
}
/**
 * Read one track's name from untrusted input.
 * @param track - candidate track id.
 * @returns whether the value names a known track.
 */
function isTrackId(track) {
    return typeof track === 'string' && TRACK_IDS.includes(track);
}
/** Owns the persisted pet selection, its display config, and the sound overrides. */
export class PetService {
    /** The registry this service reads and extends; the asset route serves from it. */
    registry;
    env;
    file;
    petsDir;
    soundsDir;
    journalDir;
    builtInSoundDir;
    summaryInflight = new Map();
    // Scenario-event pulses carry their owning session so another tab/session
    // cannot react to an unrelated agent event.
    pulses = {
        error: { at: 0, sessionId: '' },
        interrupt: { at: 0, sessionId: '' },
    };
    // NOTE: keep the persisted snapshot off the name "state" — `state` is also
    // the read method, and an instance property would shadow it.
    persist;
    /**
     * @param options - the registry to serve, the environment, and the package root.
     */
    constructor(options) {
        const { registry, env = process.env, packageRoot } = options;
        this.registry = registry;
        this.env = env;
        this.file = persistPath(this.env);
        this.petsDir = userPetsDir(this.env);
        this.soundsDir = userSoundsDir(this.env);
        // Per-session summary journal: one JSONL line per generated summary, so
        // the user can look back at the AI-view project progress any time.
        this.journalDir = join(dshHome(this.env), 'codex-pet-journal');
        // Built-in fallback chime shipped under <packageRoot>/assets/sounds/.
        this.builtInSoundDir = packageRoot === undefined ? null : join(packageRoot, 'assets', 'sounds');
        this.persist = this.load();
        if (this.persist.petId === null || this.registry.byId(this.persist.petId) === undefined) {
            const fallback = this.registry.defaultEntry();
            this.persist.petId = fallback === undefined ? null : fallback.id;
        }
    }
    /**
     * Read the persisted snapshot, filling absent fields from the defaults.
     * @returns the snapshot; an unreadable or malformed file yields the defaults.
     */
    load() {
        const base = {
            petId: null,
            display: { ...DEFAULT_DISPLAY },
            summary: { ...DEFAULT_SUMMARY },
            sound: { ...DEFAULT_SOUND, tracks: { ...DEFAULT_SOUND.tracks } },
        };
        if (!existsSync(this.file))
            return base;
        try {
            const parsed = asRecord(JSON.parse(readFileSync(this.file, 'utf8')));
            return {
                petId: typeof parsed.petId === 'string' ? parsed.petId : null,
                display: { ...DEFAULT_DISPLAY, ...asRecord(parsed.display) },
                summary: sanitizeSummary(parsed.summary),
                sound: sanitizeSound(parsed.sound),
            };
        }
        catch {
            // An unreadable file is not fatal: the defaults above still render a pet.
            return base;
        }
    }
    /** Write the snapshot, reporting a failure rather than propagating it. */
    save() {
        try {
            writeFileSync(this.file, JSON.stringify(this.persist, null, 2) + '\n', 'utf8');
        }
        catch (error) {
            console.warn('[dsh-arya-pet] could not persist state:', error);
        }
    }
    /**
     * Every registered pet, projected for the browser.
     * @returns the client-visible definitions.
     */
    pets() {
        return this.registry.entries.map(petEntryView);
    }
    /**
     * The user-uploaded override for one track.
     * @param track - scenario track id.
     * @returns the override file's absolute path, or null when none is installed.
     */
    customSoundFile(track = 'done') {
        if (!isTrackId(track))
            return null;
        if (!existsSync(this.soundsDir))
            return null;
        let names = [];
        try {
            names = readdirSync(this.soundsDir);
        }
        catch {
            // An unlistable directory has no override; the built-in audio still plays.
            return null;
        }
        for (const ext of SOUND_EXTS) {
            if (names.includes(track + ext)) {
                const file = join(this.soundsDir, track + ext);
                if (existsSync(file))
                    return file;
            }
        }
        return null;
    }
    /**
     * Store one uploaded track override, removing any other extension of the same
     * track so exactly one override per track exists at a time.
     * @param buffer - the uploaded audio file.
     * @param track - scenario track id.
     * @returns the resulting state projection.
     */
    saveSound(buffer, track = 'done') {
        if (!isTrackId(track))
            throw new Error('unknown-track');
        const ext = detectAudioExt(buffer);
        if (ext === null)
            throw new Error('unsupported-audio (use .wav/.mp3/.ogg/.m4a/.flac/.webm)');
        if (buffer.length === 0)
            throw new Error('empty-file');
        if (buffer.length > 8 * 1024 * 1024)
            throw new Error('file-too-large (max 8MB)');
        mkdirSync(this.soundsDir, { recursive: true });
        for (const other of SOUND_EXTS) {
            if (other !== ext)
                rmSync(join(this.soundsDir, track + other), { force: true });
        }
        writeFileSync(join(this.soundsDir, track + ext), buffer);
        return this.state();
    }
    /**
     * Remove one track's override, so the built-in audio takes over again.
     * @param track - scenario track id.
     * @returns the resulting state projection.
     */
    resetSound(track = 'done') {
        if (!isTrackId(track))
            throw new Error('unknown-track');
        for (const ext of SOUND_EXTS)
            rmSync(join(this.soundsDir, track + ext), { force: true });
        return this.state();
    }
    /**
     * Record a scenario event so the next state poll plays its voice line.
     * @param kind - scenario event.
     * @param sessionId - the session that owns the event.
     */
    pulse(kind, sessionId = '') {
        const previous = this.pulses[kind].at;
        this.pulses[kind] = {
            at: Math.max(Date.now(), previous + 1),
            sessionId,
        };
    }
    /**
     * Resolve a scenario track's audio file: the user override first, then a
     * built-in take chosen at random so repeated triggers vary, then the plain
     * legacy file.
     * @param track - scenario track id.
     * @returns the audio file's absolute path, or null when none is installed.
     */
    trackFile(track) {
        if (!isTrackId(track))
            return null;
        const custom = this.customSoundFile(track);
        if (custom !== null)
            return custom;
        if (this.builtInSoundDir !== null) {
            const takes = readdirSyncSafe(this.builtInSoundDir)
                .filter(name => name.startsWith(track + '-') && SOUND_EXTS.some(ext => name.endsWith(ext)));
            const take = takes[Math.floor(Math.random() * takes.length)];
            if (take !== undefined)
                return join(this.builtInSoundDir, take);
        }
        for (const ext of SOUND_EXTS) {
            const file = this.builtInSoundDir === null ? null : join(this.builtInSoundDir, track + ext);
            if (file !== null && existsSync(file))
                return file;
        }
        return null;
    }
    /**
     * Journal file for one session id, hashed for filesystem safety.
     * @param sessionId - the owning session.
     * @returns the absolute path of that session's journal.
     */
    journalFileFor(sessionId) {
        const id = requireSessionId(sessionId);
        return join(this.journalDir, createHash('sha256').update(id).digest('hex') + '.jsonl');
    }
    /**
     * Append one summary record to its session's journal.
     * @param record - the record to persist.
     */
    appendJournal(record) {
        requireSessionId(record.sessionId);
        mkdirSync(this.journalDir, { recursive: true });
        appendFileSync(this.journalFileFor(record.sessionId), JSON.stringify(record) + '\n', 'utf8');
    }
    /**
     * Latest journal records for one session, newest first.
     * @param sessionId - the owning session.
     * @param limit - maximum records to return.
     * @returns the most recent records in reverse append order.
     */
    journalList(sessionId, limit = 50) {
        return this.journalRecords(sessionId).slice(-clampInt(limit, 1, 200, 50)).reverse();
    }
    /**
     * All journal records for one session in append order.
     * @param sessionId - the owning session.
     * @returns every complete record; an unparseable line is reported, not skipped.
     */
    journalRecords(sessionId) {
        const file = this.journalFileFor(sessionId);
        if (!existsSync(file))
            return [];
        const records = [];
        const lines = readFileSync(file, 'utf8').split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (line === undefined || line === '')
                continue;
            try {
                records.push(JSON.parse(line));
            }
            catch {
                throw new Error('journal-invalid-jsonl:' + file + ':' + String(index + 1));
            }
        }
        return records;
    }
    /**
     * The full state projection the browser polls.
     * @returns selection, display, feature settings, the pet list, and pulses.
     */
    state() {
        const entry = this.persist.petId === null ? undefined : this.registry.byId(this.persist.petId);
        return {
            petId: this.persist.petId,
            display: this.persist.display,
            summary: this.persist.summary,
            sound: this.persist.sound,
            pet: entry === undefined ? null : petEntryView(entry),
            pets: this.pets(),
            hasCustomSounds: {
                done: this.customSoundFile('done') !== null,
                error: this.customSoundFile('error') !== null,
                interrupt: this.customSoundFile('interrupt') !== null,
            },
            pulses: { ...this.pulses },
        };
    }
    /**
     * Select one registered pet.
     * @param petId - the pet to select.
     * @returns the resulting state projection.
     */
    setPetId(petId) {
        if (typeof petId !== 'string' || this.registry.byId(petId) === undefined)
            throw new Error('invalid-pet');
        this.persist.petId = petId;
        this.save();
        return this.state();
    }
    /**
     * Apply a browser display patch, ignoring fields it did not send.
     * @param patch - the fields to change.
     * @returns the resulting state projection.
     */
    setConfig(patch) {
        const p = asRecord(patch);
        const d = this.persist.display;
        if (typeof p.size === 'number')
            d.size = Math.max(32, Math.min(512, Math.round(p.size)));
        if (typeof p.pin === 'string')
            d.pin = p.pin;
        if (typeof p.left === 'number')
            d.left = Math.max(0, Math.round(p.left));
        if (typeof p.top === 'number')
            d.top = Math.max(0, Math.round(p.top));
        if (typeof p.visible === 'boolean')
            d.visible = p.visible;
        if (typeof p.mouseTracking === 'boolean')
            d.mouseTracking = p.mouseTracking;
        if (typeof p.bubbleTheme === 'string')
            d.bubbleTheme = p.bubbleTheme;
        if (typeof p.bubbleOpacity === 'number')
            d.bubbleOpacity = Math.max(0, Math.min(100, Math.round(p.bubbleOpacity)));
        if (typeof p.summary === 'object' && p.summary !== null) {
            this.persist.summary = sanitizeSummary({ ...this.persist.summary, ...asRecord(p.summary) });
        }
        if (typeof p.sound === 'object' && p.sound !== null) {
            const soundPatch = asRecord(p.sound);
            const tracks = typeof soundPatch.tracks === 'object' && soundPatch.tracks !== null
                ? { ...this.persist.sound.tracks, ...asRecord(soundPatch.tracks) }
                : this.persist.sound.tracks;
            this.persist.sound = sanitizeSound({ ...this.persist.sound, ...soundPatch, tracks });
        }
        this.save();
        return this.state();
    }
    /**
     * Show or hide the overlay.
     * @param visible - the new visibility.
     * @returns the resulting state projection.
     */
    setVisible(visible) {
        if (typeof visible !== 'boolean')
            throw new Error('invalid-visible');
        this.persist.display.visible = visible;
        this.save();
        return this.state();
    }
    /**
     * Summarize one batch of completed assistant model requests through the
     * configured LLM route. The browser half assembles the transcript from its
     * live conversation snapshot; this side only frames the auxiliary call.
     * @param llm - the LLM service to call.
     * @param payload - the batch the browser supplied.
     * @returns the summary, served from the journal when this batch already ran.
     */
    async summarizeRequests(llm, payload) {
        const { sessionId, fromRequestSeq, toRequestSeq, requests } = validateSummaryPayload(payload);
        const existing = this.journalRecords(sessionId).find(record => (record.sessionId === sessionId
            && record.fromRequestSeq === fromRequestSeq
            && record.toRequestSeq === toRequestSeq));
        if (existing !== undefined)
            return summaryResult(existing);
        const cfg = this.persist.summary;
        if (!cfg.enabled)
            throw new Error('summary-disabled');
        const key = JSON.stringify([sessionId, fromRequestSeq, toRequestSeq]);
        const inFlight = this.summaryInflight.get(key);
        if (inFlight !== undefined)
            return inFlight;
        const run = async () => {
            const route = resolveSummaryRoute(llm, cfg);
            const framed = 'Summarize the following JSON records from a completed batch of AI coding-assistant model requests:\n' + JSON.stringify(requests);
            const messages = [createUserTextMessage(framed)];
            const text = await streamText(llm, {
                provider: route.provider,
                model: route.model,
                messages,
                system: SUMMARY_SYSTEM_PROMPT,
                maxTokens: 512,
                signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
            });
            const trimmed = text.trim().slice(0, cfg.maxChars);
            if (trimmed.length === 0)
                throw new Error('summary-model-produced-no-text');
            const record = {
                sessionId,
                fromRequestSeq,
                toRequestSeq,
                requestCount: requests.length,
                provider: route.provider,
                model: route.model,
                summary: trimmed,
                createdAt: new Date().toISOString(),
            };
            this.appendJournal(record);
            return summaryResult(record);
        };
        const promise = run();
        this.summaryInflight.set(key, promise);
        promise.then(() => this.summaryInflight.delete(key), () => this.summaryInflight.delete(key));
        return promise;
    }
    /**
     * Import one uploaded Arya atlas: derive a filesystem-safe kebab id, keep the
     * Unicode display name as-is, save the spritesheet and manifest, then
     * register and select it.
     *
     * The id never silently reuses an existing one: re-importing the same pet
     * (same id and an explicitly typed display name) updates it in place, while
     * any other collision takes a `-2` / `-3` suffix. Arya atlases all ship as
     * `spritesheet.webp`, so without this every import would overwrite the
     * previous one's folder.
     * @param rawId - the id the user typed, if any.
     * @param displayName - the display name the user typed, if any.
     * @param buffer - the uploaded atlas image.
     * @returns the resulting state projection.
     */
    importPet(rawId, displayName, buffer) {
        if (rawId != null && typeof rawId !== 'string')
            throw new Error('invalid-id');
        if (displayName != null && typeof displayName !== 'string')
            throw new Error('invalid-name');
        const base = (rawId ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '') || ('pet-' + Date.now().toString(36));
        if (!/^[a-z0-9][a-z0-9-]*$/.test(base))
            throw new Error('invalid-id');
        const typedName = (displayName ?? '').trim().slice(0, 80);
        const name = typedName === '' ? base : typedName;
        if (buffer.length === 0)
            throw new Error('empty-file');
        const ext = detectImageExt(buffer);
        if (ext === null)
            throw new Error('unsupported-image (use .webp/.png/.gif)');
        const version = detectSpriteVersion(buffer);
        if (version === null)
            throw new Error('not-a-codex-atlas (expected 1536x1872 v1 or 1536x2288 v2)');
        // Update-in-place only when the user re-imports the same pet on purpose
        // (same id and the same explicitly typed name); any other collision gets a
        // fresh suffixed id so previously imported pets are never overwritten.
        const existing = this.registry.byId(base);
        const isUpdate = existing !== undefined && typedName !== '' && existing.displayName === typedName;
        let id = base;
        let n = 2;
        while (!isUpdate && (this.registry.byId(id) !== undefined || existsSync(join(this.petsDir, id)))) {
            id = base + '-' + String(n);
            n += 1;
        }
        const dir = join(this.petsDir, id);
        mkdirSync(dir, { recursive: true });
        const file = 'spritesheet' + ext;
        writeFileSync(join(dir, file), buffer);
        const manifest = { id, displayName: name, spritesheetPath: file, spriteVersionNumber: version };
        writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        const entry = resolvePetManifest(manifest, dir, { assetPrefix: '/codex-pet' });
        if (entry === undefined)
            throw new Error('manifest-invalid');
        this.registry.add(entry);
        this.persist.petId = id;
        this.save();
        return this.state();
    }
    /**
     * Apply a resolved settings-section value back into the persisted state.
     * Changing the pin clears any dragged left/top so the new corner takes
     * effect immediately.
     * @param section - the resolved section value.
     */
    applySettingsSection(section) {
        const s = asRecord(section);
        if (Object.keys(s).length === 0)
            return;
        const d = this.persist.display;
        if (typeof s.visible === 'boolean')
            d.visible = s.visible;
        if (typeof s.mouseTracking === 'boolean')
            d.mouseTracking = s.mouseTracking;
        if (typeof s.size === 'number')
            d.size = Math.max(32, Math.min(512, Math.round(s.size)));
        if (typeof s.pin === 'string') {
            if (d.pin !== s.pin) {
                d.pin = s.pin;
                d.left = null;
                d.top = null;
            }
        }
        if (typeof s.petId === 'string' && this.registry.byId(s.petId) !== undefined) {
            this.persist.petId = s.petId;
        }
        this.save();
    }
}
/** Aux-call deadline: bounded so a stuck provider cannot hold the HTTP request. */
export const SUMMARY_TIMEOUT_MS = 90_000;
const SUMMARY_SYSTEM_PROMPT = [
    'You are Arya, the AI coding assistant, speaking through your pet form. The JSON contains structured records from a batch of model requests you just completed, including user instructions, your actions, tool calls, and errors.',
    'Report the batch progress in first person: what you did, which tools you used, and whether you encountered errors.',
    'Return only the spoken update, without a title, numbering, Markdown, or explanation. Keep it under 100 words and use natural conversational English, as if Arya is speaking.',
].join('\n');
/**
 * Validate one browser-supplied summary request.
 * @param payload - the request body.
 * @returns the request with every field checked and every string bounded.
 */
function validateSummaryPayload(payload) {
    const body = asRecord(payload);
    const sessionId = requireSessionId(body.sessionId);
    const { fromRequestSeq, toRequestSeq } = body;
    if (!Number.isSafeInteger(fromRequestSeq) || !Number.isSafeInteger(toRequestSeq)
        || fromRequestSeq < 0 || toRequestSeq < fromRequestSeq)
        throw new Error('invalid-request-range');
    if (!Array.isArray(body.requests) || body.requests.length === 0 || body.requests.length > 50) {
        throw new Error('invalid-requests');
    }
    let previousSeq = fromRequestSeq - 1;
    const requests = body.requests.map((rawRequest) => {
        const request = asRecord(rawRequest);
        const requestSeq = request.requestSeq;
        const turn = request.turn;
        const step = request.step;
        if (!Number.isSafeInteger(requestSeq) || requestSeq < fromRequestSeq
            || requestSeq > toRequestSeq || requestSeq <= previousSeq)
            throw new Error('invalid-request-record');
        if (!Number.isSafeInteger(turn) || turn < 0 || !Number.isSafeInteger(step) || step < 1) {
            throw new Error('invalid-request-record');
        }
        previousSeq = requestSeq;
        const actions = Array.isArray(request.actions) ? request.actions.slice(0, 80) : [];
        return {
            requestSeq: requestSeq,
            turn: turn,
            step: step,
            user: typeof request.user === 'string' ? request.user.slice(0, 400) : '',
            assistant: typeof request.assistant === 'string' ? request.assistant.slice(0, 400) : '',
            error: typeof request.error === 'string' ? request.error.slice(0, 200) : '',
            actions: actions.map((rawAction) => {
                const action = asRecord(rawAction);
                return {
                    tool: (typeof action.tool === 'string' ? action.tool : '?').slice(0, 60),
                    detail: typeof action.detail === 'string' ? action.detail.slice(0, 120) : '',
                    failed: action.failed === true,
                };
            }),
        };
    });
    const first = requests[0];
    const last = requests[requests.length - 1];
    if (first === undefined || last === undefined
        || first.requestSeq !== fromRequestSeq || last.requestSeq !== toRequestSeq) {
        throw new Error('invalid-request-range');
    }
    return { sessionId, fromRequestSeq: fromRequestSeq, toRequestSeq: toRequestSeq, requests };
}
/**
 * Read one session id from untrusted input.
 * @param sessionId - candidate value.
 * @returns the non-blank session id.
 */
function requireSessionId(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0)
        throw new Error('invalid-session-id');
    return sessionId;
}
/**
 * Project one journal record for the browser.
 * @param record - the persisted record.
 * @returns the browser-visible summary.
 */
function summaryResult(record) {
    return {
        summary: record.summary,
        provider: record.provider,
        model: record.model,
        fromRequestSeq: record.fromRequestSeq,
        toRequestSeq: record.toRequestSeq,
        requestCount: record.requestCount,
    };
}
/**
 * Pick the explicitly configured LLM route for one auxiliary summary call.
 * @param llm - the LLM service.
 * @param cfg - the persisted summary settings.
 * @returns the route to call.
 */
function resolveSummaryRoute(llm, cfg) {
    if (cfg.provider === '' || cfg.model === '')
        throw new Error('summary-route-not-configured');
    const providers = llm.listProviders();
    if (providers.length === 0)
        throw new Error('no-llm-provider-registered');
    const provider = providers.find(item => item.id === cfg.provider);
    if (provider === undefined)
        throw new Error('summary-provider-not-found-' + cfg.provider);
    return { provider: provider.id, model: cfg.model };
}
/**
 * One plugin-sourced user message carrying plain text.
 * @param text - the message body.
 * @returns the message in the LLM service's vocabulary.
 */
function createUserTextMessage(text) {
    return {
        role: 'user',
        content: [{ type: 'text', text }],
    };
}
/**
 * Run one streaming completion and join its text deltas. Only an explicit stop
 * finish is successful; a truncated iterator must not be journaled as a reply.
 * @param llm - the LLM service.
 * @param options - the completion request.
 * @returns the assembled text.
 */
async function streamText(llm, options) {
    let text = '';
    let finish = null;
    for await (const chunk of llm.stream(options)) {
        if (chunk.type === 'text-delta')
            text += chunk.text;
        else if (chunk.type === 'finish')
            finish = chunk.reason;
    }
    if (finish === null)
        throw new Error('summary-llm-stream-incomplete');
    if (finish.kind !== 'stop') {
        if (finish.kind === 'aborted' || finish.kind === 'error') {
            throw new Error('summary-llm-' + finish.kind + ': ' + (finish.failure.message));
        }
        throw new Error('summary-llm-finish-' + finish.kind);
    }
    return text;
}
/**
 * List a directory's file names.
 * @param dir - directory to list.
 * @returns the names, or none when the directory is missing or unreadable.
 */
function readdirSyncSafe(dir) {
    try {
        return readdirSync(dir);
    }
    catch {
        // A missing or unreadable directory contributes no takes; callers fall through.
        return [];
    }
}
/**
 * Detect an audio container from the header bytes.
 * @param buffer - the leading bytes of an audio file.
 * @returns the extension including the dot, or null when unrecognized.
 */
function detectAudioExt(buffer) {
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE')
        return '.wav';
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 3) === 'ID3')
        return '.mp3';
    if (buffer.length >= 2 && buffer.readUInt8(0) === 0xff && (buffer.readUInt8(1) & 0xe0) === 0xe0)
        return '.mp3';
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS')
        return '.ogg';
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp')
        return '.m4a';
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC')
        return '.flac';
    if (buffer.length >= 4 && buffer.readUInt8(0) === 0x1a && buffer.readUInt8(1) === 0x45
        && buffer.readUInt8(2) === 0xdf && buffer.readUInt8(3) === 0xa3)
        return '.webm';
    return null;
}
//# sourceMappingURL=service.js.map