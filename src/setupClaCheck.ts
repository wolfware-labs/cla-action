import * as core from '@actions/core'
import { context } from '@actions/github'
import { checkAllowList } from './checkAllowList'
import getCommitters from './graphql'
import { Committer, CommitterMap, Signature, SignatureFile } from './interfaces'
import { octokit } from './octokit'
import { createFile, getFileContent, updateFile } from './persistence/persistence'
import prCommentSetup from './pullrequest/pullRequestComment'
import { reRunLastWorkFlowIfRequired } from './pullRerunRunner'
import { escapeHtml } from './shared/escape'
import { documentKind } from './shared/getInputs'

/** Attempts to commit new signatures when another run changes the file in between. */
const WRITE_ATTEMPTS = 3

/** Checks that every author has signed, records new signatures and sets the check result. */
export async function setupClaCheck(): Promise<void> {
  const committers = checkAllowList(await getCommitters())
  const { content, sha } = await readOrCreateSignatureFile()
  let committerMap = groupCommitters(committers, content)

  let fromComments = await prCommentSetup(committerMap, committers)

  if (fromComments?.newSigned.length) {
    const newSigned = fromComments.newSigned
    const latest = await recordSignatures(content, sha, newSigned)
    if (latest) {
      // Another run changed the file meanwhile: check again against what it holds now.
      committerMap = groupCommitters(committers, latest)
      fromComments = await prCommentSetup(committerMap, committers)
    }
    await confirmSignatures(newSigned)
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
 * read (409 or 422), reads it again and commits the signatures still missing,
 * and returns the file as it now stands; otherwise returns undefined.
 */
async function recordSignatures(content: SignatureFile, sha: string, newSigned: Signature[]): Promise<SignatureFile | undefined> {
  let missing = newSigned
  for (let attempt = 1; ; attempt++) {
    try {
      // updateFile appends the signatures to content.
      await updateFile(sha, content, { newSigned: missing, onlyCommitters: [], allSignedFlag: false })
      return attempt === 1 ? undefined : content
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
        return content
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
  // Names of unlinked authors come from commit metadata, and summary cells are HTML.
  const rows = [
    ...committerMap.signed.map(committer => [escapeHtml(committer.name), 'signed']),
    ...committerMap.notSigned.map(committer => [
      escapeHtml(committer.name),
      committer.id ? 'not signed' : 'not signed, commit email not linked to an account'
    ])
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
  return (await readSignatureFile()) ?? createSignatureFile()
}

/** The signature file and its sha, or undefined when it does not exist yet. */
async function readSignatureFile(): Promise<{ content: SignatureFile; sha: string } | undefined> {
  let data: { sha: string; content: string }
  try {
    data = (await getFileContent()).data as { sha: string; content: string }
  } catch (error: any) {
    if (Number(error.status) === 404) {
      return undefined
    }
    throw new Error(`Could not retrieve repository contents. Status: ${error.status || 'unknown'}`)
  }
  try {
    return { content: JSON.parse(Buffer.from(data.content, 'base64').toString()), sha: data.sha }
  } catch (error) {
    throw new Error(`The signature file is not valid JSON: ${(error as Error).message}`)
  }
}

async function createSignatureFile(): Promise<{ content: SignatureFile; sha: string }> {
  const content: SignatureFile = { signedContributors: [] }
  try {
    const created = await createFile(Buffer.from(JSON.stringify(content, null, 3)).toString('base64'))
    core.info('Created the signature file')
    return { content, sha: created.data.content?.sha as string }
  } catch (error: any) {
    // 409 or 422 can mean another run created the file first; only a file that is now there proves it.
    if ([409, 422].includes(Number(error.status))) {
      const existing = await readSignatureFile()
      if (existing) {
        core.info('Another run created the signature file first; using it')
        return existing
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
