import * as core from '@actions/core'

const text = (name: string): string => core.getInput(name, { required: false })

// Action inputs are strings; a flag is on only when it is exactly "true".
const flag = (name: string): boolean => text(name) === 'true'

export const getRemoteRepoName = (): string => text('remote-repository-name')
export const getRemoteOrgName = (): string => text('remote-organization-name')
export const getPathToSignatures = (): string => text('path-to-signatures')
export const getPathToDocument = (): string => text('path-to-document')
export const getBranch = (): string => text('branch')
export const getAllowList = (): string => text('allowlist')
export const getSignedCommitMessage = (): string => text('signed-commit-message')
export const getCreateFileCommitMessage = (): string => text('create-file-commit-message')
export const getCustomNotSignedPrComment = (): string => text('custom-notsigned-prcomment')
export const getCustomAllSignedPrComment = (): string => text('custom-allsigned-prcomment')
export const getCustomPrSignComment = (): string => text('custom-pr-sign-comment')
export const useDco = (): boolean => flag('use-dco-flag')
export const lockPullRequestAfterMerge = (): boolean => flag('lock-pullrequest-aftermerge')
export const suggestRecheck = (): boolean => flag('suggest-recheck')

/** "CLA" or "DCO", for messages. */
export const documentKind = (): 'CLA' | 'DCO' => (useDco() ? 'DCO' : 'CLA')

/** The sentence a contributor comments to sign. */
export const signSentence = (): string =>
  getCustomPrSignComment() ||
  `I have read the ${documentKind()} Document and I hereby sign the ${documentKind()}`
