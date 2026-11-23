/** Attributes to spread onto the `<input>` or `<textarea>` that feeds one request field. */
export type FieldProps = {
    name: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    step?: number | "any";
    type?: "email" | "url" | "number";
};
/**
 * One request schema's fields: an object field nests its own fields, a list
 * field takes the fields of one item, and every other field is the
 * attributes of its input.
 */
export type RequestFields<S> = S extends {
    shape: infer Shape;
} ? {
    readonly [F in keyof Shape]: RequestFields<Shape[F]>;
} : S extends {
    element: infer Item;
} ? RequestFields<Item> : S extends {
    unwrap(): infer Inner;
} ? RequestFields<Inner> : FieldProps;
type Described = FieldProps | {
    [field: string]: Described;
};
/** The fields of a request schema, or `{}` when the request is not an object. */
export declare function describeRequest(schema: unknown): Record<string, Described>;
export {};
//# sourceMappingURL=field-props.d.ts.map