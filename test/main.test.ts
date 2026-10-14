import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { context, core, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/setupClaCheck', () => ({ setupClaCheck: vi.fn() }))
vi.mock('../src/pullrequest/pullRequestLock', () => ({ lockPullRequest: vi.fn() }))

const { setupClaCheck } = await import('../src/setupClaCheck')
const { lockPullRequest } = await import('../src/pullrequest/pullRequestLock')
let run: () => Promise<void>

describe('run', () => {
  beforeAll(async () => {
    reset()
    // Importing main runs the action once.
    ;({ run } = await import('../src/main'))
  })

  beforeEach(() => reset())

  it('checks signatures on pull request and comment events', async () => {
    await run()
    expect(setupClaCheck).toHaveBeenCalled()
    expect(lockPullRequest).not.toHaveBeenCalled()
  })

  it('locks the pull request on close', async () => {
    context.payload.action = 'closed'
    context.payload.pull_request = { merged: true }
    await run()
    expect(lockPullRequest).toHaveBeenCalled()
    expect(setupClaCheck).not.toHaveBeenCalled()
  })

  it('locks a closed pull request even when it was not merged (current behaviour)', async () => {
    context.payload.action = 'closed'
    context.payload.pull_request = { merged: false }
    await run()
    expect(lockPullRequest).toHaveBeenCalled()
  })

  it('checks signatures on close when locking is turned off', async () => {
    reset({ 'lock-pullrequest-aftermerge': 'false' })
    context.payload.action = 'closed'
    await run()
    expect(setupClaCheck).toHaveBeenCalled()
    expect(lockPullRequest).not.toHaveBeenCalled()
  })

  it('fails the run with the error message', async () => {
    vi.mocked(setupClaCheck).mockRejectedValueOnce(new Error('boom'))
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('boom')
  })
})
