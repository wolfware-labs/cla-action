import { beforeEach, describe, expect, it, vi } from 'vitest'
import { committer, prComment, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { default: signatureWithPRComment } = await import('../src/pullrequest/signatureComment')

const CLA = 'I have read the CLA Document and I hereby sign the CLA'
const alice = committer('alice', 1)
const bob = committer('bob', 2)

let list: any[] = []

function comments(...items: unknown[]) {
  list = items
}

async function signers(notSigned = [alice, bob], committers = [alice, bob]) {
  const map = { signed: [], notSigned, unknown: [] }
  return signatureWithPRComment(map, committers, list)
}

describe('signatureWithPRComment', () => {
  beforeEach(() => {
    reset()
    list = []
  })

  it('records a committer who posted the default sentence', async () => {
    comments(prComment('alice', 1, CLA))
    const result = await signers()
    expect(result.newSigned).toEqual([
      { name: 'alice', id: 1, comment_id: 10, created_at: '2026-10-13T00:00:00Z', repoId: 99, pullRequestNo: 7 }
    ])
    expect(result.onlyCommitters).toEqual([alice])
    expect(result.allSignedFlag).toBe(false)
  })

  it('accepts the default sentence in any case and with extra text around it', async () => {
    comments(prComment('alice', 1, `Sure. ${CLA.toUpperCase()}  thanks`), prComment('bob', 2, 'i  have read the cla document and i hereby sign the cla'))
    expect((await signers()).newSigned.map(s => s.name)).toEqual(['alice', 'bob'])
  })

  it('requires the exact custom sentence, ignoring case and outer spaces', async () => {
    reset({ 'custom-pr-sign-comment': 'I agree' })
    comments(prComment('alice', 1, '  i AGREE '), prComment('bob', 2, 'I agree, thanks'))
    expect((await signers()).newSigned.map(s => s.name)).toEqual(['alice'])
  })

  it('uses the DCO sentence when use-dco-flag is true', async () => {
    reset({ 'use-dco-flag': 'true' })
    comments(prComment('alice', 1, 'I have read the DCO Document and I hereby sign the DCO'), prComment('bob', 2, CLA))
    expect((await signers()).newSigned.map(s => s.name)).toEqual(['alice'])
  })

  it('ignores comments by github-actions[bot], deleted accounts and missing or null bodies', async () => {
    comments(
      prComment('github-actions[bot]', 41898282, CLA),
      { id: 5, body: CLA, created_at: 'x', user: null },
      { id: 6, created_at: 'x', user: { login: 'bob', id: 2 } },
      { id: 7, body: null, created_at: 'x', user: { login: 'bob', id: 2 } }
    )
    expect((await signers([alice, bob, committer('github-actions[bot]', 41898282)])).newSigned).toEqual([])
  })

  it('records someone who signed twice once, with the earliest comment', async () => {
    comments(
      { ...prComment('alice', 1, CLA), id: 11, created_at: '2026-10-13T02:00:00Z' },
      { ...prComment('alice', 1, CLA), id: 10, created_at: '2026-10-13T01:00:00Z' }
    )
    const result = await signers()
    expect(result.newSigned.map(s => [s.name, s.comment_id])).toEqual([['alice', 10]])
    expect(result.onlyCommitters).toEqual([alice])
  })

  it('counts only people who still need to sign as new signers', async () => {
    comments(prComment('alice', 1, CLA), prComment('carol', 3, CLA))
    const result = await signers([bob], [alice, bob])
    expect(result.newSigned).toEqual([])
    expect(result.onlyCommitters).toEqual([alice])
  })
})
