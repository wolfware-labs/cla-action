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

/** The GitHub account of a commit, falling back to the author name for unlinked emails. */
function accountOf(commit: { author: GitActor; committer: GitActor }): { name: string; id: number | '' } {
  const user = commit.author.user || commit.committer.user
  if (user) {
    return { name: user.login, id: user.databaseId }
  }
  return { name: commit.author.name || commit.committer.name || '', id: '' }
}

/** The distinct authors of the pull request's commits. */
export default async function getCommitters(): Promise<Committer[]> {
  let response: any
  try {
    response = await octokit.graphql(QUERY, {
      owner: context.repo.owner,
      name: context.repo.repo,
      number: context.issue.number,
      cursor: ''
    })
  } catch (error) {
    throw new Error(`graphql call to get the committers details failed: ${error}`)
  }

  const committers: Committer[] = []
  for (const edge of response.repository.pullRequest.commits.edges) {
    const { name, id } = accountOf(edge.node.commit)
    if (id === GITHUB_ACTIONS_BOT_ID || committers.some(c => c.name === name)) {
      continue
    }
    committers.push({ name, id, pullRequestNo: context.issue.number })
  }
  return committers
}
