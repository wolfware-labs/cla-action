import * as core from '@actions/core'
import { context } from '@actions/github'
import { checkAllowList } from './checkAllowList'
import getCommitters from './graphql'
import { Committer, CommitterMap, Signature, SignatureFile } from './interfaces'
import { octokit } from './octokit'
import { createFile, getFileContent, updateFile } from './persistence/persistence'
import prCommentSetup from './pullrequest/pullRequestComment'
import { reRunLastWorkFlowIfRequired } from './pullRerunRunner'
import { documentKind } from './shared/getInputs'

/** Attempts to commit new signatures when another run changes the file in between. */
const WRITE_ATTEMPTS = 3

/** Checks that every author has signed, records new signatures and sets the check result. */
export async function setupClaCheck(): Promise<void> {
  const committers = checkAllowList(await getCommitters())
  const { content, sha } = await readOrCreateSignatureFile()
  const committerMap = groupCommitters(committers, content)

  const fromComments = await prCommentSetup(committerMap, committers)

  if (fromComments?.newSigned.length) {
    await recordSignatures(content, sha, fromComments.newSigned)
    await confirmSignatures(fromComments.newSigned)
  }

  const allSigned = Boolean(fromComments?.allSignedFlag) || committerMap.notSigned.length === 0
  await report(committerMap, allSigned)
  if (allSigned) {
    core.info(`All contributors have signed the ${documentKind()} 📝 ✅ `)
    await reRunLastWorkFlowIfRequired()
  } else {
    core.setFailed(`Committers of Pull Request number ${context.issue.number} have to sign the ${documentKind()} 📝`)
  }
}

/**
 * Commits new signatures. When another run changed the file since it was
 * read (409 or 422), reads it again and commits the signatures still missing.
 */
async function recordSignatures(content: SignatureFile, sha: string, newSigned: Signature[]): Promise<void> {
  let missing = newSigned
  for (let attempt = 1; ; attempt++) {
    try {
      await updateFile(sha, content, { newSigned: missing, onlyCommitters: [], allSignedFlag: false })
      return
    } catch (error: any) {
      const conflict = [409, 422].includes(Number(error.status))
      if (!conflict || attempt === WRITE_ATTEMPTS) {
        throw new Error(`Could not update the signature file: ${error.message}`)
      }
      core.info(`The signature file changed while it was being updated; reading it again (attempt ${attempt + 1} of ${WRITE_ATTEMPTS})`)
      ;({ content, sha } = await readOrCreateSignatureFile())
      const stored = new Set(content.signedContributors.map(signature => signature.id))
      missing = missing.filter(signature => !stored.has(signature.id))
      if (missing.length === 0) {
        return
      }
    }
  }
}

/** Reacts to each recorded signing comment, so its author can see it counted. */
async function confirmSignatures(signatures: Signature[]): Promise<void> {
  for (const signature of signatures) {
    try {
      await octokit.rest.reactions.createForIssueComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: signature.comment_id,
        content: '+1'
      })
    } catch (error) {
      core.warning(`Could not react to the signature of ${signature.name}: ${(error as Error).message}`)
    }
  }
}

/** Sets the step outputs and writes the job summary. */
async function report(committerMap: CommitterMap, allSigned: boolean): Promise<void> {
  const missing = committerMap.notSigned.map(committer => committer.name)
  const unlinked = committerMap.unknown.map(committer => committer.name)
  core.setOutput('all-signed', String(allSigned))
  core.setOutput('missing', missing.join(','))
  core.setOutput('unlinked', unlinked.join(','))

  const kind = documentKind()
  const rows = [
    ...committerMap.signed.map(committer => [committer.name, 'signed']),
    ...committerMap.notSigned.map(committer => [committer.name, committer.id ? 'not signed' : 'not signed, commit email not linked to an account'])
  ]
  try {
    await core.summary
      .addHeading(`${kind} signatures for pull request #${context.issue.number}`, 3)
      .addRaw(allSigned ? `All contributors have signed the ${kind}.` : `${missing.length} of ${rows.length} contributors still have to sign the ${kind}.`, true)
      .addTable([[{ data: 'Contributor', header: true }, { data: 'Status', header: true }], ...rows])
      .write()
  } catch (error) {
    // Outside GitHub Actions there is no summary file.
    core.debug(`Could not write the job summary: ${(error as Error).message}`)
  }
}

/** Reads the signature file, creating an empty one on the first run. */
async function readOrCreateSignatureFile(): Promise<{ content: SignatureFile; sha: string }> {
  try {
    return await readSignatureFile()
  } catch (error: any) {
    if (Number(error.status) === 404) {
      return createSignatureFile()
    }
    throw new Error(`Could not retrieve repository contents. Status: ${error.status || 'unknown'}`)
  }
}

async function readSignatureFile(): Promise<{ content: SignatureFile; sha: string }> {
  const data = (await getFileContent()).data as { sha: string; content: string }
  return { content: JSON.parse(Buffer.from(data.content, 'base64').toString()), sha: data.sha }
}

async function createSignatureFile(): Promise<{ content: SignatureFile; sha: string }> {
  const content: SignatureFile = { signedContributors: [] }
  try {
    const created = await createFile(Buffer.from(JSON.stringify(content, null, 3)).toString('base64'))
    core.info('Created the signature file')
    return { content, sha: created.data.content?.sha as string }
  } catch (error: any) {
    if ([409, 422].includes(Number(error.status))) {
      // Another run created the file first: use that one.
      core.info('Another run created the signature file first; reading it')
      try {
        return await readSignatureFile()
      } catch (readError: any) {
        throw new Error(`Could not retrieve repository contents. Status: ${readError.status || 'unknown'}`)
      }
    }
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
