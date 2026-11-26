// Font stacks for canvas text; css/style.css defines the same two as --serif and --sans. System fonts only: a web
// font arriving late would leave the cached measureText() widths of banners and labels wrong.
export const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
export const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';
// Small map text (banner names, plaques, tabs): the same Latin serif as SERIF.
export const LABEL = SERIF;

/** True for a string with CJK characters. Kept for callers that still branch on it; Spanish text never matches. */
export const isCJK = (s) => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(String(s ?? ""));
