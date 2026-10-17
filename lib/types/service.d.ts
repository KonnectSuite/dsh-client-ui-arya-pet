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
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { PetEntryView, PetRegistry } from './registry.ts';
/** Overlay placement and appearance, as persisted. */
export interface PetDisplay {
    visible: boolean;
    size: number;
    pin: string;
    /** Dragged left offset, or null while the pin corner places the overlay. */
    left: number | null;
    /** Dragged top offset, or null while the pin corner places the overlay. */
    top: number | null;
    bubbleTheme: string;
    bubbleOpacity: number;
    /** v2 atlases only: the eyes track the pointer. Ignored by v1 atlases. */
    mouseTracking: boolean;
}
/** Periodic model-request summary settings. A route must be chosen to enable it. */
export interface PetSummaryConfig {
    enabled: boolean;
    intervalRequests: number;
    provider: string;
    model: string;
    maxChars: number;
    bubbleSeconds: number;
}
/** Scenario tracks, each with its own override file and relative volume. */
export type PetTrackId = 'done' | 'error' | 'interrupt';
/** One scenario track's switch and relative volume. */
export interface PetSoundTrack {
    enabled: boolean;
    volume: number;
}
/** Task-finished chime settings; volumes are 0..100 and combine master x track. */
export interface PetSoundConfig {
    enabled: boolean;
    volume: number;
    tracks: Record<PetTrackId, PetSoundTrack>;
}
/** The persisted snapshot: everything that survives a restart. */
export interface PersistedPetState {
    petId: string | null;
    display: PetDisplay;
    summary: PetSummaryConfig;
    sound: PetSoundConfig;
}
/** Scenario events that can play a voice line, each carrying its session. */
export type PetPulseKind = 'error' | 'interrupt';
/** One scenario pulse: when it fired and which session owns it. */
export interface PetPulse {
    at: number;
    sessionId: string;
}
/** The full state projection the browser polls. */
export interface PetState {
    petId: string | null;
    display: PetDisplay;
    summary: PetSummaryConfig;
    sound: PetSoundConfig;
    pet: PetEntryView | null;
    pets: readonly PetEntryView[];
    hasCustomSounds: Record<PetTrackId, boolean>;
    pulses: Record<PetPulseKind, PetPulse>;
}
/** One recorded tool action inside a summarized request. */
export interface SummaryActionRecord {
    readonly tool: string;
    readonly detail: string;
    readonly failed: boolean;
}
/** One model request as the browser frames it for summarization. */
export interface SummaryRequestRecord {
    readonly requestSeq: number;
    readonly turn: number;
    readonly step: number;
    readonly user: string;
    readonly assistant: string;
    readonly error: string;
    readonly actions: readonly SummaryActionRecord[];
}
/** A validated summary request. */
export interface SummaryPayload {
    readonly sessionId: string;
    readonly fromRequestSeq: number;
    readonly toRequestSeq: number;
    readonly requests: readonly SummaryRequestRecord[];
}
/** One persisted journal line. */
export interface SummaryJournalRecord {
    readonly sessionId: string;
    readonly fromRequestSeq: number;
    readonly toRequestSeq: number;
    readonly requestCount: number;
    readonly provider: string;
    readonly model: string;
    readonly summary: string;
    readonly createdAt: string;
}
/** The journal projection handed back to the browser. */
export interface SummaryResult {
    readonly summary: string;
    readonly provider: string;
    readonly model: string;
    readonly fromRequestSeq: number;
    readonly toRequestSeq: number;
    readonly requestCount: number;
}
/**
 * The LLM service the summary feature calls.
 *
 * Named here so this module's contracts read in the pet's vocabulary. It is the
 * LLM service's own class rather than a hand-written subset, so the edge cannot
 * drift from what a registered adapter actually accepts.
 */
export type SummaryLlm = LlmRuntime;
/** Construction inputs for {@link PetService}. */
export interface PetServiceOptions {
    /** The loaded pet registry the service reads and extends. */
    readonly registry: PetRegistry;
    /** Environment carrying `DSH_HOME`; defaults to `process.env`. */
    readonly env?: NodeJS.ProcessEnv | undefined;
    /** Package root holding the built-in sound assets. */
    readonly packageRoot?: string | undefined;
}
/**
 * User-replaceable chime directory.
 * @param env - environment carrying `DSH_HOME`.
 * @returns `${DSH_HOME:-~/.dsh}/pets/sounds`.
 */
export declare function userSoundsDir(env?: NodeJS.ProcessEnv): string;
/**
 * The persisted snapshot's path.
 * @param env - environment carrying `DSH_HOME`.
 * @returns the absolute path of the persistence file.
 */
export declare function persistPath(env?: NodeJS.ProcessEnv): string;
/** Owns the persisted pet selection, its display config, and the sound overrides. */
export declare class PetService {
    /** The registry this service reads and extends; the asset route serves from it. */
    readonly registry: PetRegistry;
    private readonly env;
    private readonly file;
    private readonly petsDir;
    private readonly soundsDir;
    private readonly journalDir;
    private readonly builtInSoundDir;
    private readonly summaryInflight;
    private readonly pulses;
    private readonly persist;
    /**
     * @param options - the registry to serve, the environment, and the package root.
     */
    constructor(options: PetServiceOptions);
    /**
     * Read the persisted snapshot, filling absent fields from the defaults.
     * @returns the snapshot; an unreadable or malformed file yields the defaults.
     */
    load(): PersistedPetState;
    /** Write the snapshot, reporting a failure rather than propagating it. */
    save(): void;
    /**
     * Every registered pet, projected for the browser.
     * @returns the client-visible definitions.
     */
    pets(): PetEntryView[];
    /**
     * The user-uploaded override for one track.
     * @param track - scenario track id.
     * @returns the override file's absolute path, or null when none is installed.
     */
    customSoundFile(track?: PetTrackId): string | null;
    /**
     * Store one uploaded track override, removing any other extension of the same
     * track so exactly one override per track exists at a time.
     * @param buffer - the uploaded audio file.
     * @param track - scenario track id.
     * @returns the resulting state projection.
     */
    saveSound(buffer: Buffer, track?: PetTrackId): PetState;
    /**
     * Remove one track's override, so the built-in audio takes over again.
     * @param track - scenario track id.
     * @returns the resulting state projection.
     */
    resetSound(track?: PetTrackId): PetState;
    /**
     * Record a scenario event so the next state poll plays its voice line.
     * @param kind - scenario event.
     * @param sessionId - the session that owns the event.
     */
    pulse(kind: PetPulseKind, sessionId?: string): void;
    /**
     * Resolve a scenario track's audio file: the user override first, then a
     * built-in take chosen at random so repeated triggers vary, then the plain
     * legacy file.
     * @param track - scenario track id.
     * @returns the audio file's absolute path, or null when none is installed.
     */
    trackFile(track: PetTrackId): string | null;
    /**
     * Journal file for one session id, hashed for filesystem safety.
     * @param sessionId - the owning session.
     * @returns the absolute path of that session's journal.
     */
    journalFileFor(sessionId: unknown): string;
    /**
     * Append one summary record to its session's journal.
     * @param record - the record to persist.
     */
    appendJournal(record: SummaryJournalRecord): void;
    /**
     * Latest journal records for one session, newest first.
     * @param sessionId - the owning session.
     * @param limit - maximum records to return.
     * @returns the most recent records in reverse append order.
     */
    journalList(sessionId: unknown, limit?: number): SummaryJournalRecord[];
    /**
     * All journal records for one session in append order.
     * @param sessionId - the owning session.
     * @returns every complete record; an unparseable line is reported, not skipped.
     */
    journalRecords(sessionId: unknown): SummaryJournalRecord[];
    /**
     * The full state projection the browser polls.
     * @returns selection, display, feature settings, the pet list, and pulses.
     */
    state(): PetState;
    /**
     * Select one registered pet.
     * @param petId - the pet to select.
     * @returns the resulting state projection.
     */
    setPetId(petId: unknown): PetState;
    /**
     * Apply a browser display patch, ignoring fields it did not send.
     * @param patch - the fields to change.
     * @returns the resulting state projection.
     */
    setConfig(patch: unknown): PetState;
    /**
     * Show or hide the overlay.
     * @param visible - the new visibility.
     * @returns the resulting state projection.
     */
    setVisible(visible: unknown): PetState;
    /**
     * Summarize one batch of completed assistant model requests through the
     * configured LLM route. The browser half assembles the transcript from its
     * live conversation snapshot; this side only frames the auxiliary call.
     * @param llm - the LLM service to call.
     * @param payload - the batch the browser supplied.
     * @returns the summary, served from the journal when this batch already ran.
     */
    summarizeRequests(llm: SummaryLlm, payload: unknown): Promise<SummaryResult>;
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
    importPet(rawId: unknown, displayName: unknown, buffer: Buffer): PetState;
    /**
     * Apply a resolved settings-section value back into the persisted state.
     * Changing the pin clears any dragged left/top so the new corner takes
     * effect immediately.
     * @param section - the resolved section value.
     */
    applySettingsSection(section: unknown): void;
}
/** Aux-call deadline: bounded so a stuck provider cannot hold the HTTP request. */
export declare const SUMMARY_TIMEOUT_MS = 90000;
//# sourceMappingURL=service.d.ts.map