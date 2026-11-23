// Browser-side surface of @hatch/space-sdk.
//
// Imported as `@hatch/space-sdk/client` from a space's `client/src/api.ts`:
//
//   import type { Actions } from "../../server/src/actions";
//   import { createActionClient } from "@hatch/space-sdk/client";
//
//   export const api = createActionClient<typeof Actions>();
//
// `import type { Actions }` is type-only by design — the browser bundle
// never pulls in any server runtime.
// Side-effect import of the SDK's foundational space-container styles.
// Every TS space imports `@hatch/space-sdk/client`, so this pulls the
// shared styles into each space's CSS bundle via Bun's side-effect handling.
// The `../styles.css` path is preserved through `tsc` and resolves from
// the compiled `dist/client.js` to the SDK package root's `styles.css`.
import "../styles.css";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { showFailureNotice } from "./client/failure-notice";
export { setFailureNoticeText } from "./client/failure-notice";
import { installSpaceThemeListener } from "./client/host-theme";
import { requestSchemaIssues, requestSchemaMessage } from "./client/request-issues";
import { createSpaceViewerStore, useSpaceViewerFrom, } from "./client/viewer";
export { SafeAreaTopScrim } from "./client/safe-area";
export { bytesToBase64, fileToBase64 } from "./client/file-encoding";
/**
 * Error thrown by a {@link createActionClient} call when the daemon returns a
 * non-OK HTTP response. Carries the HTTP `status` so retry policy can tell a
 * permanent client error (4xx) apart from retryable backpressure/transient
 * failures, and the server's `Retry-After` (when present) as `retryAfterMs` so
 * the backoff honors it, and the server's error `code` (when present) so a
 * page can tell refusals with the same status apart. From platformVersion 29,
 * `message` is always readable, so a page shows it as is: each rejected field's
 * label with the request schema's message (also listed in `issues`), the
 * action's own error, or a plain retry or reload message; `detail` keeps the
 * action, status and response body for logs. Below 29 `message` is `detail`.
 */
export class SpaceActionError extends Error {
    status;
    retryAfterMs;
    retrySafe;
    code;
    issues;
    detail;
    constructor(message, status, retryAfterMs, retrySafe = false, code, issues = [], detail = message) {
        super(message);
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.retrySafe = retrySafe;
        this.code = code;
        this.issues = issues;
        this.detail = detail;
        this.name = "SpaceActionError";
    }
}
// Actions can write even when invoked by useQuery. A failed connection or
// gateway response cannot prove that the handler did not commit a write.
export const PERMANENT_ACTION_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 422]);
/** Retries after the first failure for a retryable action error. */
export const MAX_ACTION_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;
/**
 * The failure notice and readable action errors start at platformVersion 29.
 * The client build compiles the version in; a bundle built without it keeps the
 * old behavior.
 */
const READABLE_FAILURES = typeof __HATCH_SPACE_PLATFORM_VERSION__ === "number" && __HATCH_SPACE_PLATFORM_VERSION__ >= 29;
/**
 * Default retry predicate for Space action queries, used by
 * {@link spaceQueryClient}. Retry only explicit pre-invocation failures, with
 * bounded backoff. Per-query overrides must preserve this outcome boundary.
 */
export function shouldRetryAction(failureCount, error) {
    if (error instanceof SpaceActionError &&
        PERMANENT_ACTION_STATUSES.has(error.status)) {
        return false;
    }
    return error instanceof SpaceActionError && error.retrySafe && failureCount < MAX_ACTION_RETRIES;
}
/**
 * Retry delay for Space action queries: exponential backoff with full jitter,
 * honoring the server's `Retry-After` (carried on {@link SpaceActionError}) as
 * a floor. Full jitter de-synchronizes clients so a recovering worker pool is
 * not hit by a synchronized retry herd. `failureCount` is the number of prior
 * failures (0 before the first retry).
 */
export function actionRetryDelay(failureCount, error) {
    const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** failureCount);
    const floor = error instanceof SpaceActionError && error.retryAfterMs != null
        ? Math.min(RETRY_CAP_MS, Math.max(0, error.retryAfterMs))
        : 0;
    // Wait at least as long as the server asked, then add full jitter on top.
    return floor + Math.random() * ceiling;
}
/**
 * Shared TanStack Query client for every Muse Space.
 *
 * This singleton is the only way a space should obtain a `QueryClient`. The
 * build pipeline's client validator forbids local `new QueryClient(...)`
 * construction so defaults (cache lifetime, retry policy, refetch behavior)
 * stay tunable here in one place across the entire fleet. The defaults below
 * are deliberately conservative: stock TanStack defaults (retry: 3,
 * staleTime: 0, refetchOnWindowFocus: true) let a saturated worker pool turn
 * one overloaded Space client into a fleet-visible retry storm.
 *
 *   import { spaceQueryClient } from "@hatch/space-sdk/client";
 *   import { QueryClientProvider } from "@tanstack/react-query";
 *
 *   <QueryClientProvider client={spaceQueryClient}>
 *     <App />
 *   </QueryClientProvider>
 *
 * From platformVersion 29, a mutation with no `onError` or `onSettled` of its own
 * shows its failure as a short notice at the bottom of the page, so a save with no
 * handler is never silent.
 */
export const spaceQueryClient = new QueryClient({
    mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
            if (READABLE_FAILURES && mutation.options.onError === undefined && mutation.options.onSettled === undefined) {
                showFailureNotice(error);
            }
        },
    }),
    defaultOptions: {
        queries: {
            retry: shouldRetryAction,
            retryDelay: actionRetryDelay,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        },
    },
});
/**
 * Global the UI audit reads to know when this artifact has finished loading.
 *
 * The audit used to guess: `networkidle` plus a fixed settle, and any test the
 * builder wrote had to guess again with its own `waitFor` timeouts. Both guesses
 * are unnecessary — the artifact's data layer knows the answer. Every scaffolded
 * artifact renders through this one `spaceQueryClient`, so exposing its in-flight
 * count makes settling exact for the whole population without a single artifact
 * opting in, and lets the audit report "still fetching after Ns" instead of
 * screenshotting a spinner and calling it a page.
 *
 * Introspection only: it returns a count and mutates nothing, so it is safe on a
 * published artifact. Installed at module scope because the audit must not depend
 * on the artifact remembering to call anything.
 */
const AUDIT_SETTLE_GLOBAL = "__hatchAuditSettle";
export function installAuditSettleProbe(queryClient = spaceQueryClient) {
    if (typeof window === "undefined")
        return;
    const target = window;
    if (typeof target[AUDIT_SETTLE_GLOBAL] === "function")
        return;
    target[AUDIT_SETTLE_GLOBAL] = () => queryClient.isFetching() + queryClient.isMutating();
}
installAuditSettleProbe();
installSpaceThemeListener();
const SPACE_QUERY_INVALIDATED_MESSAGE_TYPE = "hatch:space:query-invalidated";
const HATCH_SPACE_ACTION_AUTH_REFRESH_REQUIRED_MESSAGE = "hatch:space-action-auth-refresh-required";
const HATCH_SPACE_ACTION_AUTH_REFRESH_RESULT_MESSAGE = "hatch:space-action-auth-refresh-result";
const HATCH_SPACE_UNAVAILABLE_MESSAGE = "hatch:space-unavailable";
const HATCH_SPACE_UNAVAILABLE_REASON = "space_unavailable";
const HATCH_SPACE_ACTION_REFRESHABLE_FAILURE_CODES = [
    "notary_missing",
    "notary_expired",
    "notary_invalid",
    "credential_stale",
];
const SPACE_ACTION_AUTH_REFRESH_TIMEOUT_MS = 10_000;
const LOCAL_ORIGIN_INVALIDATION_FALLBACK_MS = 1000;
const LOCAL_ACTION_CALL_RETENTION_MS = 30_000;
const RECENT_INVALIDATION_RETENTION_MS = 30_000;
function isSpaceQueryInvalidatedMessage(value) {
    return (typeof value === "object" &&
        value != null &&
        value.type ===
            SPACE_QUERY_INVALIDATED_MESSAGE_TYPE);
}
function isHatchSpaceActionRefreshableFailureCode(value) {
    return HATCH_SPACE_ACTION_REFRESHABLE_FAILURE_CODES.includes(value);
}
function isSpaceActionRefreshableErrorBody(value) {
    if (typeof value !== "object" || value == null) {
        return false;
    }
    const error = value.error;
    if (typeof error !== "object" || error == null) {
        return false;
    }
    return isHatchSpaceActionRefreshableFailureCode(error.code);
}
function isSpaceUnavailableErrorBody(value) {
    if (typeof value !== "object" || value == null) {
        return false;
    }
    const error = value.error;
    if (typeof error !== "object" || error == null) {
        return false;
    }
    return error.code === HATCH_SPACE_UNAVAILABLE_REASON;
}
function notifySpaceActionAuthRefreshRequired(reason, requestId) {
    if (typeof window === "undefined" || window.parent === window) {
        return false;
    }
    window.parent.postMessage({
        type: HATCH_SPACE_ACTION_AUTH_REFRESH_REQUIRED_MESSAGE,
        reason,
        requestId,
    }, "*");
    return true;
}
function notifyHostSpaceUnavailable(actionCallId) {
    if (typeof window === "undefined" || window.parent === window) {
        return false;
    }
    window.parent.postMessage({
        type: HATCH_SPACE_UNAVAILABLE_MESSAGE,
        reason: HATCH_SPACE_UNAVAILABLE_REASON,
        actionCallId,
    }, "*");
    return true;
}
function isSpaceActionAuthRefreshResultMessage(value, requestId) {
    return (typeof value === "object" &&
        value != null &&
        value.type ===
            HATCH_SPACE_ACTION_AUTH_REFRESH_RESULT_MESSAGE &&
        value.requestId === requestId);
}
function createRefreshRequestId() {
    return `refresh-${createActionCallId()}`;
}
function waitForSpaceActionAuthRefresh(reason) {
    const requestId = createRefreshRequestId();
    const refreshWindow = typeof window === "undefined" ? null : window;
    if (refreshWindow == null ||
        refreshWindow.parent === refreshWindow ||
        typeof refreshWindow.addEventListener !== "function" ||
        typeof refreshWindow.removeEventListener !== "function") {
        notifySpaceActionAuthRefreshRequired(reason, requestId);
        return Promise.reject(new Error("space action auth refresh is unavailable"));
    }
    return new Promise((resolve, reject) => {
        const timeout = refreshWindow.setTimeout(() => {
            cleanup();
            reject(new Error("space action auth refresh timed out"));
        }, SPACE_ACTION_AUTH_REFRESH_TIMEOUT_MS);
        const cleanup = () => {
            refreshWindow.clearTimeout(timeout);
            refreshWindow.removeEventListener("message", handleMessage);
        };
        const handleMessage = (event) => {
            if (event.source !== refreshWindow.parent) {
                return;
            }
            if (!isSpaceActionAuthRefreshResultMessage(event.data, requestId)) {
                return;
            }
            cleanup();
            if (event.data.ok === true) {
                resolve(event.data);
                return;
            }
            const error = typeof event.data.error === "string" && event.data.error.length > 0
                ? event.data.error
                : "space action auth refresh failed";
            reject(new Error(error));
        };
        refreshWindow.addEventListener("message", handleMessage);
        if (!notifySpaceActionAuthRefreshRequired(reason, requestId)) {
            cleanup();
            reject(new Error("space action auth refresh is unavailable"));
        }
    });
}
function endpointWithViewerAssertion(endpoint, iframeSrc) {
    if (typeof iframeSrc !== "string" || iframeSrc.length === 0) {
        return null;
    }
    const baseHref = globalThis.location?.href ?? "https://hatch.invalid/";
    let viewerAssertion = null;
    try {
        viewerAssertion = new URL(iframeSrc, baseHref).searchParams.get("viewer_assertion");
    }
    catch {
        return null;
    }
    if (viewerAssertion == null || viewerAssertion.length === 0) {
        return null;
    }
    try {
        const actionUrl = new URL(endpoint, baseHref);
        actionUrl.searchParams.set("viewer_assertion", viewerAssertion);
        return actionUrl.toString();
    }
    catch {
        return null;
    }
}
function queryKeysFromMessage(message) {
    const queryKeys = message.payload?.queryKeys;
    if (!Array.isArray(queryKeys)) {
        return null;
    }
    return queryKeys.filter((queryKey) => Array.isArray(queryKey));
}
const localActionCalls = new Map();
const bridgedActionCalls = new Map();
let spaceUnavailable = false;
const recentLocalInvalidations = [];
function nowMs() {
    return Date.now();
}
function pruneRecentInvalidations(timestampMs) {
    const cutoff = timestampMs - RECENT_INVALIDATION_RETENTION_MS;
    while (true) {
        const oldest = recentLocalInvalidations[0];
        if (oldest == null || oldest.tsMs >= cutoff) {
            break;
        }
        recentLocalInvalidations.shift();
    }
}
function queryKeyPartEquals(left, right) {
    if (Object.is(left, right)) {
        return true;
    }
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    }
    catch {
        return false;
    }
}
function queryKeyStartsWith(queryKey, prefix) {
    if (prefix.length > queryKey.length) {
        return false;
    }
    return prefix.every((part, index) => queryKeyPartEquals(part, queryKey[index]));
}
function queryKeysOverlap(left, right) {
    return queryKeyStartsWith(left, right) || queryKeyStartsWith(right, left);
}
function invalidationTargetFromArgs(args) {
    const [filters] = args;
    if (filters == null) {
        return "all";
    }
    if (Array.isArray(filters)) {
        return filters;
    }
    if (typeof filters === "object" &&
        filters != null &&
        "queryKey" in filters &&
        Array.isArray(filters.queryKey)) {
        return filters.queryKey;
    }
    return "all";
}
function recordLocalInvalidation(target) {
    const tsMs = nowMs();
    pruneRecentInvalidations(tsMs);
    recentLocalInvalidations.push({ target, tsMs });
}
function hasOverlappingLocalInvalidationSince(queryKey, sinceMs) {
    const tsMs = nowMs();
    pruneRecentInvalidations(tsMs);
    return recentLocalInvalidations.some((entry) => entry.tsMs >= sinceMs &&
        (entry.target === "all" || queryKeysOverlap(queryKey, entry.target)));
}
function hasAnyLocalInvalidationSince(sinceMs) {
    const tsMs = nowMs();
    pruneRecentInvalidations(tsMs);
    return recentLocalInvalidations.some((entry) => entry.tsMs >= sinceMs);
}
function rememberLocalActionCall(actionCallId) {
    const startedAtMs = nowMs();
    localActionCalls.set(actionCallId, startedAtMs);
    if (typeof window === "undefined") {
        return;
    }
    window.setTimeout(() => {
        if (localActionCalls.get(actionCallId) === startedAtMs) {
            localActionCalls.delete(actionCallId);
        }
    }, LOCAL_ACTION_CALL_RETENTION_MS);
}
function rememberBridgedActionCall(actionCallId) {
    const tsMs = nowMs();
    for (const [callId, seenMs] of bridgedActionCalls) {
        if (tsMs - seenMs > LOCAL_ACTION_CALL_RETENTION_MS * 2) {
            bridgedActionCalls.delete(callId);
        }
    }
    bridgedActionCalls.set(actionCallId, tsMs);
}
function markSpaceUnavailable(actionCallId) {
    if (spaceUnavailable) {
        return;
    }
    spaceUnavailable = true;
    void spaceQueryClient.cancelQueries();
    notifyHostSpaceUnavailable(actionCallId);
}
function throwIfSpaceUnavailable() {
    if (!spaceUnavailable) {
        return;
    }
    throw new SpaceActionError("Space is no longer available", 404);
}
function originActionCallIdFromMessage(message) {
    const value = message.payload?.originActionCallId;
    return typeof value === "string" && value.length > 0 ? value : null;
}
function invalidateFromBridge(queryClient, queryKey, originActionCallId) {
    const localStartedAtMs = originActionCallId == null
        ? undefined
        : localActionCalls.get(originActionCallId);
    if (localStartedAtMs == null) {
        void invalidateQueryFromBridge(queryClient, queryKey);
        return;
    }
    if (hasOverlappingLocalInvalidationSince(queryKey, localStartedAtMs)) {
        return;
    }
    window.setTimeout(() => {
        if (hasOverlappingLocalInvalidationSince(queryKey, localStartedAtMs)) {
            return;
        }
        void invalidateQueryFromBridge(queryClient, queryKey);
    }, LOCAL_ORIGIN_INVALIDATION_FALLBACK_MS);
}
function invalidateAllFromBridge(queryClient, originActionCallId) {
    const localStartedAtMs = originActionCallId == null
        ? undefined
        : localActionCalls.get(originActionCallId);
    if (localStartedAtMs == null) {
        void invalidateAllQueriesFromBridge(queryClient);
        return;
    }
    if (hasAnyLocalInvalidationSince(localStartedAtMs)) {
        return;
    }
    window.setTimeout(() => {
        if (hasAnyLocalInvalidationSince(localStartedAtMs)) {
            return;
        }
        void invalidateAllQueriesFromBridge(queryClient);
    }, LOCAL_ORIGIN_INVALIDATION_FALLBACK_MS);
}
const rawInvalidateQueries = spaceQueryClient.invalidateQueries.bind(spaceQueryClient);
spaceQueryClient.invalidateQueries = ((...args) => {
    const target = invalidationTargetFromArgs(args);
    if (target != null) {
        recordLocalInvalidation(target);
    }
    return rawInvalidateQueries(...args);
});
function invalidateQueryFromBridge(queryClient, queryKey) {
    if (queryClient === spaceQueryClient) {
        return rawInvalidateQueries({ queryKey });
    }
    return queryClient.invalidateQueries({ queryKey });
}
function invalidateAllQueriesFromBridge(queryClient) {
    if (queryClient === spaceQueryClient) {
        return rawInvalidateQueries();
    }
    return queryClient.invalidateQueries();
}
let queryInvalidationListenerInstalled = false;
export function installSpaceQueryInvalidationListener(queryClient = spaceQueryClient) {
    if (queryInvalidationListenerInstalled || typeof window === "undefined") {
        return;
    }
    queryInvalidationListenerInstalled = true;
    window.addEventListener("message", (event) => {
        // NOTE(tec27): When framed, we don't check for same origin because Spaces are served on their
        // own subdomains (with a separate base domain from the hatch frontend). The VM has to be
        // provided with a short-lived notary token to load these in the first place, so we can safely
        // assume that anyone that was allowed to frame us is authorized to do so + send us messages.
        // The event.source === window.parent check is still useful though: only the thing framing us
        // can send messages, not popups, sibling frames, etc.
        //
        // When top-level (e.g. a Space opened directly via its share URL), the framing-trust argument
        // doesn't apply — any cross-origin opener that holds a window handle could otherwise spam
        // invalidations and trigger refetch churn against the Space backend — so we fall back to a
        // strict same-origin check.
        if (window.parent !== window) {
            if (event.source !== window.parent) {
                return;
            }
        }
        else if (event.origin !== window.location.origin) {
            return;
        }
        if (!isSpaceQueryInvalidatedMessage(event.data)) {
            return;
        }
        const originActionCallId = originActionCallIdFromMessage(event.data);
        if (originActionCallId != null) {
            rememberBridgedActionCall(originActionCallId);
        }
        const queryKeys = queryKeysFromMessage(event.data);
        if (queryKeys == null) {
            return;
        }
        if (queryKeys.length === 0) {
            invalidateAllFromBridge(queryClient, originActionCallId);
            return;
        }
        for (const queryKey of queryKeys) {
            invalidateFromBridge(queryClient, queryKey, originActionCallId);
        }
    });
}
installSpaceQueryInvalidationListener();
const DEFAULT_ENDPOINT = "./actions";
function resolveEndpoint(relative) {
    const href = globalThis.location?.href;
    if (typeof href !== "string" || href.length === 0) {
        return relative;
    }
    const base = new URL(href);
    base.hash = "";
    base.search = "";
    return new URL(relative, base).toString();
}
export function createActionClient(options = {}) {
    const endpoint = options.endpoint ?? resolveEndpoint(DEFAULT_ENDPOINT);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const callAction = (action, args, actionEndpoint, actionCallId) => fetchImpl(actionEndpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            // Belt-and-suspenders request correlation: the agent.meta.ai proxy
            // strips this header (the daemon falls back to the body `actionCallId`),
            // but we still send it for environments that preserve it.
            "x-request-id": actionCallId,
        },
        body: JSON.stringify({
            action,
            args: args ?? {},
            actionCallId,
        }),
    });
    const readActionData = async (response, name) => {
        const body = (await response.json());
        if (body && typeof body === "object" && "error" in body && body.error) {
            throw new Error(`action ${name} error: ${String(body.error)}`);
        }
        return body.data;
    };
    return new Proxy({}, {
        get(_target, name) {
            // Symbol keys (Symbol.toPrimitive, Symbol.iterator, etc.) and
            // promise-protocol property names (then/catch/finally) must NOT
            // resolve to a phantom action. If `then` returned a function, any
            // accidental `await client` or `Promise.resolve(client)` would
            // see a thenable and call our function with (resolve, reject) as
            // its args — firing a network POST to a non-existent action named
            // "then". Same hazard for `catch`/`finally` in some
            // promise-chaining utilities.
            if (typeof name !== "string") {
                return undefined;
            }
            if (name === "then" || name === "catch" || name === "finally") {
                return undefined;
            }
            const invokeAction = async (args) => {
                throwIfSpaceUnavailable();
                const actionCallId = createActionCallId();
                rememberLocalActionCall(actionCallId);
                const response = await callAction(name, args, endpoint, actionCallId);
                if (!response.ok) {
                    const body = await readActionErrorBody(response);
                    if (response.status === 404 &&
                        isSpaceUnavailableErrorBody(body)) {
                        markSpaceUnavailable(actionCallId);
                        // A space_unavailable 404 is terminal. Throw the canonical error
                        // for this first failing call too, so it matches every later
                        // latched call instead of leaking the raw server body.
                        throwIfSpaceUnavailable();
                    }
                    if (isSpaceActionRefreshableErrorBody(body)) {
                        const refreshResult = await waitForSpaceActionAuthRefresh(body.error.code);
                        // The handler may have committed a write before needing a VM
                        // credential. Refresh authentication, but replay only when the
                        // server explicitly guarantees the handler never started.
                        if (!("retrySafe" in body) || body.retrySafe !== true) {
                            throw new SpaceActionError("Your session has been refreshed. Reload the app to check whether your changes were saved before trying again.", 409);
                        }
                        const retryEndpoint = endpointWithViewerAssertion(endpoint, refreshResult.iframeSrc);
                        if (retryEndpoint == null) {
                            throw new Error(`action ${name} auth refresh did not return a fresh viewer_assertion`);
                        }
                        throwIfSpaceUnavailable();
                        const retryResponse = await callAction(name, args, retryEndpoint, actionCallId);
                        if (!retryResponse.ok) {
                            const retryBody = await readActionErrorBody(retryResponse);
                            if (retryResponse.status === 404 &&
                                isSpaceUnavailableErrorBody(retryBody)) {
                                markSpaceUnavailable(actionCallId);
                                throwIfSpaceUnavailable();
                            }
                            throw failedActionError(name, "failed after auth refresh", retryResponse, retryBody);
                        }
                        return readActionData(retryResponse, name);
                    }
                    throw failedActionError(name, "failed", response, body);
                }
                return readActionData(response, name);
            };
            // A network drop or failed auth refresh arrives as a plain error. The request may
            // already have run, so it reads like any outcome we can't confirm; `detail` keeps
            // the original text.
            return (args) => invokeAction(args).catch((error) => {
                if (!READABLE_FAILURES || error instanceof SpaceActionError)
                    throw error;
                throw new SpaceActionError(OUTCOME_UNKNOWN_MESSAGE, 0, undefined, false, undefined, [], String(error));
            });
        },
    });
}
function failedActionError(name, failure, response, body) {
    const issues = requestSchemaIssues(body);
    const detail = actionFailureDetail(name, failure, response.status, body);
    return new SpaceActionError(!READABLE_FAILURES
        ? legacyFailureMessage(body, detail)
        : issues.length > 0
            ? requestSchemaMessage(issues)
            : actionFailureMessage(response.status, body), response.status, parseRetryAfterMs(response), isActionRetrySafe(body), actionErrorCode(body), issues, detail);
}
function isActionRetrySafe(body) {
    return body !== null && typeof body === "object" && "retrySafe" in body && body.retrySafe === true;
}
const RETRY_MESSAGE = "Something went wrong. Please try again.";
const BUSY_MESSAGE = "The app is busy right now. Please try again in a moment.";
// The same sentence the Cloudflare runtime sends with `action_outcome_unknown`.
const OUTCOME_UNKNOWN_MESSAGE = "The app could not confirm the result. Reload to check your changes before trying again.";
const SHOWN_REFUSAL_CODES = new Set([
    "view_only",
    "peer_artifact_view_only",
]);
/** Before platformVersion 29: a shown refusal keeps the host's sentence; anything else is the detail. */
function legacyFailureMessage(body, detail) {
    const text = actionErrorText(body);
    const code = actionErrorCode(body);
    return code !== undefined && SHOWN_REFUSAL_CODES.has(code) && text !== undefined && text.length > 0 ? text : detail;
}
/**
 * A shown refusal, such as a view-only viewer's, keeps the host's own sentence,
 * and so does the action's own error ("That slot is already booked at 10:30").
 * A crash or database error, which the worker names by its type ("TypeError: …"),
 * or a server that can't be reached becomes a plain retry message; a result the
 * server could not confirm asks the person to reload before trying again.
 */
function actionFailureMessage(status, body) {
    const text = actionErrorText(body);
    const code = actionErrorCode(body);
    if (code !== undefined && SHOWN_REFUSAL_CODES.has(code) && text !== undefined && text.length > 0) {
        return text;
    }
    if (code === "shared_artifact_vm_capability_unavailable") {
        return "This isn't available while the app is shared.";
    }
    if (code === "action_outcome_unknown") {
        return OUTCOME_UNKNOWN_MESSAGE;
    }
    // The VM runs the handler before it validates the response, so the write may have happened.
    if (text !== undefined && /^response validation failed\b/.test(text)) {
        return OUTCOME_UNKNOWN_MESSAGE;
    }
    if (status < 502 && text !== undefined && isActionsOwnMessage(text)) {
        return text;
    }
    return status === 429 || status >= 502 ? BUSY_MESSAGE : RETRY_MESSAGE;
}
function actionFailureDetail(name, failure, status, body) {
    const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
    return `action ${name} ${failure}: ${status} ${text}`;
}
function actionErrorText(body) {
    const error = body !== null && typeof body === "object" && "error" in body ? body.error : undefined;
    const message = typeof error === "string" ? error : error?.message;
    return typeof message === "string" ? message.replace(/^Error: /, "").trim() : undefined;
}
// What the worker sends for a crash, a rejected request or a database failure.
const CRASH_TEXT = /^[A-Za-z]*(?:Error|Exception)\b|^invalid args\b|^Failed query\b|^\s*[{[]|\bat \S+:\d+:\d+/;
function isActionsOwnMessage(text) {
    return text.length > 0 && text.length <= 500 && !text.includes("\n") && !CRASH_TEXT.test(text);
}
function actionErrorCode(body) {
    if (body === null || typeof body !== "object") {
        return undefined;
    }
    if ("code" in body && typeof body.code === "string") {
        return body.code;
    }
    const error = "error" in body ? body.error : undefined;
    const nested = error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return typeof nested === "string" && SHOWN_REFUSAL_CODES.has(nested) ? nested : undefined;
}
// Parse a `Retry-After` response header (RFC 7231 delta-seconds or HTTP-date)
// into milliseconds-from-now. Returns undefined when absent/unparseable.
function parseRetryAfterMs(response) {
    const raw = response.headers.get("retry-after");
    if (raw == null) {
        return undefined;
    }
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }
    return undefined;
}
async function readActionErrorBody(response) {
    const text = await response.text();
    if (text.length === 0) {
        return "";
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function createActionCallId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `space-action-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2)}`;
}
const spaceViewerStore = createSpaceViewerStore({
    isKnownCall: (callId) => localActionCalls.has(callId) || bridgedActionCalls.has(callId),
    refresh: () => {
        void invalidateAllQueriesFromBridge(spaceQueryClient);
    },
});
/**
 * Who is viewing this Space, its owner, and who else has it open now, read
 * from the Muse that serves it. Null when the Space has no viewer context,
 * such as a public share link or when the owner hasn't turned on connections.
 */
export function getSpaceViewer() {
    return spaceViewerStore.get();
}
/**
 * Follow the viewer context while the page is visible: the listener gets the
 * current context, plus an event when someone joins, leaves, or changes the
 * data. Subscribing keeps this viewer present for others and refetches the
 * page's queries when someone else changes the data. Returns an unsubscribe.
 */
export function subscribeSpaceViewer(listener) {
    return spaceViewerStore.subscribe((event) => listener(spaceViewerStore.current(), event));
}
/** React hook form of {@link subscribeSpaceViewer}: the current context, or null. */
export function useSpaceViewer() {
    return useSpaceViewerFrom(spaceViewerStore);
}
