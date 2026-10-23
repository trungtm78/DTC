/** Injection token of the fonts and fixed texts that the renderer draws with. */
export const DOC_RESOURCES = Symbol('DOC_RESOURCES');
/** Injection token of the `PdfRenderer` port (the `pdf-lib` adapter in production). */
export const PDF_RENDERER = Symbol('PDF_RENDERER');
/** Injection token of the fixed words of a state document (`state-text.json`). */
export const DOC_STATE_TEXT = Symbol('DOC_STATE_TEXT');
/** Injection token of the metrics sink of the document module; the no-op sink is used when none is bound. */
export const DOC_METRICS = Symbol('DOC_METRICS');
/** Injection token of the clock of the document module; the system clock is used when none is bound. */
export const DOC_CLOCK = Symbol('DOC_CLOCK');

/** How long a download URL lives (BR-DOC-19: at most 300 seconds). */
export const DOWNLOAD_URL_TTL_SECONDS = 300;
