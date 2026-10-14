// Shared fakes for @actions/core, @actions/github and the Octokit clients.
// Each test file mocks those modules with the objects exported here and calls
// reset() before every test.
import { vi } from 'vitest'

// Defaults from action.yml; core.getInput returns them when an input is unset.
const INPUT_DEFAULTS: Record<string, string> = {
  'path-to-signatures': './signatures/cla.json',
  branch: 'master',
  allowlist: '',
  'use-dco-flag': 'false',
  'lock-pullrequest-aftermerge': 'true',
  'suggest-recheck': 'true'
}

export const inputs: Record<string, string> = {}

export const context: any = {}

export const octokit = {
  graphql: vi.fn(),
  // Like Octokit's paginate: requests page after page until a short one, and returns every page's items.
  paginate: vi.fn(),
  rest: {
    issues: {
      listComments: vi.fn(),
      createComment: vi.fn(),
      updateComment: vi.fn(),
      lock: vi.fn()
    },
    pulls: { get: vi.fn() },
    repos: {
      getContent: vi.fn(),
      createOrUpdateFileContents: vi.fn()
    },
    reactions: { createForIssueComment: vi.fn() },
    actions: {
      listRepoWorkflows: vi.fn(),
      listWorkflowRuns: vi.fn(),
      getWorkflowRun: vi.fn(),
      reRunWorkflow: vi.fn()
    }
  }
}

// A chainable stand-in for core.summary.
export const summary: any = {}
for (const method of ['addHeading', 'addRaw', 'addTable', 'addList']) {
  summary[method] = vi.fn(() => summary)
}
summary.write = vi.fn()

export const core = {
  getInput: vi.fn((name: string) => inputs[name] ?? ''),
  setOutput: vi.fn(),
  summary,
  setFailed: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn()
}

export const github = {
  context,
  getOctokit: vi.fn(() => octokit)
}

export const octokitModule = {
  octokit,
  getDefaultOctokitClient: vi.fn(() => octokit),
  getPATOctokit: vi.fn(() => octokit),
  isPersonalAccessTokenPresent: vi.fn(() => true)
}

/** A commit author as returned by getCommitters. */
export function committer(name: string, id: number) {
  return { name, id, pullRequestNo: 7 }
}

/** A pull request comment as returned by issues.listComments. */
export function prComment(login: string, userId: number, body: string, id = userId * 10) {
  return {
    id,
    body,
    created_at: '2026-10-13T00:00:00Z',
    user: { login, id: userId }
  }
}

/** A getContent response for a signature file. */
export function signatureFile(signedContributors: unknown[], sha = 'file-sha') {
  const content = Buffer.from(JSON.stringify({ signedContributors })).toString('base64')
  return { data: { sha, content } }
}

/** An Octokit-style HTTP error. */
export function httpError(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status })
}

export function reset(overrides: Record<string, string> = {}) {
  // Reset, not just clear: a queued mockResolvedValueOnce must not leak into the next test.
  vi.resetAllMocks()
  for (const key of Object.keys(inputs)) delete inputs[key]
  Object.assign(inputs, INPUT_DEFAULTS, overrides)

  for (const key of Object.keys(context)) delete context[key]
  Object.assign(context, {
    eventName: 'pull_request_target',
    workflow: 'CLA',
    actor: 'alice',
    repo: { owner: 'acme', repo: 'widgets' },
    issue: { owner: 'acme', repo: 'widgets', number: 7 },
    payload: { action: 'opened', repository: { id: 99 } }
  })

  core.getInput.mockImplementation((name: string) => inputs[name] ?? '')
  github.getOctokit.mockImplementation(() => octokit)
  octokitModule.getDefaultOctokitClient.mockImplementation(() => octokit)
  octokitModule.getPATOctokit.mockImplementation(() => octokit)
  octokitModule.isPersonalAccessTokenPresent.mockImplementation(() => true)

  octokit.rest.issues.listComments.mockResolvedValue({ data: [] })
  octokit.paginate.mockImplementation(async (method: any, params: any) => {
    const items = []
    for (let page = 1; ; page++) {
      const { data } = await method({ ...params, page })
      items.push(...data)
      if (data.length < params.per_page) return items
    }
  })
  octokit.rest.issues.createComment.mockResolvedValue({ data: {} })
  octokit.rest.issues.updateComment.mockResolvedValue({ data: {} })
  octokit.rest.issues.lock.mockResolvedValue({ data: {} })
  octokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({ data: { content: { sha: 'created-sha' } } })
  octokit.rest.actions.reRunWorkflow.mockResolvedValue({ data: {} })
  octokit.rest.reactions.createForIssueComment.mockResolvedValue({ data: {} })
  for (const method of ['addHeading', 'addRaw', 'addTable', 'addList']) summary[method].mockImplementation(() => summary)
  summary.write.mockResolvedValue(summary)
}
