import * as core from '@actions/core'
import { getOctokit } from '@actions/github'

const githubToken = process.env.GITHUB_TOKEN as string
const personalAccessToken = process.env.PERSONAL_ACCESS_TOKEN

/** The client for the repository the workflow runs in. */
export const octokit = getOctokit(githubToken)

export function getDefaultOctokitClient() {
  return getOctokit(githubToken)
}

/** The client for a remote signature repository, which needs PERSONAL_ACCESS_TOKEN. */
export function getPATOctokit() {
  if (!isPersonalAccessTokenPresent()) {
    core.setFailed(
      'Please add a personal access token as an environment variable for writing signatures in a remote repository/organization as mentioned in the README.md file'
    )
  }
  return getOctokit(personalAccessToken as string)
}

export function isPersonalAccessTokenPresent(): boolean {
  return personalAccessToken !== undefined && personalAccessToken !== ''
}
