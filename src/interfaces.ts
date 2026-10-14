/** A commit author on the pull request. `id` is empty when the commit email is not linked to an account. */
export interface Committer {
  name: string
  id: number | ''
  pullRequestNo: number
}

/** A signature as stored in the signature file. */
export interface Signature {
  name: string
  id: number
  comment_id: number
  created_at: string
  repoId: number
  pullRequestNo: number
}

export interface SignatureFile {
  signedContributors: Signature[]
}

/** Authors grouped by whether the signature file already has them. */
export interface CommitterMap {
  signed: Committer[]
  notSigned: Committer[]
  unknown: Committer[]
}

/** What the pull request comments add to the signature file. */
export interface CommentSignatures {
  newSigned: Signature[]
  /** Authors of this pull request who posted the signing sentence. */
  onlyCommitters: Committer[]
  allSignedFlag: boolean
}
