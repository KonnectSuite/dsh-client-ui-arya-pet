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
export declare const FRAME_WIDTH = 192;
export declare const FRAME_HEIGHT = 208;
export declare const COLUMNS = 8;
/** Pixel dimensions read from an image header. */
export interface ImageDimensions {
    /** Width in pixels. */
    readonly width: number;
    /** Height in pixels. */
    readonly height: number;
}
/**
 * One renderable pet, as the host holds it.
 *
 * `dir` and `spritesheetPath` are host-only: a browser receives the projection
 * from {@link petEntryView} instead, which omits both.
 */
export interface PetEntry {
    /** Manifest id: lowercase letters, digits and hyphens. A later source replaces the
     * entry that already holds this id. */
    readonly id: string;
    /** Name the picker shows for this pet. */
    readonly displayName: string;
    /** One line describing the pet, shown with its name. */
    readonly description: string;
    /** Contract version of the atlas: 1 or 2. Detected from the image dimensions when the
     * manifest omits it, and 2 when detection fails. */
    readonly spriteVersionNumber: number;
    /** Overlay size, defaulted by the manifest when omitted. */
    readonly size: number;
    /** Corner the overlay pins to; free-form so a manifest may name a future one. */
    readonly pin: string;
    /** Pixel bounds of one frame in the atlas. */
    readonly cell: ImageDimensions;
    /** Frames per atlas row; the Arya contract fixes eight. */
    readonly columns: number;
    /** Atlas rows: nine, or eleven for a version 2 sprite with its extra look cells. */
    readonly rows: number;
    /** Browser URL the overlay loads the sprite atlas from. */
    readonly atlasUrl: string;
    /** Browser URL of this pet's manifest. */
    readonly manifestUrl: string;
    /** Absolute directory holding this pet's manifest and atlas. */
    readonly dir: string;
    /** Atlas path relative to `dir`, normalized to forward slashes. */
    readonly spritesheetPath: string;
}
/** The client-visible projection of a pet, without host paths. */
export interface PetEntryView {
    /** Manifest id of the pet this projection describes. */
    readonly id: string;
    /** Name the picker shows for this pet. */
    readonly displayName: string;
    /** One line describing the pet, shown with its name. */
    readonly description: string;
    /** Contract version of the atlas: 1 or 2. */
    readonly spriteVersionNumber: number;
    /** Overlay size. */
    readonly size: number;
    /** Corner the overlay pins to. */
    readonly pin: string;
    /** Pixel bounds of one frame in the atlas. */
    readonly cell: ImageDimensions;
    /** Frames per atlas row. */
    readonly columns: number;
    /** Atlas rows. */
    readonly rows: number;
    /** Browser URL the overlay loads the sprite atlas from. */
    readonly atlasUrl: string;
    /** Browser URL of this pet's manifest. */
    readonly manifestUrl: string;
}
/** Resolved pet registry: entries in override order, plus what was skipped. */
export interface PetRegistry {
    /** Resolved entries, in override order. */
    readonly entries: readonly PetEntry[];
    /** Messages for entries the scan skipped or a user pet overrode, for diagnostics. */
    readonly warnings: readonly string[];
    /**
     * Look one pet up.
     * @param id - pet id.
     * @returns the entry, or undefined when no source declared that id.
     */
    byId(id: string): PetEntry | undefined;
    /**
     * The pet to select when nothing else is chosen.
     * @returns the first entry, or undefined when no pet loaded.
     */
    defaultEntry(): PetEntry | undefined;
    /**
     * Add or replace one entry at runtime; used by the GUI import flow.
     * @param entry - the entry to install under its own id.
     */
    add(entry: PetEntry): void;
}
/** Options for {@link resolvePetManifest}. */
export interface ResolvePetManifestOptions {
    /** URL prefix an atlas is served under. */
    readonly assetPrefix?: string;
    /** Collector for contract violations; the caller owns the array. */
    warnings?: string[];
}
/** Options for {@link loadPetRegistry}. */
export interface LoadPetRegistryOptions {
    /** Absolute package root holding the built-in `assets` directory. */
    readonly packageRoot: string;
    /** URL prefix an atlas is served under. */
    readonly assetPrefix?: string;
    /** User pets directory; defaults to {@link userPetsDir}. */
    readonly petsDir?: string;
}
/**
 * Absolute package root, resolved from a module URL.
 * @param importMetaUrl - the importing module's `import.meta.url`.
 * @returns the package root, one level above `src/` or `lib/`.
 */
export declare function petPackageRoot(importMetaUrl: string): string;
/**
 * DSH home directory.
 * @param env - environment to read; defaults to `process.env`.
 * @param home - the account home directory.
 * @returns `$DSH_HOME` when set and non-blank, otherwise `<home>/.dsh`.
 */
export declare function dshHome(env?: NodeJS.ProcessEnv, home?: string): string;
/**
 * The user pets directory.
 * @param env - environment to read; defaults to `process.env`.
 * @param home - the account home directory.
 * @returns `${DSH_HOME:-~/.dsh}/pets`.
 */
export declare function userPetsDir(env?: NodeJS.ProcessEnv, home?: string): string;
/**
 * Read image dimensions from a WebP, PNG, or GIF header without decoding.
 * @param buffer - the leading bytes of an image file.
 * @returns the dimensions, or null when the format is unrecognized.
 */
export declare function detectDimensions(buffer: Buffer): ImageDimensions | null;
/**
 * Auto-detect the Arya atlas version from the image dimensions.
 * @param buffer - the leading bytes of an atlas image.
 * @returns 1 or 2, or null when the dimensions match neither contract.
 */
export declare function detectSpriteVersion(buffer: Buffer): number | null;
/**
 * Detect the image file extension from its header.
 * @param buffer - the leading bytes of an image file.
 * @returns the extension including the dot, or null when unrecognized.
 */
export declare function detectImageExt(buffer: Buffer): string | null;
/**
 * Normalize one parsed manifest into a renderable pet entry.
 * @param raw - parsed `pet.json`, from a file rather than from this process.
 * @param dir - absolute directory holding the manifest.
 * @param options - asset prefix and the warning collector.
 * @returns the entry, or undefined after recording why the manifest was refused.
 */
export declare function resolvePetManifest(raw: unknown, dir: string, options?: ResolvePetManifestOptions): PetEntry | undefined;
/**
 * Load the pet registry, built-in pets first and user pets overriding them.
 *
 * A malformed manifest is skipped with a recorded warning; loading never throws
 * for one, so a bad user pet cannot stop the built-in pets from loading.
 * @param options - package root, asset prefix, and user pets directory.
 * @returns the registry, its warnings, and runtime-add support.
 */
export declare function loadPetRegistry(options: LoadPetRegistryOptions): PetRegistry;
/**
 * Strip host-only fields, leaving the client-visible definition.
 * @param entry - the host-side entry.
 * @returns the same pet without `dir` and `spritesheetPath`.
 */
export declare function petEntryView(entry: PetEntry): PetEntryView;
//# sourceMappingURL=registry.d.ts.map