// Turns a request-schema rejection into one readable line per field. The VM
// worker sends `{ error: "invalid args: <Zod issues JSON>" }`; a shared
// Cloudflare app sends `{ error, issues }`.
const INVALID_ARGS_PREFIX = "invalid args: ";
export function requestSchemaIssues(body) {
    if (body === null || typeof body !== "object") {
        return [];
    }
    let raw = "issues" in body ? body.issues : undefined;
    const error = "error" in body ? body.error : undefined;
    if (raw === undefined && typeof error === "string" && error.startsWith(INVALID_ARGS_PREFIX)) {
        try {
            raw = JSON.parse(error.slice(INVALID_ARGS_PREFIX.length));
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter((issue) => issue !== null && typeof issue === "object")
        .map((issue) => {
        const path = Array.isArray(issue.path) ? issue.path.map(String) : [];
        return { path, message: describeIssue(issue) };
    });
}
/** The issues' messages, each said once: list items repeat the same rule. */
export function requestSchemaMessage(issues) {
    // Joined on new lines so messages without end punctuation stay separate, in any language.
    return [...new Set(issues.map((issue) => issue.message))].join("\n");
}
/** The schema's message exactly as written: the runtime's English defaults already name the field. */
function describeIssue(issue) {
    const message = typeof issue.message === "string" ? issue.message.trim() : "";
    return message.length === 0 ? "This value is invalid." : message;
}
