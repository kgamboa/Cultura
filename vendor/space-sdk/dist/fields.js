// Build-time macro: each action's request fields as form-input attributes, read
// from the schemas the server enforces. Bun inlines the result while bundling
// the client, so the page carries no zod and no copy of any limit.
import { createRequire } from "node:module";
import { join } from "node:path";
import { describeRequest } from "./client/field-props";
/**
 * Must be imported `with { type: "macro" }`; it reads the Space's
 * `server/src/actions.ts`, relative to the client build's working directory
 * (the Space root).
 */
export function actionFields() {
    const actionsPath = join(process.cwd(), "server", "src", "actions.ts");
    const loaded = createRequire(join(process.cwd(), "package.json"))(actionsPath);
    if (loaded.Actions === undefined) {
        throw new Error(`actionFields: ${actionsPath} does not export \`Actions\``);
    }
    const fields = {};
    for (const [action, definition] of Object.entries(loaded.Actions)) {
        fields[action] = describeRequest(definition.request);
    }
    return fields;
}
