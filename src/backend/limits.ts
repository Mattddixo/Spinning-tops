export const MB = 1_000_000;

/** Total raw size of a spec plus every file it references. */
export const MAX_SOURCE_BYTES = 20 * MB;

/** Files merged via $ref. */
export const MAX_FILES = 50;

/**
 * Forge caps front-end invocation responses at 5 MB. The spec travels gzip'd
 * and base64 encoded, so this is the limit on that encoded string.
 */
export const MAX_ENCODED_SPEC_BYTES = 4_500_000;

/** Pasted specs live in the page's macro parameters. */
export const MAX_INLINE_CHARS = 100_000;
