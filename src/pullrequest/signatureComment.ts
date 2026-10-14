import { context } from '@actions/github'
import { CommentSignatures, Committer, CommitterMap, IssueComment, Signature } from '../interfaces'
import { getCustomPrSignComment, useDco } from '../shared/getInputs'

const BOT_LOGIN = 'github-actions[bot]'

// The default sentences tolerate extra spaces and text around them.
const DEFAULT_SENTENCE = {
  CLA: /^.*i \s*have \s*read \s*the \s*cla \s*document \s*and \s*i \s*hereby \s*sign \s*the \s*cla.*$/,
  DCO: /^.*i \s*have \s*read \s*the \s*dco \s*document \s*and \s*i \s*hereby \s*sign \s*the \s*dco.*$/
}

/** Whether a comment body (trimmed and lower-cased) is a signature. */
function isSignature(body: string): boolean {
  const custom = getCustomPrSignComment()
  if (custom !== '') {
    return custom.toLowerCase() === body
  }
  return DEFAULT_SENTENCE[useDco() ? 'DCO' : 'CLA'].test(body)
}

/** Finds the signatures among the comments of the pull request. */
export default function signatureWithPRComment(
  committerMap: CommitterMap,
  committers: Committer[],
  comments: IssueComment[]
): CommentSignatures {
  const signatures: Signature[] = []
  for (const comment of comments) {
    // Comments from deleted accounts have no user; a comment body can be null or empty.
    if (!comment.user || !comment.body || comment.user.login === BOT_LOGIN) {
      continue
    }
    // Someone who signed more than once is recorded once, with their first signing comment.
    const user = comment.user
    if (signatures.some(signature => signature.id === user.id)) {
      continue
    }
    if (isSignature(comment.body.trim().toLowerCase())) {
      signatures.push({
        name: comment.user.login,
        id: comment.user.id,
        comment_id: comment.id,
        created_at: comment.created_at,
        repoId: context.payload.repository!.id,
        pullRequestNo: context.issue.number
      })
    }
  }

  const signedBy = (committer: Committer) => signatures.some(signature => signature.id === committer.id)
  return {
    newSigned: signatures.filter(signature => committerMap.notSigned.some(c => c.id === signature.id)),
    onlyCommitters: committers.filter(signedBy),
    allSignedFlag: false
  }
}
