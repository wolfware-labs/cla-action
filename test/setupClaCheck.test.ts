import { beforeEach, describe, expect, it, vi } from 'vitest'
import { core, httpError, octokit, prComment, reset, signatureFile, summary } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)
vi.mock('../src/pullRerunRunner', () => ({ reRunLastWorkFlowIfRequired: vi.fn() }))

const { setupClaCheck } = await import('../src/setupClaCheck')
const { reRunLastWorkFlowIfRequired } = await import('../src/pullRerunRunner')

const CLA = 'I have read the CLA Document and I hereby sign the CLA'
const botComment = { id: 500, body: 'Posted by the **CLA Assistant Lite bot**.', user: { login: 'github-actions[bot]', id: 41898282 } }

function authors(...list: [string, number][]) {
  octokit.graphql.mockResolvedValue({
    repository: {
      pullRequest: {
        commits: {
          edges: list.map(([login, id]) => ({
            node: { commit: { author: { name: login, user: { login, databaseId: id } }, committer: { user: null } } }
          })),
          pageInfo: { hasNextPage: false }
        }
      }
    }
  })
}

describe('setupClaCheck', () => {
  beforeEach(() => reset({ 'path-to-document': 'https://example.com/CLA.md', branch: 'cla-signatures' }))

  it('passes and re-runs the failed check when every author has signed', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    await setupClaCheck()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(reRunLastWorkFlowIfRequired).toHaveBeenCalled()
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  it('ignores allowlisted authors', async () => {
    reset({ allowlist: 'bot*', branch: 'cla-signatures' })
    authors(['bot-builder', 5])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    await setupClaCheck()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('asks for signatures and fails when someone has not signed', async () => {
    authors(['alice', 1], ['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    await setupClaCheck()
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith('Committers of Pull Request number 7 have to sign the CLA 📝')
    expect(octokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled()
  })

  it('names the DCO in the result when use-dco-flag is true', async () => {
    reset({ 'use-dco-flag': 'true' })
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    await setupClaCheck()
    expect(core.setFailed).toHaveBeenCalledWith('Committers of Pull Request number 7 have to sign the DCO 📝')

    reset({ 'use-dco-flag': 'true' })
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    await setupClaCheck()
    expect(core.info).toHaveBeenCalledWith('All contributors have signed the DCO 📝 ✅ ')
  })

  it('records a signature from a comment and passes', async () => {
    authors(['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([], 'sha-1'))
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    await setupClaCheck()
    const write = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0]
    expect(write.sha).toBe('sha-1')
    expect(JSON.parse(Buffer.from(write.content, 'base64').toString()).signedContributors.map((s: { name: string }) => s.name)).toEqual(['bob'])
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(reRunLastWorkFlowIfRequired).toHaveBeenCalled()
  })

  it('confirms each recorded signature with a reaction', async () => {
    authors(['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    await setupClaCheck()
    expect(octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', comment_id: 20, content: '+1' })
  })

  it('warns instead of failing when the reaction cannot be added', async () => {
    authors(['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    octokit.rest.reactions.createForIssueComment.mockRejectedValue(new Error('403'))
    await setupClaCheck()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Could not react to the signature of bob'))
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  describe('when another run changes the signature file first', () => {
    beforeEach(() => {
      authors(['bob', 2])
      octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    })

    it('reads the file again and writes against the new sha', async () => {
      octokit.rest.repos.getContent
        .mockResolvedValueOnce(signatureFile([], 'sha-1'))
        .mockResolvedValueOnce(signatureFile([{ name: 'carol', id: 3 }], 'sha-2'))
      octokit.rest.repos.createOrUpdateFileContents.mockRejectedValueOnce(httpError(409)).mockResolvedValueOnce({ data: {} })
      await setupClaCheck()
      const second = octokit.rest.repos.createOrUpdateFileContents.mock.calls[1][0]
      expect(second.sha).toBe('sha-2')
      const names = JSON.parse(Buffer.from(second.content, 'base64').toString()).signedContributors.map((s: { name: string }) => s.name)
      expect(names).toEqual(['carol', 'bob'])
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('stops when the other run already stored the signature', async () => {
      octokit.rest.repos.getContent
        .mockResolvedValueOnce(signatureFile([], 'sha-1'))
        .mockResolvedValueOnce(signatureFile([{ name: 'bob', id: 2 }], 'sha-2'))
      octokit.rest.repos.createOrUpdateFileContents.mockRejectedValueOnce(httpError(422))
      await setupClaCheck()
      expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1)
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('reports from the file as it stands after the retry', async () => {
      // This run records bob while another run records alice, the other author.
      authors(['alice', 1], ['bob', 2])
      octokit.rest.repos.getContent
        .mockResolvedValueOnce(signatureFile([], 'sha-1'))
        .mockResolvedValueOnce(signatureFile([{ name: 'alice', id: 1 }], 'sha-2'))
      octokit.rest.repos.createOrUpdateFileContents.mockRejectedValueOnce(httpError(409)).mockResolvedValueOnce({ data: {} })
      await setupClaCheck()
      expect(core.setOutput).toHaveBeenCalledWith('all-signed', 'true')
      expect(core.setOutput).toHaveBeenCalledWith('missing', '')
      expect(core.setFailed).not.toHaveBeenCalled()
      expect(octokit.rest.issues.updateComment.mock.calls.at(-1)?.[0].body).toContain('All contributors have signed the CLA')
    })

    it('records a signature posted between the conflict and the rescan', async () => {
      authors(['alice', 1], ['bob', 2])
      octokit.rest.issues.listComments
        .mockResolvedValueOnce({ data: [botComment, prComment('bob', 2, CLA)] })
        .mockResolvedValueOnce({ data: [botComment, prComment('bob', 2, CLA), prComment('alice', 1, CLA)] })
      octokit.rest.repos.getContent
        .mockResolvedValueOnce(signatureFile([], 'sha-1'))
        .mockResolvedValueOnce(signatureFile([{ name: 'carol', id: 3 }], 'sha-2'))
      octokit.rest.repos.createOrUpdateFileContents.mockRejectedValueOnce(httpError(409)).mockResolvedValueOnce({ data: {} })
      await setupClaCheck()
      const second = octokit.rest.repos.createOrUpdateFileContents.mock.calls[1][0]
      expect(second.sha).toBe('sha-2')
      const names = JSON.parse(Buffer.from(second.content, 'base64').toString()).signedContributors.map((s: { name: string }) => s.name)
      expect(names).toEqual(['carol', 'alice', 'bob'])
      expect(octokit.rest.reactions.createForIssueComment.mock.calls.map(call => call[0].comment_id)).toEqual([10, 20])
      expect(core.setOutput).toHaveBeenCalledWith('all-signed', 'true')
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('gives up after three conflicts', async () => {
      octokit.rest.repos.getContent.mockResolvedValue(signatureFile([], 'sha-1'))
      octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(httpError(409, 'conflict'))
      await expect(setupClaCheck()).rejects.toThrow('Could not update the signature file: conflict')
      expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(3)
    })
  })

  it('sets outputs and writes a job summary', async () => {
    // Dan's commit email is not linked to an account, so he has no id.
    authors(['alice', 1], ['bob', 2], ['Dan', 0])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    await setupClaCheck()
    expect(core.setOutput).toHaveBeenCalledWith('all-signed', 'false')
    expect(core.setOutput).toHaveBeenCalledWith('missing', 'bob,Dan')
    expect(core.setOutput).toHaveBeenCalledWith('unlinked', 'Dan')
    expect(summary.addRaw).toHaveBeenCalledWith('2 of 3 contributors still have to sign the CLA.', true)
    const rows = summary.addTable.mock.calls[0][0]
    expect(rows.slice(1)).toEqual([['alice', 'signed'], ['bob', 'not signed'], ['Dan', 'not signed, commit email not linked to an account']])
    expect(summary.write).toHaveBeenCalled()
  })

  it('escapes names in the job summary but not in the outputs', async () => {
    authors(['<img src=x onerror=alert(1)>', 0])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    await setupClaCheck()
    expect(core.setOutput).toHaveBeenCalledWith('missing', '<img src=x onerror=alert(1)>')
    expect(summary.addTable.mock.calls[0][0][1][0]).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('reports all signed in the outputs', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    await setupClaCheck()
    expect(core.setOutput).toHaveBeenCalledWith('all-signed', 'true')
    expect(core.setOutput).toHaveBeenCalledWith('missing', '')
  })

  it('carries on when the job summary cannot be written', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    summary.write.mockRejectedValue(new Error('no summary file'))
    await setupClaCheck()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('reports a failed signature write', async () => {
    authors(['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(new Error('409 conflict'))
    await expect(setupClaCheck()).rejects.toThrow('Could not update the signature file: 409 conflict')
  })

  it('creates the signature file on the first run and checks as usual', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404))
    await setupClaCheck()
    const create = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0]
    expect(JSON.parse(Buffer.from(create.content, 'base64').toString())).toEqual({ signedContributors: [] })
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith('Committers of Pull Request number 7 have to sign the CLA 📝')
  })

  it('uses the file another run created first', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValueOnce(httpError(404)).mockResolvedValue(signatureFile([{ name: 'alice', id: 1 }]))
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(httpError(422))
    await setupClaCheck()
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1)
    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2)
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('stops when the file another run created cannot be read', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValueOnce(httpError(404)).mockRejectedValue(httpError(500))
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(httpError(409))
    await expect(setupClaCheck()).rejects.toThrow('Could not retrieve repository contents. Status: 500')
  })

  it('passes the first run when every author is allowlisted', async () => {
    reset({ allowlist: 'alice', branch: 'cla-signatures' })
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404))
    await setupClaCheck()
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('explains what to check when the first file cannot be created', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404))
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(new Error('403'))
    await expect(setupClaCheck()).rejects.toThrow('Make sure the branch where signatures are stored exists and that no rule blocks direct commits to it.')
  })

  it('stops on any other error reading the file', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(500))
    await expect(setupClaCheck()).rejects.toThrow('Could not retrieve repository contents. Status: 500')
  })

  it('reports a signature file that is not valid JSON', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockResolvedValue({ data: { sha: 's', content: Buffer.from('{oops').toString('base64') } })
    await expect(setupClaCheck()).rejects.toThrow('The signature file is not valid JSON:')
  })

  it('keeps the create error when a 422 is not a race', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404))
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(httpError(422))
    await expect(setupClaCheck()).rejects.toThrow('Make sure the branch where signatures are stored exists')
    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2)
  })
})
