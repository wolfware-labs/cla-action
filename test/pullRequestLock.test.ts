import { beforeEach, describe, expect, it, vi } from 'vitest'
import { core, octokit, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { lockPullRequest } = await import('../src/pullrequest/pullRequestLock')

describe('lockPullRequest', () => {
  beforeEach(() => reset())

  it('locks the pull request conversation', async () => {
    await lockPullRequest()
    expect(octokit.rest.issues.lock).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', issue_number: 7 })
    expect(core.info).toHaveBeenCalledWith('successfully locked the pull request 7')
  })

  it('names the document kind in its log', async () => {
    await lockPullRequest()
    expect(core.info).toHaveBeenCalledWith('Locking the Pull Request to safe guard the Pull Request CLA Signatures')
    reset({ 'use-dco-flag': 'true' })
    await lockPullRequest()
    expect(core.info).toHaveBeenCalledWith('Locking the Pull Request to safe guard the Pull Request DCO Signatures')
  })

  it('warns about a failed lock without failing the run', async () => {
    octokit.rest.issues.lock.mockRejectedValue(new Error('403'))
    await expect(lockPullRequest()).resolves.toBeUndefined()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('issues: write'))
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
