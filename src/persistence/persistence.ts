import { context } from '@actions/github'
import { CommentSignatures, SignatureFile } from '../interfaces'
import { getDefaultOctokitClient, getPATOctokit } from '../octokit'
import * as input from '../shared/getInputs'

/** Where the signature file lives: this repository, or the configured remote one. */
function location() {
  const remote = input.getRemoteRepoName() !== '' || input.getRemoteOrgName() !== ''
  return {
    client: remote ? getPATOctokit() : getDefaultOctokitClient(),
    owner: input.getRemoteOrgName() || context.repo.owner,
    repo: input.getRemoteRepoName() || context.repo.repo,
    path: input.getPathToSignatures(),
    branch: input.getBranch()
  }
}

export async function getFileContent() {
  const { client, owner, repo, path, branch } = location()
  return client.rest.repos.getContent({ owner, repo, path, ref: branch })
}

export async function createFile(contentBinary: string) {
  const { client, owner, repo, path, branch } = location()
  return client.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: input.getCreateFileCommitMessage() || 'Creating file for storing CLA Signatures',
    content: contentBinary,
    branch
  })
}

/** Appends the new signatures and commits the file against its current sha. */
export async function updateFile(sha: string, claFileContent: SignatureFile, fromComments: CommentSignatures): Promise<void> {
  const { client, owner, repo, path, branch } = location()
  const pullRequestNo = context.issue.number
  const { owner: prOwner, repo: prRepo } = context.issue

  claFileContent.signedContributors.push(...fromComments.newSigned)
  const message = input.getSignedCommitMessage()
    ? input
        .getSignedCommitMessage()
        .replace('$contributorName', context.actor)
        .replace('$pullRequestNo', pullRequestNo.toString())
        .replace('$owner', prOwner)
        .replace('$repo', prRepo)
    : `@${context.actor} has signed the CLA in ${prOwner}/${prRepo}#${pullRequestNo}`

  await client.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    sha,
    message,
    content: Buffer.from(JSON.stringify(claFileContent, null, 2)).toString('base64'),
    branch
  })
}
