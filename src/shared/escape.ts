const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapes text for HTML, such as job summary cells. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => HTML_ESCAPES[char])

/**
 * Escapes text for a GitHub Markdown comment: no markup, no links and no
 * @-mentions. For names that come from commit metadata rather than an account.
 */
export const escapeMarkdown = (value: string): string => value.replace(/[\\`*_{}[\]()#+\-.!|~@<>&:]/g, '\\$&')
