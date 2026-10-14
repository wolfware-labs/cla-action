import * as core from '@actions/core'
import { context } from '@actions/github'
import { checkAllowList } from './checkAllowList'
import getCommitters from './graphql'
import { Committer, CommitterMap, SignatureFile } from './interfaces'
import { createFile, getFileContent, updateFile } from './persistence/persistence'
import prCommentSetup from './pullrequest/pullRequestComment'
import { reRunLastWorkFlowIfRequired } from './pullRerunRunner'

/** Checks that every author has signed, records new signatures and sets the check result. */
export async function setupClaCheck(): Promise<void> {
  const committers = checkAllowList(await getCommitters())
  const { content, sha } = await readOrCreateSignatureFile()
  const committerMap = groupCommitters(committers, content)

  const fromComments = await prCommentSetup(committerMap, committers)

  if (fromComments?.newSigned.length) {
    try {
      await updateFile(sha, content, fromComments)
    } catch (error) {
      throw new Error(`Could not update the signature file: ${(error as Error).message}`)
    }
  }

  if (fromComments?.allSignedFlag || committerMap.notSigned.length === 0) {
    core.info('All contributors have signed the CLA 📝 ✅ ')
    await reRunLastWorkFlowIfRequired()
  } else {
    core.setFailed(`Committers of Pull Request number ${context.issue.number} have to sign the CLA 📝`)
  }
}

/** Reads the signature file, creating an empty one on the first run. */
async function readOrCreateSignatureFile(): Promise<{ content: SignatureFile; sha: string }> {
  let result
  try {
    result = await getFileContent()
  } catch (error: any) {
    if (Number(error.status) === 404) {
      return createSignatureFile()
    }
    throw new Error(`Could not retrieve repository contents. Status: ${error.status || 'unknown'}`)
  }
  const data = result.data as { sha: string; content: string }
  return { content: JSON.parse(Buffer.from(data.content, 'base64').toString()), sha: data.sha }
}

async function createSignatureFile(): Promise<{ content: SignatureFile; sha: string }> {
  const content: SignatureFile = { signedContributors: [] }
  try {
    const created = await createFile(Buffer.from(JSON.stringify(content, null, 3)).toString('base64'))
    core.info('Created the signature file')
    return { content, sha: created.data.content?.sha as string }
  } catch (error) {
    throw new Error(
      `Error occurred when creating the signed contributors file: ${(error as Error).message}. Make sure the branch where signatures are stored exists and that no rule blocks direct commits to it.`
    )
  }
}

function groupCommitters(committers: Committer[], content: SignatureFile): CommitterMap {
  const hasSigned = (committer: Committer) => content.signedContributors.some(signature => signature.id === committer.id)
  return {
    signed: committers.filter(hasSigned),
    notSigned: committers.filter(committer => !hasSigned(committer)),
    unknown: committers.filter(committer => !committer.id)
  }
}
