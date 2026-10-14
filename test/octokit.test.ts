import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module reads the tokens when it loads, so each test loads it again with
// its own environment. The fakes live here instead of in the shared harness,
// because vi.resetModules would load a second copy of the harness.
const setFailed = vi.fn()
const getOctokit = vi.fn((token: string) => ({ token }))

vi.mock('@actions/core', () => ({ setFailed }))
vi.mock('@actions/github', () => ({ getOctokit }))

async function load(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string)
  return import('../src/octokit')
}

describe('octokit clients', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('builds the default client from GITHUB_TOKEN', async () => {
    const module = await load({ GITHUB_TOKEN: 'gh-token', PERSONAL_ACCESS_TOKEN: undefined })
    expect(module.getDefaultOctokitClient()).toEqual({ token: 'gh-token' })
    expect(module.octokit).toEqual({ token: 'gh-token' })
  })

  it('builds the remote client from PERSONAL_ACCESS_TOKEN', async () => {
    const module = await load({ GITHUB_TOKEN: 'gh-token', PERSONAL_ACCESS_TOKEN: 'pat' })
    expect(module.isPersonalAccessTokenPresent()).toBe(true)
    expect(module.getPATOctokit()).toEqual({ token: 'pat' })
    expect(setFailed).not.toHaveBeenCalled()
  })

  it('fails the run when the remote client is needed without a token', async () => {
    const module = await load({ GITHUB_TOKEN: 'gh-token', PERSONAL_ACCESS_TOKEN: '' })
    expect(module.isPersonalAccessTokenPresent()).toBe(false)
    module.getPATOctokit()
    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('Please add a personal access token'))
  })
})
