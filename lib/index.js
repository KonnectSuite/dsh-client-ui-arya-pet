import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
/** Absolute package root, resolved from a module URL (src/ or lib/). */
function petPackageRoot(importMetaUrl) {
	return fileURLToPath(new URL("../", importMetaUrl));
}
/** DSH home directory: $DSH_HOME or ~/.dsh. */
function dshHome(env = process.env, home = homedir()) {
	const raw = env && env.DSH_HOME;
	return raw && raw.trim() !== "" ? raw.trim() : join(home, ".dsh");
}
/** The user pets directory: ${DSH_HOME:-~/.dsh}/pets. */
function userPetsDir(env = process.env, home = homedir()) {
	return join(dshHome(env, home), "pets");
}
/**
* Read image dimensions from a WebP/PNG/GIF header (no decode). Returns null
* when the format is unrecognised. Ported from the codex-to-dsh-pet build.js.
*/
function detectDimensions(buffer) {
	if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
		const chunk = buffer.toString("ascii", 12, 16);
		if (chunk === "VP8X" && buffer.length >= 30) return {
			width: 1 + (buffer[24] | buffer[25] << 8 | buffer[26] << 16),
			height: 1 + (buffer[27] | buffer[28] << 8 | buffer[29] << 16)
		};
		if (chunk === "VP8L" && buffer.length >= 25) {
			const b0 = buffer[21], b1 = buffer[22], b2 = buffer[23], b3 = buffer[24];
			return {
				width: ((b1 & 63) << 8 | b0) + 1,
				height: ((b3 & 15) << 10 | b2 << 2 | b1 >> 6) + 1
			};
		}
		if (chunk === "VP8 " && buffer.length >= 27) return {
			width: (buffer[23] | buffer[24] << 8) & 16383,
			height: (buffer[25] | buffer[26] << 8) & 16383
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
/** Auto-detect the Arya atlas version from the image dimensions. */
function detectSpriteVersion(buffer) {
	const dim = detectDimensions(buffer);
	if (!dim) return null;
	if (dim.width === 1536 && dim.height === 1872) return 1;
	if (dim.width === 1536 && dim.height === 2288) return 2;
	return null;
}
/** Detect the image file extension from its header ('.webp'/'.png'/'.gif'), or null. */
function detectImageExt(buffer) {
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
	if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return ".png";
	if (buffer.length >= 6) {
		const sig = buffer.toString("ascii", 0, 6);
		if (sig === "GIF87a" || sig === "GIF89a") return ".gif";
	}
	return null;
}
/** Build the browser URL of one pet asset. */
function assetUrl(prefix, id, file) {
	const rel = String(file).split("/").filter((segment) => segment !== "").join("/");
	return prefix + "/" + encodeURIComponent(id) + "/" + rel;
}
/** Finite integer guard, else the fallback (0 disables the value). */
function finiteInt(value, fallback, max) {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}
/**
* Normalize one parsed manifest into a renderable pet entry, or undefined
* (with a warning recorded) when the manifest violates the contract.
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
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!ID_PATTERN.test(id)) {
		warn("manifest id " + JSON.stringify(String(raw.id)) + " is not a lowercase kebab id");
		return;
	}
	const displayName = typeof raw.displayName === "string" && raw.displayName.trim() !== "" ? raw.displayName.trim().slice(0, 80) : id;
	const description = typeof raw.description === "string" ? raw.description.trim() : "";
	const spritesheet = typeof raw.spritesheetPath === "string" && raw.spritesheetPath.trim() !== "" ? raw.spritesheetPath.trim() : "spritesheet.webp";
	const segments = spritesheet.split("/").filter((segment) => segment !== "");
	if (segments.length === 0 || spritesheet.includes("\\") || segments.some((segment) => segment === ".." || !SEGMENT_PATTERN.test(segment))) {
		warn("manifest " + id + ": spritesheetPath " + JSON.stringify(spritesheet) + " is not a safe relative path");
		return;
	}
	let spriteVersionNumber = raw.spriteVersionNumber === 1 || raw.spriteVersionNumber === 2 ? raw.spriteVersionNumber : null;
	if (spriteVersionNumber == null) {
		const atlasFile = join(dir, segments.join("/"));
		if (existsSync(atlasFile)) try {
			spriteVersionNumber = detectSpriteVersion(readFileSync(atlasFile));
		} catch {}
	}
	if (spriteVersionNumber == null) spriteVersionNumber = 2;
	const size = finiteInt(raw.size, 120, 512);
	const pin = typeof raw.pin === "string" ? raw.pin : "bottom-right";
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
/** Scan one directory of pet folders; entries come back in name order. */
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
* Load the pet registry: built-in 'assets/*' first, then the user pets
* directory (each later source overrides an earlier one on id collision).
* Never throws on a bad manifest: it skips it and records a warning.
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
		/** Add (or replace) one entry at runtime — used by the GUI import flow. */
		add(entry) {
			byId.set(entry.id, entry);
			entries.splice(0, entries.length, ...byId.values());
		}
	};
}
/** Strip host-only fields, leaving the client-visible definition. */
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
//#region src/service.js
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
/** User-replaceable chime directory: '${DSH_HOME:-~/.dsh}/pets/sounds'. */
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
function clampInt(value, min, max, fallback) {
	const n = Math.round(Number(value));
	return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
/** Normalize one untrusted summary section into the persisted shape. */
function sanitizeSummary(raw) {
	const src = raw && typeof raw === "object" ? raw : {};
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
/** Normalize one untrusted sound section into the persisted shape. */
function sanitizeSound(raw) {
	const src = raw && typeof raw === "object" ? raw : {};
	const rawTracks = src.tracks && typeof src.tracks === "object" ? src.tracks : {};
	const rawEvents = src.events && typeof src.events === "object" ? src.events : {};
	const tracks = {};
	for (const id of TRACK_IDS) {
		const raw = rawTracks[id] && typeof rawTracks[id] === "object" ? rawTracks[id] : {};
		const legacyEnabled = rawEvents[id] !== void 0 ? rawEvents[id] !== false : void 0;
		tracks[id] = {
			enabled: raw.enabled !== void 0 ? raw.enabled !== false : legacyEnabled !== void 0 ? legacyEnabled : true,
			volume: clampInt(raw.volume, 0, 100, 100)
		};
	}
	return {
		enabled: src.enabled !== false,
		volume: clampInt(src.volume, 0, 100, DEFAULT_SOUND.volume),
		tracks
	};
}
function persistPath(env = process.env) {
	return join(dshHome(env), PERSIST_FILE);
}
var PetService = class {
	constructor({ registry, env = process.env, packageRoot }) {
		this.registry = registry;
		this.env = env ?? process.env;
		this.file = persistPath(this.env);
		this.petsDir = userPetsDir(this.env);
		this.soundsDir = userSoundsDir(this.env);
		this.pulses = {
			error: {
				at: 0,
				sessionId: ""
			},
			interrupt: {
				at: 0,
				sessionId: ""
			}
		};
		this.journalDir = join(dshHome(this.env), "codex-pet-journal");
		this.summaryInflight = /* @__PURE__ */ new Map();
		this.builtInSoundDir = packageRoot ? join(packageRoot, "assets", "sounds") : null;
		this.persist = this.load();
		if (!registry.byId(this.persist.petId)) {
			const fallback = registry.defaultEntry();
			this.persist.petId = fallback ? fallback.id : null;
		}
	}
	load() {
		const base = {
			petId: null,
			display: { ...DEFAULT_DISPLAY },
			summary: { ...DEFAULT_SUMMARY },
			sound: { ...DEFAULT_SOUND }
		};
		if (!existsSync(this.file)) return base;
		try {
			const parsed = JSON.parse(readFileSync(this.file, "utf8"));
			return {
				petId: typeof parsed.petId === "string" ? parsed.petId : null,
				display: {
					...DEFAULT_DISPLAY,
					...parsed.display || {}
				},
				summary: sanitizeSummary(parsed.summary),
				sound: sanitizeSound(parsed.sound)
			};
		} catch {
			return base;
		}
	}
	save() {
		try {
			writeFileSync(this.file, JSON.stringify(this.persist, null, 2) + "\n", "utf8");
		} catch (error) {
			console.warn("[dsh-arya-pet] could not persist state:", error);
		}
	}
	pets() {
		return this.registry.entries.map(petEntryView);
	}
	/** The user-uploaded override ('<track>.<ext>') for one track, or null. */
	customSoundFile(track = "done") {
		if (!TRACK_IDS.includes(track)) return null;
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
	* Store one uploaded track override. Any other extension of the same track
	* is removed so exactly one override per track exists at a time.
	*/
	saveSound(buffer, track = "done") {
		if (!TRACK_IDS.includes(track)) throw new Error("unknown-track");
		const ext = detectAudioExt(buffer);
		if (ext === null) throw new Error("unsupported-audio (use .wav/.mp3/.ogg/.m4a/.flac/.webm)");
		if (!buffer || buffer.length === 0) throw new Error("empty-file");
		if (buffer.length > 8 * 1024 * 1024) throw new Error("file-too-large (max 8MB)");
		mkdirSync(this.soundsDir, { recursive: true });
		for (const other of SOUND_EXTS) if (other !== ext) rmSync(join(this.soundsDir, track + other), { force: true });
		writeFileSync(join(this.soundsDir, track + ext), buffer);
		return this.state();
	}
	/** Remove one track's override; the built-in audio takes over again. */
	resetSound(track = "done") {
		if (!TRACK_IDS.includes(track)) throw new Error("unknown-track");
		for (const ext of SOUND_EXTS) rmSync(join(this.soundsDir, track + ext), { force: true });
		return this.state();
	}
	/** Record a scenario event so the next state poll plays its voice line. */
	pulse(kind, sessionId = "") {
		if (kind !== "error" && kind !== "interrupt") return;
		const previous = this.pulses[kind].at;
		this.pulses[kind] = {
			at: Math.max(Date.now(), previous + 1),
			sessionId: typeof sessionId === "string" ? sessionId : ""
		};
	}
	/**
	* Resolve a scenario track's audio file: the user override first, then the
	* built-in takes ('<track>-1.wav' …) rotating randomly so repeated triggers
	* vary, then the plain legacy '<track>.<ext>' file.
	*/
	trackFile(track) {
		if (!TRACK_IDS.includes(track)) return null;
		const custom = this.customSoundFile(track);
		if (custom) return custom;
		if (this.builtInSoundDir) {
			const takes = readdirSyncSafe(this.builtInSoundDir).filter((name) => name.startsWith(track + "-") && SOUND_EXTS.some((ext) => name.endsWith(ext)));
			if (takes.length) return join(this.builtInSoundDir, takes[Math.floor(Math.random() * takes.length)]);
		}
		for (const ext of SOUND_EXTS) {
			const file = this.builtInSoundDir && join(this.builtInSoundDir, track + ext);
			if (file && existsSync(file)) return file;
		}
		return null;
	}
	/** Journal file for one exact session id, hashed for filesystem safety. */
	journalFileFor(sessionId) {
		const id = requireSessionId(sessionId);
		return join(this.journalDir, createHash("sha256").update(id).digest("hex") + ".jsonl");
	}
	/** Append one summary record to the session's JSONL journal. */
	appendJournal(record) {
		requireSessionId(record && record.sessionId);
		mkdirSync(this.journalDir, { recursive: true });
		appendFileSync(this.journalFileFor(record.sessionId), JSON.stringify(record) + "\n", "utf8");
	}
	/** Latest journal records for one session, newest first. */
	journalList(sessionId, limit = 50) {
		return this.journalRecords(sessionId).slice(-clampInt(limit, 1, 200, 50)).reverse();
	}
	/** All journal records for one session in append order. */
	journalRecords(sessionId) {
		const file = this.journalFileFor(sessionId);
		if (!existsSync(file)) return [];
		const records = [];
		const lines = readFileSync(file, "utf8").split("\n");
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (!line) continue;
			try {
				records.push(JSON.parse(line));
			} catch {
				throw new Error("journal-invalid-jsonl:" + file + ":" + (index + 1));
			}
		}
		return records;
	}
	state() {
		const entry = this.registry.byId(this.persist.petId);
		return {
			petId: this.persist.petId,
			display: this.persist.display,
			summary: this.persist.summary,
			sound: this.persist.sound,
			pet: entry ? petEntryView(entry) : null,
			pets: this.pets(),
			hasCustomSounds: {
				done: this.customSoundFile("done") !== null,
				error: this.customSoundFile("error") !== null,
				interrupt: this.customSoundFile("interrupt") !== null
			},
			pulses: { ...this.pulses }
		};
	}
	setPetId(petId) {
		if (typeof petId !== "string" || !this.registry.byId(petId)) throw new Error("invalid-pet");
		this.persist.petId = petId;
		this.save();
		return this.state();
	}
	setConfig(patch) {
		const d = this.persist.display;
		if (typeof patch.size === "number") d.size = Math.max(32, Math.min(512, Math.round(patch.size)));
		if (typeof patch.pin === "string") d.pin = patch.pin;
		if (typeof patch.left === "number") d.left = Math.max(0, Math.round(patch.left));
		if (typeof patch.top === "number") d.top = Math.max(0, Math.round(patch.top));
		if (typeof patch.visible === "boolean") d.visible = patch.visible;
		if (typeof patch.mouseTracking === "boolean") d.mouseTracking = patch.mouseTracking;
		if (typeof patch.bubbleTheme === "string") d.bubbleTheme = patch.bubbleTheme;
		if (typeof patch.bubbleOpacity === "number") d.bubbleOpacity = Math.max(0, Math.min(100, Math.round(patch.bubbleOpacity)));
		if (patch.summary && typeof patch.summary === "object") this.persist.summary = sanitizeSummary({
			...this.persist.summary,
			...patch.summary
		});
		if (patch.sound && typeof patch.sound === "object") {
			const tracks = patch.sound.tracks && typeof patch.sound.tracks === "object" ? {
				...this.persist.sound.tracks,
				...patch.sound.tracks
			} : this.persist.sound.tracks;
			this.persist.sound = sanitizeSound({
				...this.persist.sound,
				...patch.sound,
				tracks
			});
		}
		this.save();
		return this.state();
	}
	setVisible(visible) {
		if (typeof visible !== "boolean") throw new Error("invalid-visible");
		this.persist.display.visible = visible;
		this.save();
		return this.state();
	}
	/**
	* Summarize one batch of completed assistant model requests through the configured LLM route.
	* The browser half assembles the transcript from its live conversation
	* snapshot (the same data the native trajectory view reads); this side only
	* frames the auxiliary call. Both summary.provider and summary.model must
	* be explicitly selected before the feature can run.
	*/
	async summarizeRequests(llm, payload) {
		const { sessionId, fromRequestSeq, toRequestSeq, requests } = validateSummaryPayload(payload);
		const existing = this.journalRecords(sessionId).find((record) => record.sessionId === sessionId && record.fromRequestSeq === fromRequestSeq && record.toRequestSeq === toRequestSeq);
		if (existing) return summaryResult(existing);
		const cfg = this.persist.summary;
		if (cfg.enabled !== true) throw new Error("summary-disabled");
		const key = JSON.stringify([
			sessionId,
			fromRequestSeq,
			toRequestSeq
		]);
		const inFlight = this.summaryInflight.get(key);
		if (inFlight) return inFlight;
		const run = async () => {
			const route = await resolveSummaryRoute(llm, cfg);
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
	* Import one uploaded Arya atlas: derive a filesystem-safe kebab id (from
	* the raw id or a generated fallback), keep the Unicode display name as-is,
	* save the spritesheet + pet.json, register and select it.
	*
	* The id never silently reuses an existing one: re-importing the same pet
	* (same id AND an explicitly typed display name) updates that pet in place,
	* while any other collision gets a unique '-2' / '-3' suffix. Arya atlases
	* all ship as 'spritesheet.webp', so without this every import would
	* overwrite the previous one's folder.
	*/
	importPet(rawId, displayName, buffer) {
		const base = String(rawId || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "pet-" + Date.now().toString(36);
		if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) throw new Error("invalid-id");
		const typedName = String(displayName || "").trim().slice(0, 80);
		const name = typedName || base;
		if (!buffer || buffer.length === 0) throw new Error("empty-file");
		const ext = detectImageExt(buffer);
		if (ext === null) throw new Error("unsupported-image (use .webp/.png/.gif)");
		const version = detectSpriteVersion(buffer);
		if (version === null) throw new Error("not-a-codex-atlas (expected 1536x1872 v1 or 1536x2288 v2)");
		const existing = this.registry.byId(base);
		const isUpdate = existing !== void 0 && typedName !== "" && existing.displayName === typedName;
		let id = base;
		let n = 2;
		while (!isUpdate && (this.registry.byId(id) || existsSync(join(this.petsDir, id)))) {
			id = base + "-" + n;
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
	* Apply a resolved settings-section value back into the persisted runtime
	* state (visible / mouseTracking / size / pin / petId). Changing the pin
	* clears any dragged left/top so the new corner takes effect immediately.
	*/
	applySettingsSection(section) {
		if (!section || typeof section !== "object") return;
		const d = this.persist.display;
		if (typeof section.visible === "boolean") d.visible = section.visible;
		if (typeof section.mouseTracking === "boolean") d.mouseTracking = section.mouseTracking;
		if (typeof section.size === "number") d.size = Math.max(32, Math.min(512, Math.round(section.size)));
		if (typeof section.pin === "string") {
			if (d.pin !== section.pin) {
				d.pin = section.pin;
				d.left = null;
				d.top = null;
			}
		}
		if (typeof section.petId === "string" && this.registry.byId(section.petId)) this.persist.petId = section.petId;
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
/** Validate one browser-supplied summary request. */
function validateSummaryPayload(payload) {
	const body = payload && typeof payload === "object" ? payload : {};
	const sessionId = requireSessionId(body.sessionId);
	const { fromRequestSeq, toRequestSeq } = body;
	if (!Number.isSafeInteger(fromRequestSeq) || !Number.isSafeInteger(toRequestSeq) || fromRequestSeq < 0 || toRequestSeq < fromRequestSeq) throw new Error("invalid-request-range");
	if (!Array.isArray(body.requests) || body.requests.length === 0 || body.requests.length > 50) throw new Error("invalid-requests");
	let previousSeq = fromRequestSeq - 1;
	const requests = body.requests.map((request) => {
		if (!request || typeof request !== "object") throw new Error("invalid-request-record");
		if (!Number.isSafeInteger(request.requestSeq) || request.requestSeq < fromRequestSeq || request.requestSeq > toRequestSeq || request.requestSeq <= previousSeq) throw new Error("invalid-request-record");
		if (!Number.isSafeInteger(request.turn) || request.turn < 0 || !Number.isSafeInteger(request.step) || request.step < 1) throw new Error("invalid-request-record");
		previousSeq = request.requestSeq;
		const actions = Array.isArray(request.actions) ? request.actions.slice(0, 80) : [];
		return {
			requestSeq: request.requestSeq,
			turn: request.turn,
			step: request.step,
			user: typeof request.user === "string" ? request.user.slice(0, 400) : "",
			assistant: typeof request.assistant === "string" ? request.assistant.slice(0, 400) : "",
			error: typeof request.error === "string" ? request.error.slice(0, 200) : "",
			actions: actions.map((a) => ({
				tool: String(a && a.tool ? a.tool : "?").slice(0, 60),
				detail: typeof (a && a.detail) === "string" ? a.detail.slice(0, 120) : "",
				failed: !!(a && a.failed)
			}))
		};
	});
	if (requests[0].requestSeq !== fromRequestSeq || requests[requests.length - 1].requestSeq !== toRequestSeq) throw new Error("invalid-request-range");
	return {
		sessionId,
		fromRequestSeq,
		toRequestSeq,
		requests
	};
}
function requireSessionId(sessionId) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) throw new Error("invalid-session-id");
	return sessionId;
}
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
* Pick the explicitly configured LLM route for one aux summary call.
*/
async function resolveSummaryRoute(llm, cfg) {
	if (!cfg.provider || !cfg.model) throw new Error("summary-route-not-configured");
	const providers = llm.listProviders();
	if (providers.length === 0) throw new Error("no-llm-provider-registered");
	const provider = providers.find((item) => item.id === cfg.provider);
	if (!provider) throw new Error("summary-provider-not-found-" + cfg.provider);
	return {
		provider: provider.id,
		model: cfg.model
	};
}
/** One plugin-sourced user message carrying plain text (dsh-llm vocabulary). */
function createUserTextMessage(text) {
	return {
		role: "user",
		content: [{
			type: "text",
			text
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-arya-pet"
		}
	};
}
/**
* Run one streaming completion and join its text deltas. Only an explicit stop
* finish is successful; a truncated iterator must not be journaled as a reply.
*/
async function streamText(llm, options) {
	let text = "";
	let finish = null;
	for await (const chunk of llm.stream(options)) if (chunk.type === "text-delta") text += chunk.text;
	else if (chunk.type === "finish") finish = chunk.reason;
	if (!finish) throw new Error("summary-llm-stream-incomplete");
	if (finish.kind !== "stop") {
		if (finish.kind === "aborted" || finish.kind === "error") throw new Error("summary-llm-" + finish.kind + ": " + (finish.failure && finish.failure.message || "unknown"));
		throw new Error("summary-llm-finish-" + finish.kind);
	}
	return text;
}
/** List a directory's file names; [] on any error (missing dir, permissions). */
function readdirSyncSafe(dir) {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}
/** Detect an audio container from the header bytes, or null. */
function detectAudioExt(buffer) {
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") return ".wav";
	if (buffer.length >= 4 && buffer.toString("ascii", 0, 3) === "ID3") return ".mp3";
	if (buffer.length >= 2 && buffer[0] === 255 && (buffer[1] & 224) === 224) return ".mp3";
	if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") return ".ogg";
	if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return ".m4a";
	if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") return ".flac";
	if (buffer.length >= 4 && buffer[0] === 26 && buffer[1] === 69 && buffer[2] === 223 && buffer[3] === 163) return ".webm";
	return null;
}
//#endregion
//#region src/routes.js
/**
* Pet HTTP routes — the browser half talks to the host through plain
* same-origin JSON endpoints ('/api/codex-pet/*') and loads each pet's atlas
* from the '/codex-pet/<id>/*' asset route (the same pattern as the
* dsh-web-ui family's '/api/pet' + '/pet/<id>' routes). The asset route is one
* prefix registration serving every registry entry, so adding a pet never
* touches route wiring.
* @module dsh-arya-pet/routes
*/
const PET_API_PREFIX = "/api/codex-pet";
const PET_ASSET_PREFIX = "/codex-pet";
const MANIFEST_FILE = "pet.json";
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
function mimeFor(file) {
	const dot = file.lastIndexOf(".");
	if (dot < 0) return "application/octet-stream";
	return MIME_BY_EXT[file.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
/** Write one JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/** Read a JSON request body (bounded). */
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
/** Read a raw (binary) request body, bounded. */
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
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}
/** Wrap one async service call as a GET JSON route. */
function getRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/** Wrap one async service call as a POST JSON route (body passed through). */
function postRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return Promise.resolve();
			return readJsonBody(req).then((body) => {
				const record = typeof body === "object" && body !== null ? body : {};
				return Promise.resolve().then(() => run(record)).then((value) => json(res, 200, value), (error) => json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				}));
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
* The one asset handler behind the '/codex-pet' prefix. Serves exactly the
* files a manifest declares: pet.json and the declared spritesheet path.
* Entries without a manifest file get a synthesized pet.json.
*/
function assetHandler(registry) {
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
		const entry = registry.byId(id);
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
		readFile(file).then((body) => {
			res.writeHead(200, {
				"content-type": mimeFor(file),
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
/** Upload route: import one Arya atlas (raw body) into the user pets dir. */
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
			readRawBody(req, 20 * 1024 * 1024).then((buffer) => {
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
* Stream the effective task-finished chime (user override first, then the
* built-in asset). no-cache so a freshly uploaded file takes effect at once.
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
			readFile(file).then((body) => {
				res.writeHead(200, {
					"content-type": mimeFor(file),
					"content-length": String(body.byteLength),
					"cache-control": "no-cache"
				});
				res.end(body);
			}, () => json(res, 404, {
				ok: false,
				error: "sound-file-unreadable"
			}));
		}
	};
}
/** Read the ?track= query param; an absent value keeps the legacy done default. */
function trackParam(req) {
	try {
		const value = new URL(req.url ?? "/", "http://codex-pet.local").searchParams.get("track");
		if (value === null) return "done";
		return [
			"done",
			"error",
			"interrupt"
		].includes(value) ? value : null;
	} catch {
		return null;
	}
}
/** Upload one user chime (raw audio body) as the override. */
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
			readRawBody(req, 8 * 1024 * 1024).then((buffer) => service.saveSound(buffer, track)).then((state) => json(res, 200, state), (error) => json(res, 400, {
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			}));
		}
	};
}
/** Drop the user chime; the built-in default takes over again. */
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
			Promise.resolve().then(() => service.resetSound(track)).then((state) => json(res, 200, state), (error) => json(res, 400, {
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			}));
		}
	};
}
/** Guard for the lazily-resolved llm service (absent in stripped profiles). */
function requireLlm(getLlm) {
	const llm = getLlm();
	if (!llm) throw new Error("no-llm-service");
	return llm;
}
/**
* Every LLM route the summary feature may use: registered providers with their
* advisory model catalogs. One provider's listing failure degrades to an
* empty model list plus an error field instead of failing the whole reply.
*/
function modelsRoute(getLlm) {
	return getRoute("/api/codex-pet/models", async () => {
		const llm = requireLlm(getLlm);
		const providers = [];
		for (const info of llm.listProviders()) try {
			const models = await llm.listModels(info.id);
			providers.push({
				id: info.id,
				name: info.name,
				models: (Array.isArray(models) ? models : []).map((m) => ({
					id: m.id,
					name: m.name
				}))
			});
		} catch (error) {
			providers.push({
				id: info.id,
				name: info.name,
				models: [],
				error: error instanceof Error ? error.message : String(error)
			});
		}
		return { providers };
	});
}
/** Summarize one batch of completed assistant model requests. */
function summarizeRoute({ service, getLlm }) {
	return postRoute("/api/codex-pet/summarize", (body) => service.summarizeRequests(requireLlm(getLlm), body));
}
/** AI-view summaries for one session: GET /journal?session=<id>&limit=<n>&all=1. */
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
			if (!session.trim()) {
				json(res, 400, {
					ok: false,
					error: "missing-session"
				});
				return;
			}
			Promise.resolve().then(() => all ? service.journalRecords(session) : service.journalList(session, Number.isFinite(limit) ? limit : 50)).then((records) => json(res, 200, { records }), (error) => json(res, 500, {
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			}));
		}
	};
}
/** Build the full route family (API + assets) for one service. */
function makeCodexPetRoutes({ service, getLlm }) {
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
			handler: assetHandler(service.registry)
		}
	];
	routes.push(modelsRoute(getLlm), summarizeRoute({
		service,
		getLlm
	}), journalRoute(service));
	return routes;
}
//#endregion
//#region src/index.js
/**
* dsh-arya-pet host half — builds the Arya atlas pet registry once at
* startup and mounts the '/api/codex-pet/*' JSON API plus the '/codex-pet/<id>/*'
* asset routes on the DSH web server. The browser half (the './client' export)
* renders the selected pet, drives it through those same-origin endpoints, and
* seats a settings section that edits them directly. Adding a pet means
* dropping a <pet>/pet.json + <pet>/spritesheet.webp into assets/ or
* ~/.dsh/pets — never touching host or client code.
* @module dsh-arya-pet
*/
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "arya-pet";
/**
* The web server is required to mount the base pet. LLM is optional because
* summary routes report a clear error when an adapter is not installed.
*/
const inject = ["webServer"];
/** Register the pet service and its API + asset routes on the context. */
function apply(ctx, config = {}) {
	const registry = config.registry ?? loadPetRegistry({ packageRoot: petPackageRoot(import.meta.url) });
	const service = new PetService({
		...config,
		registry,
		packageRoot: petPackageRoot(import.meta.url)
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
		const offError = ctx.on("agent/error", ({ agent }) => service.pulse("error", agent.id));
		return () => {
			offError?.();
		};
	}, "codex-pet: scenario-events");
}
//#endregion
export { PET_API_PREFIX, PET_ASSET_PREFIX, PetService, SOUND_ROUTE, SUMMARY_TIMEOUT_MS, apply, inject, loadPetRegistry, makeCodexPetRoutes, name, persistPath, petEntryView, petPackageRoot, userPetsDir, userSoundsDir };
