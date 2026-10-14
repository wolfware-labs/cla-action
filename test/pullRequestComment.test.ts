import { beforeEach, describe, expect, it, vi } from 'vitest'
import { committer, octokit, prComment, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { default: prCommentSetup } = await import('../src/pullrequest/pullRequestComment')

const CLA = 'I have read the CLA Document and I hereby sign the CLA'
const alice = committer('alice', 1)
const bob = committer('bob', 2)
const botComment = { id: 500, body: 'Please sign <sub>Posted by the **CLA Assistant Lite bot**.</sub>', user: { login: 'github-actions[bot]', id: 41898282 } }

describe('prCommentSetup', () => {
  beforeEach(() => reset({ 'path-to-document': 'https://example.com/CLA.md' }))

  it('posts a request when someone has not signed and there is no bot comment yet', async () => {
    const result = await prCommentSetup({ signed: [], notSigned: [alice], unknown: [] }, [alice])
    expect(result).toBeUndefined()
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      issue_number: 7,
      body: expect.stringContaining('we ask that you sign')
    })
  })

  it('posts nothing when everyone has signed and there is no bot comment', async () => {
    const result = await prCommentSetup({ signed: [alice], notSigned: [], unknown: [] }, [alice])
    expect(result).toBeUndefined()
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('updates its comment and reports new signers found in the comments', async () => {
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('alice', 1, CLA)] })
    const result = await prCommentSetup({ signed: [], notSigned: [alice], unknown: [] }, [alice])
    expect(result?.newSigned.map(s => s.name)).toEqual(['alice'])
    expect(result?.allSignedFlag).toBe(true)
    expect(octokit.rest.issues.updateComment).toHaveBeenLastCalledWith({
      owner: 'acme',
      repo: 'widgets',
      comment_id: 500,
      body: expect.stringContaining('All contributors have signed the CLA')
    })
  })

  it('keeps asking when only some authors have signed', async () => {
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('alice', 1, CLA)] })
    const result = await prCommentSetup({ signed: [], notSigned: [alice, bob], unknown: [] }, [alice, bob])
    expect(result?.allSignedFlag).toBe(false)
    const body = octokit.rest.issues.updateComment.mock.calls.at(-1)?.[0].body
    expect(body).toContain('**1** out of **2** committers have signed the CLA.')
  })

  it('reads every page of comments once, and finds its comment and a signature on the second page', async () => {
    const chatter = Array.from({ length: 100 }, (_, i) => prComment(`user${i}`, 1000 + i, 'looks good'))
    octokit.rest.issues.listComments
      .mockResolvedValueOnce({ data: chatter })
      .mockResolvedValueOnce({ data: [botComment, prComment('alice', 1, CLA)] })
    const result = await prCommentSetup({ signed: [], notSigned: [alice], unknown: [] }, [alice])
    expect(octokit.paginate).toHaveBeenCalledTimes(1)
    expect(octokit.rest.issues.listComments.mock.calls.map(call => call[0])).toEqual([
      { owner: 'acme', repo: 'widgets', issue_number: 7, per_page: 100, page: 1 },
      { owner: 'acme', repo: 'widgets', issue_number: 7, per_page: 100, page: 2 }
    ])
    expect(result?.newSigned.map(s => s.name)).toEqual(['alice'])
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment.mock.calls[0][0].comment_id).toBe(500)
  })

  it('does not treat a comment by someone else as its own', async () => {
    const lookalike = { ...botComment, id: 900, user: { login: 'mallory', id: 66 } }
    octokit.rest.issues.listComments.mockResolvedValue({ data: [lookalike] })
    await prCommentSetup({ signed: [], notSigned: [alice], unknown: [] }, [alice])
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
  })

  it('finds its DCO comment in DCO mode', async () => {
    reset({ 'use-dco-flag': 'true' })
    const dcoComment = { ...botComment, body: '<sub>Posted by the **DCO Assistant Lite bot**.</sub>' }
    octokit.rest.issues.listComments.mockResolvedValue({ data: [dcoComment] })
    await prCommentSetup({ signed: [], notSigned: [alice], unknown: [] }, [alice])
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment).toHaveBeenCalled()
  })

  it('wraps API errors', async () => {
    octokit.rest.issues.listComments.mockRejectedValue(new Error('boom'))
    await expect(prCommentSetup({ signed: [], notSigned: [alice], unknown: [] }, [alice])).rejects.toThrow(
      'Error occurred when creating or editing the comments of the pull request: Error occurred when getting the comments of the pull request: boom'
    )
  })
})
