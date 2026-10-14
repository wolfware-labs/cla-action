import { beforeEach, describe, expect, it, vi } from 'vitest'
import { committer, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)

const { commentContent } = await import('../src/pullrequest/pullRequestCommentContent')

const map = (signed: any[], notSigned: any[], unknown: any[] = []) => ({ signed, notSigned, unknown })

describe('commentContent', () => {
  beforeEach(() => reset({ 'path-to-document': 'https://example.com/CLA.md' }))

  it('says everyone signed', () => {
    expect(commentContent(true, map([], []))).toBe(
      'All contributors have signed the CLA  ✍️ ✅<br/><sub>Posted by the **CLA Assistant Lite bot**.</sub>'
    )
  })

  it('uses the custom all-signed text', () => {
    reset({ 'custom-allsigned-prcomment': 'Thanks!' })
    expect(commentContent(true, map([], []))).toMatch(/^Thanks!<br\/>/)
  })

  it('asks a single author to sign, with the document, the sentence and the recheck hint', () => {
    const text = commentContent(false, map([], [committer('alice', 1)]))
    expect(text).toContain('we ask that you sign our [Contributor License Agreement](https://example.com/CLA.md)')
    expect(text).toContain('I have read the CLA Document and I hereby sign the CLA')
    expect(text).toContain('You can retrigger this bot by commenting **recheck**')
    expect(text).toMatch(/<sub>Posted by the \*\*CLA Assistant Lite bot\*\*\.<\/sub>$/)
    expect(text).not.toContain('committers have signed')
  })

  it('lists who has and has not signed when there are several authors', () => {
    const text = commentContent(false, map([committer('bob', 2)], [committer('carol', 3)]))
    expect(text).toContain('we ask that you all sign')
    expect(text).toContain('**1** out of **2** committers have signed the CLA.')
    expect(text).toContain('<br/>:white_check_mark: [bob](https://github.com/bob)')
    expect(text).toContain('<br/>:x: @carol')
  })

  it('names authors who are not linked to a GitHub account', () => {
    const one = commentContent(false, map([], [committer('Dan', 0)], [committer('Dan', 0)]))
    expect(one).toContain('**Dan** seems not to be a GitHub user.')
    expect(one).toContain('(https://docs.github.com/')
    const two = commentContent(false, map([], [], [committer('Dan', 0), committer('Eve', 0)]))
    expect(two).toContain('**Dan, Eve** seem not to be a GitHub user.')
  })

  it('leaves out the recheck hint when suggest-recheck is false', () => {
    reset({ 'suggest-recheck': 'false' })
    expect(commentContent(false, map([], [committer('alice', 1)]))).not.toContain('recheck')
  })

  it('replaces $you in a custom request text and shows the custom sentence', () => {
    reset({ 'custom-notsigned-prcomment': 'Please, $you, sign.', 'custom-pr-sign-comment': 'I agree' })
    const text = commentContent(false, map([committer('bob', 2)], [committer('carol', 3)]))
    expect(text).toMatch(/^Please, you all, sign\./)
    expect(text).toContain('I agree')
  })

  it('writes DCO texts when use-dco-flag is true', () => {
    reset({ 'use-dco-flag': 'true', 'path-to-document': 'https://example.com/DCO.md' })
    expect(commentContent(true, map([], []))).toContain('All contributors have signed the DCO')
    const text = commentContent(false, map([], [committer('alice', 1)]))
    expect(text).toContain('[Developer Certificate of Origin](https://example.com/DCO.md)')
    expect(text).toContain('I have read the DCO Document and I hereby sign the DCO')
    expect(text).toContain('<sub>Posted by the **DCO Assistant Lite bot**.</sub>')
  })
})
