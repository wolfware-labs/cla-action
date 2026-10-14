import { beforeEach, describe, expect, it, vi } from 'vitest'
import { octokit, reset } from './harness'

vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { default: getCommitters } = await import('../src/graphql')

const user = (login: string, databaseId: number) => ({ id: `node-${login}`, databaseId, login })

function commits(...entries: { author: any; committer?: any; authors?: any }[]) {
  return {
    repository: {
      pullRequest: {
        commits: {
          totalCount: entries.length,
          edges: entries.map((commit, i) => ({
            node: { commit: { committer: { name: 'GitHub', user: null }, ...commit } },
            cursor: `c${i}`
          })),
          pageInfo: { endCursor: 'end', hasNextPage: false }
        }
      }
    }
  }
}

describe('getCommitters', () => {
  beforeEach(() => reset())

  it('queries the pull request of the event', async () => {
    octokit.graphql.mockResolvedValue(commits())
    await getCommitters()
    expect(octokit.graphql).toHaveBeenCalledWith(expect.any(String), {
      owner: 'acme',
      name: 'widgets',
      number: 7,
      cursor: ''
    })
  })

  it('returns each author once, with login, id and pull request number', async () => {
    octokit.graphql.mockResolvedValue(
      commits(
        { author: { name: 'Alice', email: 'a@x', user: user('alice', 1) } },
        { author: { name: 'Alice', email: 'a@x', user: user('alice', 1) } },
        { author: { name: 'Bob', email: 'b@x', user: user('bob', 2) } }
      )
    )
    expect(await getCommitters()).toEqual([
      { name: 'alice', id: 1, pullRequestNo: 7 },
      { name: 'bob', id: 2, pullRequestNo: 7 }
    ])
  })

  it('falls back to the committer account, then to the author name without an id', async () => {
    octokit.graphql.mockResolvedValue(
      commits(
        { author: { name: 'Carol', email: 'c@x', user: null }, committer: { name: 'Carol', user: user('carol', 3) } },
        { author: { name: 'Dan Unlinked', email: 'd@x', user: null }, committer: { name: 'Dan', user: null } }
      )
    )
    expect(await getCommitters()).toEqual([
      { name: 'carol', id: 3, pullRequestNo: 7 },
      { name: 'Dan Unlinked', id: '', pullRequestNo: 7 }
    ])
  })

  it('includes co-authors from Co-authored-by trailers, linked or not', async () => {
    octokit.graphql.mockResolvedValue(
      commits({
        author: { name: 'Alice', email: 'a@x', user: user('alice', 1) },
        authors: {
          nodes: [
            { name: 'Alice', email: 'a@x', user: user('alice', 1) },
            { name: 'Bob', email: 'b@x', user: user('bob', 2) },
            { name: 'Erin Unlinked', email: 'e@x', user: null }
          ]
        }
      })
    )
    expect(await getCommitters()).toEqual([
      { name: 'alice', id: 1, pullRequestNo: 7 },
      { name: 'bob', id: 2, pullRequestNo: 7 },
      { name: 'Erin Unlinked', id: '', pullRequestNo: 7 }
    ])
  })

  it('fails instead of skipping co-authors past the first 100', async () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({ name: `Co ${i}`, email: `c${i}@x`, user: user(`co${i}`, 100 + i) }))
    octokit.graphql.mockResolvedValue(
      commits({ oid: 'abc123', author: { name: 'Alice', email: 'a@x', user: user('alice', 1) }, authors: { totalCount: 101, nodes } } as any)
    )
    expect(octokit.graphql).not.toHaveBeenCalled()
    await expect(getCommitters()).rejects.toThrow('commit abc123 has 101 authors; at most 100 can be checked')
    expect(octokit.graphql.mock.calls[0][0]).toContain('authors(first: 100) { totalCount')
  })

  it('leaves out commits made by github-actions[bot]', async () => {
    octokit.graphql.mockResolvedValue(
      commits({ author: { name: 'github-actions[bot]', email: 'x', user: user('github-actions[bot]', 41898282) } })
    )
    expect(await getCommitters()).toEqual([])
  })

  it('reads every page of commits, 100 at a time', async () => {
    const first = commits({ author: { name: 'Alice', email: 'a@x', user: user('alice', 1) } })
    first.repository.pullRequest.commits.pageInfo = { endCursor: 'page-1', hasNextPage: true }
    const second = commits(
      { author: { name: 'Alice', email: 'a@x', user: user('alice', 1) } },
      { author: { name: 'Bob', email: 'b@x', user: user('bob', 2) } }
    )
    octokit.graphql.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    expect((await getCommitters()).map(c => c.name)).toEqual(['alice', 'bob'])
    expect(octokit.graphql).toHaveBeenCalledTimes(2)
    expect(octokit.graphql.mock.calls[1][1].cursor).toBe('page-1')
    expect(octokit.graphql.mock.calls[0][0]).toMatch(/commits\(first: 100, after: \$cursor\)/)
  })

  it('stops when the next page cursor does not advance', async () => {
    const page = commits({ author: { name: 'Alice', email: 'a@x', user: user('alice', 1) } })
    page.repository.pullRequest.commits.pageInfo = { endCursor: '', hasNextPage: true }
    octokit.graphql.mockResolvedValue(page)
    await expect(getCommitters()).rejects.toThrow('did not advance to the next page')
    expect(octokit.graphql).toHaveBeenCalledTimes(1)
  })

  it('wraps API errors', async () => {
    octokit.graphql.mockRejectedValue(new Error('boom'))
    await expect(getCommitters()).rejects.toThrow('graphql call to get the committers details failed: Error: boom')
  })
})
