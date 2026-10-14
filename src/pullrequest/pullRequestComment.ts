import { context } from '@actions/github'
import { octokit } from '../octokit'
import { CommentSignatures, Committer, CommitterMap, IssueComment } from '../interfaces'
import { documentKind } from '../shared/getInputs'
import { commentContent } from './pullRequestCommentContent'
import signatureWithPRComment from './signatureComment'

const BOT_LOGIN = 'github-actions[bot]'

/**
 * Posts or updates the bot's comment (written by github-actions[bot] and
 * carrying its footer) and collects signatures from the pull request comments. Returns undefined when the bot had no comment yet.
 */
export default async function prCommentSetup(
  committerMap: CommitterMap,
  committers: Committer[]
): Promise<CommentSignatures | undefined> {
  const signed = committerMap.notSigned.length === 0

  try {
    // Read once: both the bot's comment and the signing comments come from this list.
    const comments = await listComments()
    const marker = `${documentKind()} Assistant Lite bot`
    const botComment = comments.find(comment => comment.user?.login === BOT_LOGIN && comment.body?.includes(marker))
    if (!botComment) {
      if (!signed) {
        await createComment(commentContent(false, committerMap))
      }
      return undefined
    }

    // People who signed by commenting since the signature file was last written.
    const fromComments = signatureWithPRComment(committerMap, committers, comments)
    fromComments.allSignedFlag = allSigned(committerMap, fromComments.onlyCommitters, committers)
    committerMap.signed.push(...fromComments.newSigned.map(({ name, id, pullRequestNo }) => ({ name, id, pullRequestNo })))
    committerMap.notSigned = committerMap.notSigned.filter(
      committer => !fromComments.newSigned.some(signature => signature.id === committer.id)
    )
    await updateComment(botComment.id, commentContent(fromComments.allSignedFlag, committerMap))
    return fromComments
  } catch (error) {
    throw new Error(`Error occurred when creating or editing the comments of the pull request: ${(error as Error).message}`)
  }
}

/** True when every author is in the signature file or signed in a comment. */
function allSigned(committerMap: CommitterMap, signedInComments: Committer[], committers: Committer[]): boolean {
  const ids = new Set([...committerMap.signed, ...signedInComments].map(committer => committer.id))
  return committers.every(committer => ids.has(committer.id))
}

/** Every comment of the pull request, across all pages. */
async function listComments(): Promise<IssueComment[]> {
  try {
    return await octokit.paginate(octokit.rest.issues.listComments, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      per_page: 100
    })
  } catch (error) {
    throw new Error(`Error occurred when getting the comments of the pull request: ${(error as Error).message}`)
  }
}

async function createComment(body: string): Promise<void> {
  await octokit.rest.issues
    .createComment({ owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number, body })
    .catch(error => {
      throw new Error(`Error occurred when creating a pull request comment: ${error.message}`)
    })
}

async function updateComment(commentId: number, body: string): Promise<void> {
  await octokit.rest.issues
    .updateComment({ owner: context.repo.owner, repo: context.repo.repo, comment_id: commentId, body })
    .catch(error => {
      throw new Error(`Error occurred when updating the pull request comment: ${error.message}`)
    })
}
