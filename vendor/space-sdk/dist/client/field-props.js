// Form-input attributes read from the same Zod request schema the server
// enforces, so the page and the server can't disagree about a field's limits.
const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "readonly", "catch"]);
const INTEGER_FORMATS = new Set(["safeint", "int32", "uint32", "int64", "uint64"]);
/** The fields of a request schema, or `{}` when the request is not an object. */
export function describeRequest(schema) {
    const node = schema;
    if (node?._zod?.def.type !== "object") {
        return {};
    }
    return describe(node, "", new Set());
}
// `active` holds the object schemas on the current path, so a self-referencing
// schema (a category with child categories) stops at its first repeat.
// A field inside an optional section (`.optional()`, `.nullable()`, `.default()`) or a list
// item is never `required`: the server accepts the section left empty, and the box that adds a
// list item is empty again once the item is added.
function describe(start, name, active, parentOptional = false) {
    let node = start;
    let optional = parentOptional;
    while (WRAPPERS.has(node._zod.def.type) && node._zod.def.innerType !== undefined) {
        if (node._zod.def.type !== "readonly" && node._zod.def.type !== "catch") {
            optional = true;
        }
        node = node._zod.def.innerType;
    }
    const def = node._zod.def;
    if (def.type === "object" && def.shape !== undefined) {
        if (active.has(node))
            return {};
        active.add(node);
        const fields = {};
        for (const [field, child] of Object.entries(def.shape)) {
            fields[field] = describe(child, field, active, optional);
        }
        active.delete(node);
        return fields;
    }
    if (def.type === "array" && def.element !== undefined) {
        return describe(def.element, name, active, true);
    }
    return scalar(node, name, optional);
}
function scalar(node, name, optional) {
    const props = { name };
    const bag = node._zod.bag;
    if (node._zod.def.type === "string") {
        if (bag.minimum !== undefined && bag.minimum > 0) {
            props.minLength = bag.minimum;
            if (!optional)
                props.required = true;
        }
        if (bag.maximum !== undefined)
            props.maxLength = bag.maximum;
        if (bag.format === "email" || bag.format === "url") {
            props.type = bag.format;
            if (!optional)
                props.required = true;
        }
        return props;
    }
    if (node._zod.def.type === "number") {
        // An exclusive bound on an integer becomes the next allowed whole number;
        // on a decimal it stays the bound itself (HTML has no exclusive bound), and
        // the server still rejects the bound with a readable `SpaceActionError`.
        const integer = bag.format !== undefined && INTEGER_FORMATS.has(bag.format);
        const step = integer ? 1 : 0;
        props.type = "number";
        props.step = integer ? 1 : "any";
        if (!optional)
            props.required = true;
        const min = tightest(Math.max, bag.minimum, bag.exclusiveMinimum, step);
        const max = tightest(Math.min, bag.maximum, bag.exclusiveMaximum, -step);
        if (min !== undefined)
            props.min = min;
        if (max !== undefined)
            props.max = max;
    }
    return props;
}
// `.int()` adds the safe-integer range as its own bound; it is not a limit a
// person could reach by typing, so it never becomes an attribute.
function tightest(pick, inclusive, exclusive, integerStep) {
    const bounds = [inclusive, exclusive === undefined ? undefined : exclusive + integerStep].filter((bound) => bound !== undefined && Number.isFinite(bound) && Math.abs(bound) < Number.MAX_SAFE_INTEGER);
    return bounds.length === 0 ? undefined : bounds.reduce(pick);
}
