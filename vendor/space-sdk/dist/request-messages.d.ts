type Issue = {
    code?: string;
    path?: readonly PropertyKey[];
    input?: unknown;
    origin?: unknown;
    format?: unknown;
    expected?: unknown;
    maximum?: unknown;
    minimum?: unknown;
    inclusive?: unknown;
};
export declare function requestIssueMessage(i: Issue): string | undefined;
export {};
//# sourceMappingURL=request-messages.d.ts.map