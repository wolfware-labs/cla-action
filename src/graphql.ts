import { context } from '@actions/github'
import { octokit } from './octokit'
import { Committer } from './interfaces'

/** The user id of github-actions[bot]; its commits never need a signature. */
const GITHUB_ACTIONS_BOT_ID = 41898282

const QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $cursor: String!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        commits(first: 100, after: $cursor) {
          totalCount
          edges {
            node {
              commit {
                author { email name user { id databaseId login } }
                committer { name user { id databaseId login } }
                authors(first: 20) { nodes { email name user { id databaseId login } } }
              }
            }
            cursor
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }`

interface GitActor {
  name?: string
  user?: { databaseId: number; login: string } | null
}

interface Commit {
  author: GitActor
  committer: GitActor
  authors?: { nodes: GitActor[] }
}

const account = (actor: GitActor): { name: string; id: number | '' } =>
  actor.user ? { name: actor.user.login, id: actor.user.databaseId } : { name: actor.name || '', id: '' }

/**
 * Everyone who wrote a commit: the author and the co-authors named in
 * Co-authored-by trailers, which GitHub lists under `authors`. A commit
 * without that list falls back to its author, then its committer.
 */
function accountsOf(commit: Commit): { name: string; id: number | '' }[] {
  if (commit.authors?.nodes.length) {
    return commit.authors.nodes.map(account)
  }
  const user = commit.author.user || commit.committer.user
  if (user) {
    return [{ name: user.login, id: user.databaseId }]
  }
  return [{ name: commit.author.name || commit.committer.name || '', id: '' }]
}

/** The distinct authors and co-authors of all of the pull request's commits, read 100 at a time. */
export default async function getCommitters(): Promise<Committer[]> {
  const committers: Committer[] = []
  let cursor = ''
  for (;;) {
    let commits: any
    try {
      const response: any = await octokit.graphql(QUERY, {
        owner: context.repo.owner,
        name: context.repo.repo,
        number: context.issue.number,
        cursor
      })
      commits = response.repository.pullRequest.commits
    } catch (error) {
      throw new Error(`graphql call to get the committers details failed: ${error}`)
    }

    for (const edge of commits.edges) {
      for (const { name, id } of accountsOf(edge.node.commit)) {
        if (id === GITHUB_ACTIONS_BOT_ID || committers.some(c => c.name === name)) {
          continue
        }
        committers.push({ name, id, pullRequestNo: context.issue.number })
      }
    }

    if (!commits.pageInfo.hasNextPage) {
      return committers
    }
    const next = commits.pageInfo.endCursor
    if (!next || next === cursor) {
      throw new Error('graphql call to get the committers details failed: the commit list did not advance to the next page')
    }
    cursor = next
  }
}
