/** One request field the action's schema rejected, with the schema's message. */
export type SpaceActionIssue = {
    readonly path: readonly string[];
    readonly message: string;
};
export declare function requestSchemaIssues(body: unknown): SpaceActionIssue[];
/** The issues' messages, each said once: list items repeat the same rule. */
export declare function requestSchemaMessage(issues: readonly SpaceActionIssue[]): string;
//# sourceMappingURL=request-issues.d.ts.map