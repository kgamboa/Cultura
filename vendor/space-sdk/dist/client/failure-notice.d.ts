/**
 * The page's own wording for the notice: the text to show, `null` to show nothing (the page
 * already shows this failure), or `undefined` to keep `message`, the error's own message, which
 * is English when the SDK wrote it.
 */
export type FailureNoticeText = (error: unknown, message: string) => string | null | undefined;
/** Lets a page word the automatic save-failure notice in its own language. */
export declare function setFailureNoticeText(text: FailureNoticeText | undefined): void;
/** Shows `error`'s readable message at the bottom of the page for a few seconds. */
export declare function showFailureNotice(error: unknown): void;
//# sourceMappingURL=failure-notice.d.ts.map