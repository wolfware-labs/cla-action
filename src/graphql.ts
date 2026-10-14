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
                oid
                author { email name user { id databaseId login } }
                committer { name user { id databaseId login } }
                authors(first: 100) { totalCount nodes { email name user { id databaseId login } } }
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
  email?: string
  user?: { databaseId: number; login: string } | null
}

interface Commit {
  oid?: string
  author: GitActor
  committer: GitActor
  authors?: { totalCount?: number; nodes: GitActor[] }
}

/** A contributor, with the key that tells contributors apart: the account id, or the commit email when unlinked. */
interface Account {
  name: string
  id: number | ''
  key: string
}

const linked = (user: { databaseId: number; login: string }): Account => ({ name: user.login, id: user.databaseId, key: `id:${user.databaseId}` })

const unlinked = (name: string, email?: string): Account => ({ name, id: '', key: `email:${(email || name).toLowerCase()}` })

const account = (actor: GitActor): Account => (actor.user ? linked(actor.user) : unlinked(actor.name || '', actor.email))

/**
 * Everyone who wrote a commit: the author, or the committer when only the
 * committer is linked to an account, plus the co-authors named in
 * Co-authored-by trailers, which GitHub lists under `authors` after the
 * author. A commit with more authors than one page holds fails the check,
 * so nobody is skipped.
 */
function accountsOf(commit: Commit): Account[] {
  if (commit.authors && (commit.authors.totalCount ?? 0) > commit.authors.nodes.length) {
    throw new Error(`commit ${commit.oid} has ${commit.authors.totalCount} authors; at most ${commit.authors.nodes.length} can be checked`)
  }
  const user = commit.author.user || commit.committer.user
  const primary = user ? linked(user) : unlinked(commit.author.name || commit.committer.name || '', commit.author.email)
  // The authors list repeats the commit author, whom `primary` already stands for.
  const authorKey = account(commit.author).key
  const coAuthors = (commit.authors?.nodes ?? []).map(account).filter(coAuthor => coAuthor.key !== authorKey)
  return [primary, ...coAuthors]
}

/** The distinct authors and co-authors of all of the pull request's commits, read 100 at a time. */
export default async function getCommitters(): Promise<Committer[]> {
  const committers: Committer[] = []
  const seen = new Set<string>()
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
      for (const { name, id, key } of accountsOf(edge.node.commit)) {
        if (id === GITHUB_ACTIONS_BOT_ID || seen.has(key)) {
          continue
        }
        seen.add(key)
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
