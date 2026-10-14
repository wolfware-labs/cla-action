import { Committer } from './interfaces'
import { getAllowList } from './shared/getInputs'

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Turns an allowlist entry into a matcher for a whole name; `*` matches any characters. */
function matcher(pattern: string): (name: string) => boolean {
  if (!pattern.includes('*')) {
    return name => name === pattern
  }
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)
  return name => regex.test(name)
}

/**
 * Removes authors on the allowlist. Only linked accounts can match: the name
 * of an unlinked author comes from commit metadata, which anyone can set.
 */
export function checkAllowList(committers: Committer[]): Committer[] {
  const matchers = getAllowList()
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .map(matcher)
  return committers.filter(committer => committer && !(committer.id && matchers.some(matches => matches(committer.name))))
}
