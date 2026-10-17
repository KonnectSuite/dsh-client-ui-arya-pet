/**
 * Pet HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints ('/api/codex-pet/*') and loads each pet's atlas
 * from the '/codex-pet/<id>/*' asset route (the same pattern as the
 * dsh-web-ui family's '/api/pet' + '/pet/<id>' routes). The asset route is one
 * prefix registration serving every registry entry, so adding a pet never
 * touches route wiring.
 * @module dsh-arya-pet/routes
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { PetService } from './service.ts';
/** HTTP prefix for pet management requests. */
export declare const PET_API_PREFIX = "/api/codex-pet";
/** HTTP prefix serving installed pet assets. */
export declare const PET_ASSET_PREFIX = "/codex-pet";
/** HTTP route serving the configured pet sound. */
export declare const SOUND_ROUTE = "/codex-pet-sound";
/** Resolves the LLM service per request; absent when a stripped profile mounts none. */
export type GetPetLlm = () => LlmRuntime | null | undefined;
/** Inputs for {@link makeCodexPetRoutes}. */
export interface CodexPetRoutesOptions {
    /** The service every route reads or mutates. */
    readonly service: PetService;
    /** Resolves the LLM service, which a stripped profile may not mount. */
    readonly getLlm: GetPetLlm;
}
/**
 * Build the full route family (API and assets) for one service.
 * @param options - the service and the LLM resolver.
 * @returns every registration, in mount order.
 */
export declare function makeCodexPetRoutes(options: CodexPetRoutesOptions): WebRoute[];
//# sourceMappingURL=routes.d.ts.map