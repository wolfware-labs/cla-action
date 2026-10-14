import * as core from '@actions/core'
import { context } from '@actions/github'
import { octokit } from '../octokit'

/** Locks the pull request conversation so that signature comments cannot be changed. */
export async function lockPullRequest(): Promise<void> {
  const pullRequestNo = context.issue.number
  core.info('Locking the Pull Request to safe guard the Pull Request CLA Signatures')
  try {
    await octokit.rest.issues.lock({ owner: context.repo.owner, repo: context.repo.repo, issue_number: pullRequestNo })
    core.info(`successfully locked the pull request ${pullRequestNo}`)
  } catch (error) {
    core.warning(`Could not lock pull request ${pullRequestNo}: ${(error as Error).message}. The workflow needs the issues: write permission.`)
  }
}
