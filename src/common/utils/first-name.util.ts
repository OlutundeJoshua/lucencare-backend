/**
 * The name to greet someone by in an email. Patients are stored with a single free-form
 * `name`, so this takes the leading word and falls back to the whole (trimmed) string —
 * a mononym, or a name that arrived with unusual spacing, still greets correctly rather
 * than producing "Hello ,".
 */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}
