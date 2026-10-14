import { beforeEach, describe, expect, it, vi } from 'vitest'
import { octokit, reset } from './harness'

vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { default: getCommitters } = await import('../src/graphql')

const user = (login: string, databaseId: number) => ({ id: `node-${login}`, databaseId, login })

function commits(...entries: { author: any; committer?: any }[]) {
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

  it('leaves out commits made by github-actions[bot]', async () => {
    octokit.graphql.mockResolvedValue(
      commits({ author: { name: 'github-actions[bot]', email: 'x', user: user('github-actions[bot]', 41898282) } })
    )
    expect(await getCommitters()).toEqual([])
  })

  it('reads only the first page of 100 commits (current behaviour)', async () => {
    const page = commits({ author: { name: 'Alice', email: 'a@x', user: user('alice', 1) } })
    page.repository.pullRequest.commits.pageInfo.hasNextPage = true
    octokit.graphql.mockResolvedValue(page)
    await getCommitters()
    expect(octokit.graphql).toHaveBeenCalledTimes(1)
    expect(octokit.graphql.mock.calls[0][0]).toContain('commits(first:100,after:$cursor)')
  })

  it('wraps API errors', async () => {
    octokit.graphql.mockRejectedValue(new Error('boom'))
    await expect(getCommitters()).rejects.toThrow('graphql call to get the committers details failed: Error: boom')
  })
})
