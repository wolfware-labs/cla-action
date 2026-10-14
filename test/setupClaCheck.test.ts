import { beforeEach, describe, expect, it, vi } from 'vitest'
import { core, httpError, octokit, prComment, reset, signatureFile } from './harness'

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

  it('records a signature from a comment and passes', async () => {
    authors(['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([], 'sha-1'))
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    await setupClaCheck()
    const write = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0]
    expect(write.sha).toBe('sha-1')
    expect(JSON.parse(Buffer.from(write.content, 'base64').toString()).signedContributors.map(s => s.name)).toEqual(['bob'])
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(reRunLastWorkFlowIfRequired).toHaveBeenCalled()
  })

  it('reports a failed signature write', async () => {
    authors(['bob', 2])
    octokit.rest.repos.getContent.mockResolvedValue(signatureFile([]))
    octokit.rest.issues.listComments.mockResolvedValue({ data: [botComment, prComment('bob', 2, CLA)] })
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(new Error('409 conflict'))
    await setupClaCheck()
    expect(core.setFailed).toHaveBeenCalledWith('Could not update the JSON file: 409 conflict')
  })

  it('creates the signature file on the first run, then fails (current behaviour)', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404))
    await expect(setupClaCheck()).rejects.toThrow('Committers of pull request 7 have to sign the CLA')
    const create = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0]
    expect(JSON.parse(Buffer.from(create.content, 'base64').toString())).toEqual({ signedContributors: [] })
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
  })

  it('points at branch protection when the first file cannot be created', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(404))
    octokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(new Error('403'))
    await expect(setupClaCheck()).rejects.toThrow()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Make sure the branch where signatures are stored is NOT protected.'))
  })

  it('stops on any other error reading the file', async () => {
    authors(['alice', 1])
    octokit.rest.repos.getContent.mockRejectedValue(httpError(500))
    await expect(setupClaCheck()).rejects.toThrow('Could not retrieve repository contents. Status: 500')
  })
})
