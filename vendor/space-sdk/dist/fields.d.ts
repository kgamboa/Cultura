import { type RequestFields } from "./client/field-props";
type ActionRequestFields<A> = A extends {
    request: {
        shape: infer Shape;
    };
} ? {
    readonly [F in keyof Shape]: RequestFields<Shape[F]>;
} : Record<never, never>;
/**
 * Input attributes for each action's request fields, keyed by action name and
 * then field name. An object field nests its fields, and a list field takes
 * the fields of one item: `FIELDS.logWorkout.sets.rpe`.
 */
export type ActionFields<A> = {
    readonly [K in keyof A]: ActionRequestFields<A[K]>;
};
/**
 * Must be imported `with { type: "macro" }`; it reads the Space's
 * `server/src/actions.ts`, relative to the client build's working directory
 * (the Space root).
 */
export declare function actionFields<A>(): ActionFields<A>;
export {};
//# sourceMappingURL=fields.d.ts.map