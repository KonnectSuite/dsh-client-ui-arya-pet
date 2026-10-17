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
import type { Context } from '@deepseek-ai/cordis';
import type { PetRegistry } from './registry.ts';
import type { SummaryLlm } from './service.ts';
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export declare const name = "arya-pet";
/**
 * The web server is required to mount the base pet. LLM is optional because
 * summary routes report a clear error when an adapter is not installed.
 */
export declare const inject: string[];
/** Plugin configuration. Every field is an override; the defaults build a pet. */
export interface Config {
    /** Pre-built registry, replacing the one this plugin would load. */
    readonly registry?: PetRegistry;
    /** Pre-resolved LLM service, replacing the one `ctx.get('llm')` would find. */
    readonly llm?: SummaryLlm;
    /** Environment carrying `DSH_HOME`, for a deployment that overrides it. */
    readonly env?: NodeJS.ProcessEnv;
}
/**
 * Register the pet service and its API and asset routes on the context.
 * @param ctx - context carrying the web server.
 * @param config - optional registry, LLM, and environment overrides.
 */
export declare function apply(ctx: Context, config?: Config): void;
export { loadPetRegistry, petPackageRoot, petEntryView, userPetsDir } from './registry.ts';
export type { PetEntry, PetEntryView, PetRegistry } from './registry.ts';
export { PetService, persistPath, userSoundsDir, SUMMARY_TIMEOUT_MS } from './service.ts';
export type { PetState, PetTrackId, SummaryLlm, SummaryResult } from './service.ts';
export { makeCodexPetRoutes, PET_API_PREFIX, PET_ASSET_PREFIX, SOUND_ROUTE } from './routes.ts';
export type { CodexPetRoutesOptions, GetPetLlm } from './routes.ts';
//# sourceMappingURL=index.d.ts.map