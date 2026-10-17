import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
/**
* Absolute package root, resolved from a module URL.
* @param importMetaUrl - the importing module's `import.meta.url`.
* @returns the package root, one level above `src/` or `lib/`.
*/
function petPackageRoot(importMetaUrl) {
	return fileURLToPath(new URL("../", importMetaUrl));
}
/**
* DSH home directory.
* @param env - environment to read; defaults to `process.env`.
* @param home - the account home directory.
* @returns `$DSH_HOME` when set and non-blank, otherwise `<home>/.dsh`.
*/
function dshHome(env = process.env, home = homedir()) {
	const raw = env.DSH_HOME;
	return raw !== void 0 && raw.trim() !== "" ? raw.trim() : join(home, ".dsh");
}
/**
* The user pets directory.
* @param env - environment to read; defaults to `process.env`.
* @param home - the account home directory.
* @returns `${DSH_HOME:-~/.dsh}/pets`.
*/
function userPetsDir(env = process.env, home = homedir()) {
	return join(dshHome(env, home), "pets");
}
/**
* Read image dimensions from a WebP, PNG, or GIF header without decoding.
* @param buffer - the leading bytes of an image file.
* @returns the dimensions, or null when the format is unrecognized.
*/
function detectDimensions(buffer) {
	if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
		const chunk = buffer.toString("ascii", 12, 16);
		if (chunk === "VP8X" && buffer.length >= 30) return {
			width: 1 + (buffer.readUInt8(24) | buffer.readUInt8(25) << 8 | buffer.readUInt8(26) << 16),
			height: 1 + (buffer.readUInt8(27) | buffer.readUInt8(28) << 8 | buffer.readUInt8(29) << 16)
		};
		if (chunk === "VP8L" && buffer.length >= 25) {
			const b0 = buffer.readUInt8(21);
			const b1 = buffer.readUInt8(22);
			const b2 = buffer.readUInt8(23);
			const b3 = buffer.readUInt8(24);
			return {
				width: ((b1 & 63) << 8 | b0) + 1,
				height: ((b3 & 15) << 10 | b2 << 2 | b1 >> 6) + 1
			};
		}
		if (chunk === "VP8 " && buffer.length >= 27) return {
			width: (buffer.readUInt8(23) | buffer.readUInt8(24) << 8) & 16383,
			height: (buffer.readUInt8(25) | buffer.readUInt8(26) << 8) & 16383
		};
	}
	if (buffer.length >= 24 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20)
	};
	if (buffer.length >= 10) {
		const sig = buffer.toString("ascii", 0, 6);
		if (sig === "GIF87a" || sig === "GIF89a") return {
			width: buffer.readUInt16LE(6),
			height: buffer.readUInt16LE(8)
		};
	}
	return null;
}
/**
* Auto-detect the Arya atlas version from the image dimensions.
* @param buffer - the leading bytes of an atlas image.
* @returns 1 or 2, or null when the dimensions match neither contract.
*/
function detectSpriteVersion(buffer) {
	const dim = detectDimensions(buffer);
	if (dim === null) return null;
	if (dim.width === 1536 && dim.height === 1872) return 1;
	if (dim.width === 1536 && dim.height === 2288) return 2;
	return null;
}
/**
* Detect the image file extension from its header.
* @param buffer - the leading bytes of an image file.
* @returns the extension including the dot, or null when unrecognized.
*/
function detectImageExt(buffer) {
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
	if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return ".png";
	if (buffer.length >= 6) {
		const sig = buffer.toString("ascii", 0, 6);
		if (sig === "GIF87a" || sig === "GIF89a") return ".gif";
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
	const rel = file.split("/").filter((segment) => segment !== "").join("/");
	return prefix + "/" + encodeURIComponent(id) + "/" + rel;
}
/**
* Read a bounded integer, falling back when the value is not one.
* @param value - the manifest value to check.
* @param fallback - value used when the check fails.
* @param max - inclusive upper bound.
* @returns the value, or the fallback.
*/
function finiteInt(value, fallback, max) {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}
/** One manifest field read as a trimmed, non-blank string. */
function trimmedString(value) {
	return typeof value === "string" ? value.trim() : "";
}
/**
* Normalize one parsed manifest into a renderable pet entry.
* @param raw - parsed `pet.json`, from a file rather than from this process.
* @param dir - absolute directory holding the manifest.
* @param options - asset prefix and the warning collector.
* @returns the entry, or undefined after recording why the manifest was refused.
*/
function resolvePetManifest(raw, dir, options = {}) {
	const { assetPrefix = "/codex-pet", warnings = [] } = options;
	const warn = (message) => {
		warnings.push(message);
	};
	if (typeof raw !== "object" || raw === null) {
		warn("manifest is not an object");
		return;
	}
	const manifest = raw;
	const id = trimmedString(manifest.id);
	if (!ID_PATTERN.test(id)) {
		warn("manifest id " + JSON.stringify(String(manifest.id)) + " is not a lowercase kebab id");
		return;
	}
	const displayName = trimmedString(manifest.displayName) !== "" ? trimmedString(manifest.displayName).slice(0, 80) : id;
	const description = trimmedString(manifest.description);
	const spritesheet = trimmedString(manifest.spritesheetPath) !== "" ? trimmedString(manifest.spritesheetPath) : "spritesheet.webp";
	const segments = spritesheet.split("/").filter((segment) => segment !== "");
	if (segments.length === 0 || spritesheet.includes("\\") || segments.some((segment) => segment === ".." || !SEGMENT_PATTERN.test(segment))) {
		warn("manifest " + id + ": spritesheetPath " + JSON.stringify(spritesheet) + " is not a safe relative path");
		return;
	}
	let spriteVersionNumber = manifest.spriteVersionNumber === 1 || manifest.spriteVersionNumber === 2 ? manifest.spriteVersionNumber : null;
	if (spriteVersionNumber === null) {
		const atlasFile = join(dir, segments.join("/"));
		if (existsSync(atlasFile)) try {
			spriteVersionNumber = detectSpriteVersion(readFileSync(atlasFile));
		} catch {}
	}
	if (spriteVersionNumber === null) spriteVersionNumber = 2;
	const size = finiteInt(manifest.size, 120, 512);
	const pin = typeof manifest.pin === "string" ? manifest.pin : "bottom-right";
	return {
		id,
		displayName,
		description,
		spriteVersionNumber,
		size,
		pin,
		cell: {
			width: 192,
			height: 208
		},
		columns: 8,
		rows: spriteVersionNumber === 2 ? 11 : 9,
		atlasUrl: assetUrl(assetPrefix, id, spritesheet),
		manifestUrl: assetUrl(assetPrefix, id, "pet.json"),
		dir,
		spritesheetPath: segments.join("/")
	};
}
/**
* Scan one directory of pet folders.
* @param dir - directory whose child folders may each hold a `pet.json`.
* @param options - asset prefix and the warning collector.
* @returns entries in directory-name order; a missing or unreadable directory yields none.
*/
function scanPetDir(dir, options) {
	if (!existsSync(dir)) return [];
	let names = [];
	try {
		names = readdirSync(dir).filter((name) => !name.startsWith("."));
	} catch {
		return [];
	}
	names.sort();
	const entries = [];
	for (const name of names) {
		const manifestFile = join(dir, name, "pet.json");
		if (!existsSync(manifestFile)) continue;
		let parsed;
		try {
			parsed = JSON.parse(readFileSync(manifestFile, "utf8"));
		} catch (error) {
			options.warnings.push("skipping " + manifestFile + ": " + (error instanceof Error ? error.message : String(error)));
			continue;
		}
		const entry = resolvePetManifest(parsed, join(dir, name), options);
		if (entry !== void 0) entries.push(entry);
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
function loadPetRegistry(options) {
	const { packageRoot, assetPrefix = "/codex-pet", petsDir } = options;
	const warnings = [];
	const byId = /* @__PURE__ */ new Map();
	for (const entry of scanPetDir(join(packageRoot, "assets"), {
		assetPrefix,
		warnings
	})) if (!byId.has(entry.id)) byId.set(entry.id, entry);
	const dir = petsDir !== void 0 ? petsDir : userPetsDir();
	for (const entry of scanPetDir(dir, {
		assetPrefix,
		warnings
	})) {
		if (byId.has(entry.id)) warnings.push("user pet " + entry.id + " overrides the built-in one");
		byId.set(entry.id, entry);
	}
	const entries = [...byId.values()];
	return {
		entries,
		warnings,
		byId: (id) => byId.get(id),
		defaultEntry: () => entries[0],
		add(entry) {
			byId.set(entry.id, entry);
			entries.splice(0, entries.length, ...byId.values());
		}
	};
}
/**
* Strip host-only fields, leaving the client-visible definition.
* @param entry - the host-side entry.
* @returns the same pet without `dir` and `spritesheetPath`.
*/
function petEntryView(entry) {
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
		manifestUrl: entry.manifestUrl
	};
}
//#endregion
//#region src/service.ts
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
const PERSIST_FILE = "codex-pet.json";
const DEFAULT_DISPLAY = {
	visible: true,
	size: 120,
	pin: "bottom-right",
	left: null,
	top: null,
	bubbleTheme: "gray",
	bubbleOpacity: 94,
	mouseTracking: true
};
/** Periodic request-summary defaults. A route must be selected before enabling. */
const DEFAULT_SUMMARY = {
	enabled: false,
	intervalRequests: 5,
	provider: "",
	model: "",
	maxChars: 220,
	bubbleSeconds: 12
};
/** Scenario voice defaults; volume is 0..100. */
const DEFAULT_SOUND = {
	enabled: true,
	volume: 60,
	tracks: {
		done: {
			enabled: true,
			volume: 100
		},
		error: {
			enabled: true,
			volume: 100
		},
		interrupt: {
			enabled: true,
			volume: 100
		}
	}
};
/**
* User-replaceable chime directory.
* @param env - environment carrying `DSH_HOME`.
* @returns `${DSH_HOME:-~/.dsh}/pets/sounds`.
*/
function userSoundsDir(env = process.env) {
	return join(dshHome(env), "pets", "sounds");
}
const SOUND_EXTS = [
	".wav",
	".mp3",
	".ogg",
	".m4a",
	".flac",
	".webm"
];
/** Scenario tracks that can each carry an override file and their own volume. */
const TRACK_IDS = [
	"done",
	"error",
	"interrupt"
];
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
	return typeof value === "object" && value !== null ? value : {};
}
/**
* Normalize one untrusted summary section into the persisted snapshot.
* @param raw - the section as read from disk or supplied by the browser.
* @returns a section whose fields are all in range.
*/
function sanitizeSummary(raw) {
	const src = asRecord(raw);
	const interval = src.intervalRequests ?? src.intervalTurns;
	const provider = typeof src.provider === "string" ? src.provider.trim().slice(0, 120) : "";
	const model = typeof src.model === "string" ? src.model.trim().slice(0, 160) : "";
	return {
		enabled: src.enabled === true && provider !== "" && model !== "",
		intervalRequests: clampInt(interval, 1, 50, DEFAULT_SUMMARY.intervalRequests),
		provider,
		model,
		maxChars: clampInt(src.maxChars, 60, 800, DEFAULT_SUMMARY.maxChars),
		bubbleSeconds: clampInt(src.bubbleSeconds, 3, 120, DEFAULT_SUMMARY.bubbleSeconds)
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
		const legacyEnabled = rawEvents[id] !== void 0 ? rawEvents[id] !== false : void 0;
		tracks[id] = {
			enabled: track.enabled !== void 0 ? track.enabled !== false : legacyEnabled ?? true,
			volume: clampInt(track.volume, 0, 100, 100)
		};
	}
	return {
		enabled: src.enabled !== false,
		volume: clampInt(src.volume, 0, 100, DEFAULT_SOUND.volume),
		tracks
	};
}
/**
* The persisted snapshot's path.
* @param env - environment carrying `DSH_HOME`.
* @returns the absolute path of the persistence file.
*/
function persistPath(env = process.env) {
	return join(dshHome(env), PERSIST_FILE);
}
/**
* Read one track's name from untrusted input.
* @param track - candidate track id.
* @returns whether the value names a known track.
*/
function isTrackId(track) {
	return typeof track === "string" && TRACK_IDS.includes(track);
}
/** Owns the persisted pet selection, its display config, and the sound overrides. */
var PetService = class {
	/** The registry this service reads and extends; the asset route serves from it. */
	registry;
	env;
	file;
	petsDir;
	soundsDir;
	journalDir;
	builtInSoundDir;
	summaryInflight = /* @__PURE__ */ new Map();
	pulses = {
		error: {
			at: 0,
			sessionId: ""
		},
		interrupt: {
			at: 0,
			sessionId: ""
		}
	};
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
		this.journalDir = join(dshHome(this.env), "codex-pet-journal");
		this.builtInSoundDir = packageRoot === void 0 ? null : join(packageRoot, "assets", "sounds");
		this.persist = this.load();
		if (this.persist.petId === null || this.registry.byId(this.persist.petId) === void 0) {
			const fallback = this.registry.defaultEntry();
			this.persist.petId = fallback === void 0 ? null : fallback.id;
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
			sound: {
				...DEFAULT_SOUND,
				tracks: { ...DEFAULT_SOUND.tracks }
			}
		};
		if (!existsSync(this.file)) return base;
		try {
			const parsed = asRecord(JSON.parse(readFileSync(this.file, "utf8")));
			return {
				petId: typeof parsed.petId === "string" ? parsed.petId : null,
				display: {
					...DEFAULT_DISPLAY,
					...asRecord(parsed.display)
				},
				summary: sanitizeSummary(parsed.summary),
				sound: sanitizeSound(parsed.sound)
			};
		} catch {
			return base;
		}
	}
	/** Write the snapshot, reporting a failure rather than propagating it. */
	save() {
		try {
			writeFileSync(this.file, JSON.stringify(this.persist, null, 2) + "\n", "utf8");
		} catch (error) {
			console.warn("[dsh-arya-pet] could not persist state:", error);
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
	customSoundFile(track = "done") {
		if (!isTrackId(track)) return null;
		if (!existsSync(this.soundsDir)) return null;
		let names = [];
		try {
			names = readdirSync(this.soundsDir);
		} catch {
			return null;
		}
		for (const ext of SOUND_EXTS) if (names.includes(track + ext)) {
			const file = join(this.soundsDir, track + ext);
			if (existsSync(file)) return file;
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
	saveSound(buffer, track = "done") {
		if (!isTrackId(track)) throw new Error("unknown-track");
		const ext = detectAudioExt(buffer);
		if (ext === null) throw new Error("unsupported-audio (use .wav/.mp3/.ogg/.m4a/.flac/.webm)");
		if (buffer.length === 0) throw new Error("empty-file");
		if (buffer.length > 8 * 1024 * 1024) throw new Error("file-too-large (max 8MB)");
		mkdirSync(this.soundsDir, { recursive: true });
		for (const other of SOUND_EXTS) if (other !== ext) rmSync(join(this.soundsDir, track + other), { force: true });
		writeFileSync(join(this.soundsDir, track + ext), buffer);
		return this.state();
	}
	/**
	* Remove one track's override, so the built-in audio takes over again.
	* @param track - scenario track id.
	* @returns the resulting state projection.
	*/
	resetSound(track = "done") {
		if (!isTrackId(track)) throw new Error("unknown-track");
		for (const ext of SOUND_EXTS) rmSync(join(this.soundsDir, track + ext), { force: true });
		return this.state();
	}
	/**
	* Record a scenario event so the next state poll plays its voice line.
	* @param kind - scenario event.
	* @param sessionId - the session that owns the event.
	*/
	pulse(kind, sessionId = "") {
		const previous = this.pulses[kind].at;
		this.pulses[kind] = {
			at: Math.max(Date.now(), previous + 1),
			sessionId
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
		if (!isTrackId(track)) return null;
		const custom = this.customSoundFile(track);
		if (custom !== null) return custom;
		if (this.builtInSoundDir !== null) {
			const takes = readdirSyncSafe(this.builtInSoundDir).filter((name) => name.startsWith(track + "-") && SOUND_EXTS.some((ext) => name.endsWith(ext)));
			const take = takes[Math.floor(Math.random() * takes.length)];
			if (take !== void 0) return join(this.builtInSoundDir, take);
		}
		for (const ext of SOUND_EXTS) {
			const file = this.builtInSoundDir === null ? null : join(this.builtInSoundDir, track + ext);
			if (file !== null && existsSync(file)) return file;
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
		return join(this.journalDir, createHash("sha256").update(id).digest("hex") + ".jsonl");
	}
	/**
	* Append one summary record to its session's journal.
	* @param record - the record to persist.
	*/
	appendJournal(record) {
		requireSessionId(record.sessionId);
		mkdirSync(this.journalDir, { recursive: true });
		appendFileSync(this.journalFileFor(record.sessionId), JSON.stringify(record) + "\n", "utf8");
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
		if (!existsSync(file)) return [];
		const records = [];
		const lines = readFileSync(file, "utf8").split("\n");
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (line === void 0 || line === "") continue;
			try {
				records.push(JSON.parse(line));
			} catch {
				throw new Error("journal-invalid-jsonl:" + file + ":" + String(index + 1));
			}
		}
		return records;
	}
	/**
	* The full state projection the browser polls.
	* @returns selection, display, feature settings, the pet list, and pulses.
	*/
	state() {
		const entry = this.persist.petId === null ? void 0 : this.registry.byId(this.persist.petId);
		return {
			petId: this.persist.petId,
			display: this.persist.display,
			summary: this.persist.summary,
			sound: this.persist.sound,
			pet: entry === void 0 ? null : petEntryView(entry),
			pets: this.pets(),
			hasCustomSounds: {
				done: this.customSoundFile("done") !== null,
				error: this.customSoundFile("error") !== null,
				interrupt: this.customSoundFile("interrupt") !== null
			},
			pulses: { ...this.pulses }
		};
	}
	/**
	* Select one registered pet.
	* @param petId - the pet to select.
	* @returns the resulting state projection.
	*/
	setPetId(petId) {
		if (typeof petId !== "string" || this.registry.byId(petId) === void 0) throw new Error("invalid-pet");
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
		if (typeof p.size === "number") d.size = Math.max(32, Math.min(512, Math.round(p.size)));
		if (typeof p.pin === "string") d.pin = p.pin;
		if (typeof p.left === "number") d.left = Math.max(0, Math.round(p.left));
		if (typeof p.top === "number") d.top = Math.max(0, Math.round(p.top));
		if (typeof p.visible === "boolean") d.visible = p.visible;
		if (typeof p.mouseTracking === "boolean") d.mouseTracking = p.mouseTracking;
		if (typeof p.bubbleTheme === "string") d.bubbleTheme = p.bubbleTheme;
		if (typeof p.bubbleOpacity === "number") d.bubbleOpacity = Math.max(0, Math.min(100, Math.round(p.bubbleOpacity)));
		if (typeof p.summary === "object" && p.summary !== null) this.persist.summary = sanitizeSummary({
			...this.persist.summary,
			...asRecord(p.summary)
		});
		if (typeof p.sound === "object" && p.sound !== null) {
			const soundPatch = asRecord(p.sound);
			const tracks = typeof soundPatch.tracks === "object" && soundPatch.tracks !== null ? {
				...this.persist.sound.tracks,
				...asRecord(soundPatch.tracks)
			} : this.persist.sound.tracks;
			this.persist.sound = sanitizeSound({
				...this.persist.sound,
				...soundPatch,
				tracks
			});
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
		if (typeof visible !== "boolean") throw new Error("invalid-visible");
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
		const existing = this.journalRecords(sessionId).find((record) => record.sessionId === sessionId && record.fromRequestSeq === fromRequestSeq && record.toRequestSeq === toRequestSeq);
		if (existing !== void 0) return summaryResult(existing);
		const cfg = this.persist.summary;
		if (!cfg.enabled) throw new Error("summary-disabled");
		const key = JSON.stringify([
			sessionId,
			fromRequestSeq,
			toRequestSeq
		]);
		const inFlight = this.summaryInflight.get(key);
		if (inFlight !== void 0) return inFlight;
		const run = async () => {
			const route = resolveSummaryRoute(llm, cfg);
			const messages = [createUserTextMessage("Summarize the following JSON records from a completed batch of AI coding-assistant model requests:\n" + JSON.stringify(requests))];
			const trimmed = (await streamText(llm, {
				provider: route.provider,
				model: route.model,
				messages,
				system: SUMMARY_SYSTEM_PROMPT,
				maxTokens: 512,
				signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS)
			})).trim().slice(0, cfg.maxChars);
			if (trimmed.length === 0) throw new Error("summary-model-produced-no-text");
			const record = {
				sessionId,
				fromRequestSeq,
				toRequestSeq,
				requestCount: requests.length,
				provider: route.provider,
				model: route.model,
				summary: trimmed,
				createdAt: (/* @__PURE__ */ new Date()).toISOString()
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
		if (rawId != null && typeof rawId !== "string") throw new Error("invalid-id");
		if (displayName != null && typeof displayName !== "string") throw new Error("invalid-name");
		const base = (rawId ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "pet-" + Date.now().toString(36);
		if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) throw new Error("invalid-id");
		const typedName = (displayName ?? "").trim().slice(0, 80);
		const name = typedName === "" ? base : typedName;
		if (buffer.length === 0) throw new Error("empty-file");
		const ext = detectImageExt(buffer);
		if (ext === null) throw new Error("unsupported-image (use .webp/.png/.gif)");
		const version = detectSpriteVersion(buffer);
		if (version === null) throw new Error("not-a-codex-atlas (expected 1536x1872 v1 or 1536x2288 v2)");
		const existing = this.registry.byId(base);
		const isUpdate = existing !== void 0 && typedName !== "" && existing.displayName === typedName;
		let id = base;
		let n = 2;
		while (!isUpdate && (this.registry.byId(id) !== void 0 || existsSync(join(this.petsDir, id)))) {
			id = base + "-" + String(n);
			n += 1;
		}
		const dir = join(this.petsDir, id);
		mkdirSync(dir, { recursive: true });
		const file = "spritesheet" + ext;
		writeFileSync(join(dir, file), buffer);
		const manifest = {
			id,
			displayName: name,
			spritesheetPath: file,
			spriteVersionNumber: version
		};
		writeFileSync(join(dir, "pet.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
		const entry = resolvePetManifest(manifest, dir, { assetPrefix: "/codex-pet" });
		if (entry === void 0) throw new Error("manifest-invalid");
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
		if (Object.keys(s).length === 0) return;
		const d = this.persist.display;
		if (typeof s.visible === "boolean") d.visible = s.visible;
		if (typeof s.mouseTracking === "boolean") d.mouseTracking = s.mouseTracking;
		if (typeof s.size === "number") d.size = Math.max(32, Math.min(512, Math.round(s.size)));
		if (typeof s.pin === "string") {
			if (d.pin !== s.pin) {
				d.pin = s.pin;
				d.left = null;
				d.top = null;
			}
		}
		if (typeof s.petId === "string" && this.registry.byId(s.petId) !== void 0) this.persist.petId = s.petId;
		this.save();
	}
};
/** Aux-call deadline: bounded so a stuck provider cannot hold the HTTP request. */
const SUMMARY_TIMEOUT_MS = 9e4;
const SUMMARY_SYSTEM_PROMPT = [
	"You are Arya, the AI coding assistant, speaking through your pet form. The JSON contains structured records from a batch of model requests you just completed, including user instructions, your actions, tool calls, and errors.",
	"Report the batch progress in first person: what you did, which tools you used, and whether you encountered errors.",
	"Return only the spoken update, without a title, numbering, Markdown, or explanation. Keep it under 100 words and use natural conversational English, as if Arya is speaking."
].join("\n");
/**
* Validate one browser-supplied summary request.
* @param payload - the request body.
* @returns the request with every field checked and every string bounded.
*/
function validateSummaryPayload(payload) {
	const body = asRecord(payload);
	const sessionId = requireSessionId(body.sessionId);
	const { fromRequestSeq, toRequestSeq } = body;
	if (!Number.isSafeInteger(fromRequestSeq) || !Number.isSafeInteger(toRequestSeq) || fromRequestSeq < 0 || toRequestSeq < fromRequestSeq) throw new Error("invalid-request-range");
	if (!Array.isArray(body.requests) || body.requests.length === 0 || body.requests.length > 50) throw new Error("invalid-requests");
	let previousSeq = fromRequestSeq - 1;
	const requests = body.requests.map((rawRequest) => {
		const request = asRecord(rawRequest);
		const requestSeq = request.requestSeq;
		const turn = request.turn;
		const step = request.step;
		if (!Number.isSafeInteger(requestSeq) || requestSeq < fromRequestSeq || requestSeq > toRequestSeq || requestSeq <= previousSeq) throw new Error("invalid-request-record");
		if (!Number.isSafeInteger(turn) || turn < 0 || !Number.isSafeInteger(step) || step < 1) throw new Error("invalid-request-record");
		previousSeq = requestSeq;
		const actions = Array.isArray(request.actions) ? request.actions.slice(0, 80) : [];
		return {
			requestSeq,
			turn,
			step,
			user: typeof request.user === "string" ? request.user.slice(0, 400) : "",
			assistant: typeof request.assistant === "string" ? request.assistant.slice(0, 400) : "",
			error: typeof request.error === "string" ? request.error.slice(0, 200) : "",
			actions: actions.map((rawAction) => {
				const action = asRecord(rawAction);
				return {
					tool: (typeof action.tool === "string" ? action.tool : "?").slice(0, 60),
					detail: typeof action.detail === "string" ? action.detail.slice(0, 120) : "",
					failed: action.failed === true
				};
			})
		};
	});
	const first = requests[0];
	const last = requests[requests.length - 1];
	if (first === void 0 || last === void 0 || first.requestSeq !== fromRequestSeq || last.requestSeq !== toRequestSeq) throw new Error("invalid-request-range");
	return {
		sessionId,
		fromRequestSeq,
		toRequestSeq,
		requests
	};
}
/**
* Read one session id from untrusted input.
* @param sessionId - candidate value.
* @returns the non-blank session id.
*/
function requireSessionId(sessionId) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) throw new Error("invalid-session-id");
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
		requestCount: record.requestCount
	};
}
/**
* Pick the explicitly configured LLM route for one auxiliary summary call.
* @param llm - the LLM service.
* @param cfg - the persisted summary settings.
* @returns the route to call.
*/
function resolveSummaryRoute(llm, cfg) {
	if (cfg.provider === "" || cfg.model === "") throw new Error("summary-route-not-configured");
	const providers = llm.listProviders();
	if (providers.length === 0) throw new Error("no-llm-provider-registered");
	const provider = providers.find((item) => item.id === cfg.provider);
	if (provider === void 0) throw new Error("summary-provider-not-found-" + cfg.provider);
	return {
		provider: provider.id,
		model: cfg.model
	};
}
/**
* One plugin-sourced user message carrying plain text.
* @param text - the message body.
* @returns the message in the LLM service's vocabulary.
*/
function createUserTextMessage(text) {
	return {
		role: "user",
		content: [{
			type: "text",
			text
		}]
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
	let text = "";
	let finish = null;
	for await (const chunk of llm.stream(options)) if (chunk.type === "text-delta") text += chunk.text;
	else if (chunk.type === "finish") finish = chunk.reason;
	if (finish === null) throw new Error("summary-llm-stream-incomplete");
	if (finish.kind !== "stop") {
		if (finish.kind === "aborted" || finish.kind === "error") throw new Error("summary-llm-" + finish.kind + ": " + finish.failure.message);
		throw new Error("summary-llm-finish-" + finish.kind);
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
	} catch {
		return [];
	}
}
/**
* Detect an audio container from the header bytes.
* @param buffer - the leading bytes of an audio file.
* @returns the extension including the dot, or null when unrecognized.
*/
function detectAudioExt(buffer) {
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") return ".wav";
	if (buffer.length >= 4 && buffer.toString("ascii", 0, 3) === "ID3") return ".mp3";
	if (buffer.length >= 2 && buffer.readUInt8(0) === 255 && (buffer.readUInt8(1) & 224) === 224) return ".mp3";
	if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") return ".ogg";
	if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return ".m4a";
	if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") return ".flac";
	if (buffer.length >= 4 && buffer.readUInt8(0) === 26 && buffer.readUInt8(1) === 69 && buffer.readUInt8(2) === 223 && buffer.readUInt8(3) === 163) return ".webm";
	return null;
}
//#endregion
//#region src/routes.ts
/**
* Pet HTTP routes — the browser half talks to the host through plain
* same-origin JSON endpoints ('/api/codex-pet/*') and loads each pet's atlas
* from the '/codex-pet/<id>/*' asset route (the same pattern as the
* dsh-web-ui family's '/api/pet' + '/pet/<id>' routes). The asset route is one
* prefix registration serving every registry entry, so adding a pet never
* touches route wiring.
* @module dsh-arya-pet/routes
*/
/** HTTP prefix for pet management requests. */
const PET_API_PREFIX = "/api/codex-pet";
/** HTTP prefix serving installed pet assets. */
const PET_ASSET_PREFIX = "/codex-pet";
const MANIFEST_FILE = "pet.json";
/** HTTP route serving the configured pet sound. */
const SOUND_ROUTE = "/codex-pet-sound";
const MIME_BY_EXT = {
	".webp": "image/webp",
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".json": "application/json",
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".flac": "audio/flac",
	".webm": "audio/webm"
};
/**
* Content type for one file name.
* @param file - a file name or path.
* @returns the media type, defaulting to a binary stream.
*/
function mimeFor(file) {
	const dot = file.lastIndexOf(".");
	if (dot < 0) return "application/octet-stream";
	return MIME_BY_EXT[file.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
/**
* Write one JSON response.
* @param res - the response to write.
* @param status - HTTP status code.
* @param body - value to serialize.
*/
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
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
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 64 * 1024) {
				reject(/* @__PURE__ */ new Error("body-too-large"));
				queueMicrotask(() => req.destroy());
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(/* @__PURE__ */ new Error("invalid-json"));
			}
		});
		req.on("error", reject);
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
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(/* @__PURE__ */ new Error("file-too-large"));
				queueMicrotask(() => req.destroy());
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks));
		});
		req.on("error", reject);
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
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve().then(run).then((value) => {
				json(res, 200, value);
			}, (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
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
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return;
			return readJsonBody(req).then((body) => {
				const record = typeof body === "object" && body !== null ? body : {};
				return Promise.resolve().then(() => run(record)).then((value) => {
					json(res, 200, value);
				}, (error) => {
					json(res, 400, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
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
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405);
			res.end();
			return;
		}
		let pathname;
		try {
			pathname = new URL(req.url ?? "/", "http://codex-pet.local").pathname;
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}
		const segments = pathname.split("/").filter((segment) => segment !== "");
		if (segments[0] !== "codex-pet" || segments[1] === void 0) {
			res.writeHead(404);
			res.end();
			return;
		}
		let id;
		try {
			id = decodeURIComponent(segments[1]);
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}
		const entry = service.registry.byId(id);
		if (entry === void 0) {
			res.writeHead(404);
			res.end();
			return;
		}
		const rest = [];
		for (const segment of segments.slice(2)) {
			let decoded;
			try {
				decoded = decodeURIComponent(segment);
			} catch {
				res.writeHead(400);
				res.end();
				return;
			}
			rest.push(decoded);
		}
		const rel = rest.join("/");
		let file;
		let synthesized = false;
		if (rest.length === 1 && rest[0] === MANIFEST_FILE) {
			const manifestFile = join(entry.dir, MANIFEST_FILE);
			if (existsSync(manifestFile)) file = manifestFile;
			else synthesized = true;
		} else if (rest.length > 0 && rel === entry.spritesheetPath) file = join(entry.dir, entry.spritesheetPath);
		if (synthesized) {
			const body = Buffer.from(JSON.stringify(petEntryView(entry), null, 2), "utf8");
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"content-length": String(body.byteLength),
				"cache-control": "no-cache"
			});
			if (req.method === "HEAD") {
				res.end();
				return;
			}
			res.end(body);
			return;
		}
		if (file === void 0) {
			res.writeHead(404);
			res.end();
			return;
		}
		const resolved = file;
		readFile(resolved).then((body) => {
			res.writeHead(200, {
				"content-type": mimeFor(resolved),
				"content-length": String(body.byteLength),
				"cache-control": "no-cache"
			});
			if (req.method === "HEAD") {
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
		kind: "exact",
		path: "/api/codex-pet/import",
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return;
			let id = "";
			let name = "";
			try {
				const params = new URL(req.url ?? "/", "http://codex-pet.local").searchParams;
				id = params.get("id") ?? "";
				name = params.get("name") ?? "";
			} catch {
				json(res, 400, {
					ok: false,
					error: "invalid-url"
				});
				return;
			}
			return readRawBody(req, 20 * 1024 * 1024).then((buffer) => {
				json(res, 200, service.importPet(id, name, buffer));
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
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
		kind: "exact",
		path: SOUND_ROUTE,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			const track = trackParam(req);
			if (track === null) {
				json(res, 400, {
					ok: false,
					error: "unknown-track"
				});
				return;
			}
			const file = service.trackFile(track);
			if (file === null) {
				json(res, 404, {
					ok: false,
					error: "no-sound-file"
				});
				return;
			}
			return readFile(file).then((body) => {
				res.writeHead(200, {
					"content-type": mimeFor(file),
					"content-length": String(body.byteLength),
					"cache-control": "no-cache"
				});
				res.end(body);
			}, () => {
				json(res, 404, {
					ok: false,
					error: "sound-file-unreadable"
				});
			});
		}
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
		const value = new URL(req.url ?? "/", "http://codex-pet.local").searchParams.get("track");
		if (value === null) return "done";
		return value === "done" || value === "error" || value === "interrupt" ? value : null;
	} catch {
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
		kind: "exact",
		path: "/api/codex-pet/sound",
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return;
			const track = trackParam(req);
			if (track === null) {
				json(res, 400, {
					ok: false,
					error: "unknown-track"
				});
				return;
			}
			return readRawBody(req, 8 * 1024 * 1024).then((buffer) => service.saveSound(buffer, track)).then((state) => {
				json(res, 200, state);
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/**
* Drop one track's chime, so the built-in default takes over again.
* @param service - the service owning the sound overrides.
* @returns the route registration.
*/
function resetSoundRoute(service) {
	return {
		kind: "exact",
		path: "/api/codex-pet/reset-sound",
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return;
			const track = trackParam(req);
			if (track === null) {
				json(res, 400, {
					ok: false,
					error: "unknown-track"
				});
				return;
			}
			Promise.resolve().then(() => service.resetSound(track)).then((state) => {
				json(res, 200, state);
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/**
* Resolve the LLM service, refusing when the profile mounts no adapter.
* @param getLlm - the resolver.
* @returns the LLM service.
*/
function requireLlm(getLlm) {
	const llm = getLlm();
	if (llm === null || llm === void 0) throw new Error("no-llm-service");
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
	return getRoute("/api/codex-pet/models", async () => {
		const llm = requireLlm(getLlm);
		const providers = [];
		for (const info of llm.listProviders()) try {
			const models = await llm.listModels(info.id);
			providers.push({
				id: info.id,
				name: providerName(info),
				models: (Array.isArray(models) ? models : []).map((m) => ({
					id: m.id,
					name: m.name
				}))
			});
		} catch (error) {
			providers.push({
				id: info.id,
				name: providerName(info),
				models: [],
				error: error instanceof Error ? error.message : String(error)
			});
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
	return postRoute("/api/codex-pet/summarize", (body) => options.service.summarizeRequests(requireLlm(options.getLlm), body));
}
/**
* AI-view summaries for one session, as
* `GET /journal?session=<id>&limit=<n>&all=1`.
* @param service - the service owning the journal.
* @returns the route registration.
*/
function journalRoute(service) {
	return {
		kind: "exact",
		path: "/api/codex-pet/journal",
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			let session = "";
			let limit = 50;
			let all = false;
			try {
				const params = new URL(req.url ?? "/", "http://codex-pet.local").searchParams;
				session = params.get("session") ?? "";
				limit = Number(params.get("limit") ?? 50);
				all = params.get("all") === "1";
			} catch {
				json(res, 400, {
					ok: false,
					error: "invalid-url"
				});
				return;
			}
			if (session.trim() === "") {
				json(res, 400, {
					ok: false,
					error: "missing-session"
				});
				return;
			}
			const bound = Number.isFinite(limit) ? limit : 50;
			Promise.resolve().then(() => all ? service.journalRecords(session) : service.journalList(session, bound)).then((records) => {
				json(res, 200, { records });
			}, (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/**
* Build the full route family (API and assets) for one service.
* @param options - the service and the LLM resolver.
* @returns every registration, in mount order.
*/
function makeCodexPetRoutes(options) {
	const { service, getLlm } = options;
	const routes = [
		getRoute("/api/codex-pet/pets", () => ({ pets: service.pets() })),
		getRoute("/api/codex-pet/state", () => service.state()),
		postRoute("/api/codex-pet/set-pet", (body) => service.setPetId(body.petId)),
		postRoute("/api/codex-pet/set-config", (body) => service.setConfig(body)),
		postRoute("/api/codex-pet/set-visible", (body) => service.setVisible(body.visible)),
		importRoute(service),
		soundRoute(service),
		uploadSoundRoute(service),
		resetSoundRoute(service),
		{
			kind: "prefix",
			path: PET_ASSET_PREFIX,
			handler: assetHandler(service)
		}
	];
	routes.push(modelsRoute(getLlm), summarizeRoute(options), journalRoute(service));
	return routes;
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "arya-pet";
/**
* The web server is required to mount the base pet. LLM is optional because
* summary routes report a clear error when an adapter is not installed.
*/
const inject = ["webServer"];
/**
* Register the pet service and its API and asset routes on the context.
* @param ctx - context carrying the web server.
* @param config - optional registry, LLM, and environment overrides.
*/
function apply(ctx, config = {}) {
	const packageRoot = petPackageRoot(import.meta.url);
	const service = new PetService({
		registry: config.registry ?? loadPetRegistry({ packageRoot }),
		env: config.env,
		packageRoot
	});
	const getLlm = () => config.llm ?? ctx.get("llm") ?? null;
	const routes = makeCodexPetRoutes({
		service,
		getLlm
	});
	ctx.effect(() => {
		const disposers = routes.map((route) => ctx.webServer.register(route));
		return () => {
			for (const dispose of disposers) dispose();
		};
	}, "codex-pet: routes");
	ctx.effect(() => {
		const offError = ctx.on("agent/error", ({ agent }) => {
			service.pulse("error", agent.id);
		});
		return () => {
			offError();
		};
	}, "codex-pet: scenario-events");
}
//#endregion
export { PET_API_PREFIX, PET_ASSET_PREFIX, PetService, SOUND_ROUTE, SUMMARY_TIMEOUT_MS, apply, inject, loadPetRegistry, makeCodexPetRoutes, name, persistPath, petEntryView, petPackageRoot, userPetsDir, userSoundsDir };
