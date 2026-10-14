import { beforeEach, describe, expect, it, vi } from 'vitest'
import { octokit, octokitModule, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { createFile, getFileContent, updateFile } = await import('../src/persistence/persistence')

const decode = (b64: string) => Buffer.from(b64, 'base64').toString()

describe('persistence', () => {
  beforeEach(() => reset({ 'path-to-signatures': 'signatures/cla.json', branch: 'cla-signatures' }))

  it('reads the signature file from the configured branch of this repository', async () => {
    octokit.rest.repos.getContent.mockResolvedValue({ data: 'x' })
    expect(await getFileContent()).toEqual({ data: 'x' })
    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      path: 'signatures/cla.json',
      ref: 'cla-signatures'
    })
    expect(octokitModule.getPATOctokit).not.toHaveBeenCalled()
  })

  it('uses the personal access token client for a remote repository', async () => {
    reset({ 'path-to-signatures': 's.json', branch: 'main', 'remote-organization-name': 'legal', 'remote-repository-name': 'clas' })
    octokit.rest.repos.getContent.mockResolvedValue({ data: 'x' })
    await getFileContent()
    expect(octokitModule.getPATOctokit).toHaveBeenCalled()
    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({ owner: 'legal', repo: 'clas', path: 's.json', ref: 'main' })
  })

  it('creates the file with the default or a custom commit message', async () => {
    await createFile('Y29udGVudA==')
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenLastCalledWith({
      owner: 'acme',
      repo: 'widgets',
      path: 'signatures/cla.json',
      message: 'Creating file for storing CLA Signatures',
      content: 'Y29udGVudA==',
      branch: 'cla-signatures'
    })
    reset({ 'create-file-commit-message': 'Start CLA file' })
    await createFile('eA==')
    expect(octokit.rest.repos.createOrUpdateFileContents.mock.calls.at(-1)?.[0].message).toBe('Start CLA file')
  })

  it('appends new signers and commits against the file sha', async () => {
    const file = { signedContributors: [{ name: 'bob', id: 2 }] } as any
    await updateFile('abc', file, { newSigned: [{ name: 'alice', id: 1 }] as any, onlyCommitters: [], allSignedFlag: true })
    const call = octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0]
    expect(call).toMatchObject({ owner: 'acme', repo: 'widgets', path: 'signatures/cla.json', sha: 'abc', branch: 'cla-signatures' })
    expect(call.message).toBe('@alice has signed the CLA in acme/widgets#7')
    expect(JSON.parse(decode(call.content))).toEqual({ signedContributors: [{ name: 'bob', id: 2 }, { name: 'alice', id: 1 }] })
    expect(decode(call.content)).toContain('\n  "signedContributors"')
  })

  it('fills every placeholder of a custom signed commit message', async () => {
    reset({ 'signed-commit-message': '$contributorName signed in $owner/$repo#$pullRequestNo' })
    await updateFile('abc', { signedContributors: [] }, { newSigned: [], onlyCommitters: [], allSignedFlag: false })
    expect(octokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0].message).toBe('alice signed in acme/widgets#7')
  })
})
