export namespace __internals {
    export { SoundControls };
    export { SummaryControls };
    export { SettingsSection };
    export { latestTurnInterrupted };
    export { latestTurnErrored };
    export { shouldPlayDone };
    export { completedTurnsOf };
    export { completedModelRequestsOf };
    export { buildSummaryPayload };
    export { baselineAutoTracker };
    export { isCurrentAutoTrackerSession };
    export { selectAutoSummaryBatch };
    export { settleAutoTrackerAfterSummary };
    export { requestCoveredByJournal };
    export { uncoveredModelRequestsOf };
    export { summaryBatches };
    export { manualSummaryEnabled };
    export { summaryTextFromResponse };
    export { manualSummaryBlocksSession };
    export { releaseManualSummaryOwner };
    export { releaseManualSummaryOwnerAfterSessionChange };
    export { advanceAutoTrackerAfterManual };
}
export function apply(ctx: any): void;
export const inject: string[];
export function deriveActivity(snap: any): "idle" | "waiting" | "running" | "review";
declare function SoundControls({ sound, hasCustomSounds, reload }: {
    sound: any;
    hasCustomSounds: any;
    reload: any;
}): react.DetailedReactHTMLElement<{
    style: {
        display: "grid";
        gap: string;
    };
}, HTMLElement>;
declare function SummaryControls({ summary, reload }: {
    summary: any;
    reload: any;
}): react.DetailedReactHTMLElement<{
    style: {
        display: "grid";
        gap: string;
    };
}, HTMLElement>;
declare function SettingsSection(): react.DetailedReactHTMLElement<{
    style: {
        padding: string;
        color: "#888";
    };
}, HTMLElement> | react.DetailedReactHTMLElement<{
    style: {
        padding: string;
        display: "grid";
        gap: string;
        maxWidth: string;
    };
}, HTMLElement>;
/**
 * True when the latest finished turn was cut short by the user: the
 * conversation snapshot flags its partial assistant message. This is the
 * reliable abort signal — the agent loop never dispatches agent/turn-stopping
 * on an abort (it throws straight into the catch), so a host-side hook
 * cannot see user interrupts at all.
 */
declare function latestTurnInterrupted(snap: any): any;
/** True when the latest finished turn died on a turn-error node. */
declare function latestTurnErrored(snap: any): any;
declare function shouldPlayDone(snap: any, state: any): boolean;
/** Completed turn numbers, ascending (the authoritative turnEnds map). */
declare function completedTurnsOf(snap: any): number[];
/** Completed ordinary model requests, ordered by their durable start seq. */
declare function completedModelRequestsOf(snap: any): any;
/** Assemble one summarize POST body for a consecutive request batch. */
declare function buildSummaryPayload(nodes: any, requests: any, sessionId: any): {
    sessionId: any;
    fromRequestSeq: any;
    toRequestSeq: any;
    requests: any;
};
/** Start automatic observation after the selected snapshot, never at journal history. */
declare function baselineAutoTracker(sessionId: any, completedRequests: any): {
    sessionId: any;
    ready: boolean;
    lastSeenRequestSeq: any;
    windowStartRequestSeq: any;
    retryCount: number;
};
declare function isCurrentAutoTrackerSession(tracker: any, sessionId: any): boolean;
/** Select the next automatic batch without mutating the tracker. */
declare function selectAutoSummaryBatch(tracker: any, sessionId: any, openState: any, completedRequests: any, interval: any, isSummarizing: any): {
    tracker: any;
    batch: any;
};
/** Settle an automatic summary against the current tracker, not its request-time snapshot. */
declare function settleAutoTrackerAfterSummary(tracker: any, sessionId: any, nextStartRequestSeq: any, succeeded: any): any;
declare function requestCoveredByJournal(request: any, records: any): any;
/** Completed requests absent from every persisted journal range, ascending. */
declare function uncoveredModelRequestsOf(completedRequests: any, journalRecords: any): any;
/** Split manual work into server-safe, configured request batches. */
declare function summaryBatches(requests: any, intervalRequests: any): any[];
declare function manualSummaryEnabled(summary: any): boolean;
declare function summaryTextFromResponse(data: any): any;
declare function manualSummaryBlocksSession(ownerSessionId: any, sessionId: any): boolean;
declare function releaseManualSummaryOwner(ownerSessionId: any, sessionId: any): any;
declare function releaseManualSummaryOwnerAfterSessionChange(ownerSessionId: any, sessionId: any): any;
/** Keep automatic work after successful manual coverage without skipping new requests. */
declare function advanceAutoTrackerAfterManual(tracker: any, sessionId: any, requests: any): any;
import * as react from "react";
export {};
//# sourceMappingURL=client.d.ts.map