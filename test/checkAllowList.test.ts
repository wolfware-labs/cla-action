import { beforeEach, describe, expect, it, vi } from 'vitest'
import { committer, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)

const { checkAllowList } = await import('../src/checkAllowList')

const names = (list: { name: string }[]) => list.map(c => c.name)

describe('checkAllowList', () => {
  beforeEach(() => reset())

  it('keeps everyone when the allowlist is empty', () => {
    const result = checkAllowList([committer('alice', 1), committer('bob', 2)])
    expect(names(result)).toEqual(['alice', 'bob'])
  })

  it('removes exact matches and ignores spaces around entries', () => {
    reset({ allowlist: ' alice , dependabot[bot]' })
    const result = checkAllowList([
      committer('alice', 1),
      committer('bob', 2),
      committer('dependabot[bot]', 3)
    ])
    expect(names(result)).toEqual(['bob'])
  })

  it('matches names case-sensitively', () => {
    reset({ allowlist: 'Alice' })
    expect(names(checkAllowList([committer('alice', 1)]))).toEqual(['alice'])
  })

  it('treats * as a wildcard and escapes other regex characters', () => {
    reset({ allowlist: 'bot*,*a.b*' })
    const result = checkAllowList([
      committer('bot-one', 1),
      committer('axb', 2),
      committer('a.b', 3)
    ])
    expect(names(result)).toEqual(['axb'])
  })

  it('matches a wildcard pattern anywhere in the name (current behaviour)', () => {
    reset({ allowlist: 'bot*' })
    expect(names(checkAllowList([committer('robotics', 1)]))).toEqual([])
  })

  it('drops empty entries in the committer list', () => {
    const result = checkAllowList([committer('alice', 1), undefined as any])
    expect(names(result)).toEqual(['alice'])
  })
})
