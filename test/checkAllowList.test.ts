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

  it('never skips an author whose commit email is not linked to an account', () => {
    reset({ allowlist: 'dependabot[bot],*[bot]' })
    const spoofed = { name: 'dependabot[bot]', id: '' as const, pullRequestNo: 7 }
    expect(checkAllowList([spoofed, committer('renovate[bot]', 3)])).toEqual([spoofed])
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

  it('matches a wildcard pattern against the whole name', () => {
    reset({ allowlist: 'bot*,*[bot]' })
    const result = checkAllowList([committer('robotics', 1), committer('bot-two', 2), committer('renovate[bot]', 3)])
    expect(names(result)).toEqual(['robotics'])
  })

  it('ignores empty allowlist entries', () => {
    reset({ allowlist: 'alice,,' })
    expect(names(checkAllowList([committer('alice', 1), committer('bob', 2)]))).toEqual(['bob'])
  })

  it('drops empty entries in the committer list', () => {
    const result = checkAllowList([committer('alice', 1), undefined as any])
    expect(names(result)).toEqual(['alice'])
  })
})
