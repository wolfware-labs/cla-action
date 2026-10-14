import { beforeEach, describe, expect, it, vi } from 'vitest'
import { context, octokit, reset } from './harness'

vi.mock('@actions/core', async () => (await import('./harness')).core)
vi.mock('@actions/github', async () => (await import('./harness')).github)
vi.mock('../src/octokit', async () => (await import('./harness')).octokitModule)

const { reRunLastWorkFlowIfRequired } = await import('../src/pullRerunRunner')

function lastRun(conclusion: string | null, total = 1) {
  octokit.rest.pulls.get.mockResolvedValue({ data: { head: { ref: 'main', sha: 'head-sha' } } })
  octokit.rest.actions.listRepoWorkflows.mockResolvedValue({ data: { total_count: 2, workflows: [{ id: 1, name: 'build' }, { id: 2, name: 'CLA' }] } })
  octokit.rest.actions.listWorkflowRuns.mockResolvedValue({ data: { total_count: total, workflow_runs: total ? [{ id: 77 }] : [] } })
  octokit.rest.actions.getWorkflowRun.mockResolvedValue({ data: { conclusion } })
}

describe('reRunLastWorkFlowIfRequired', () => {
  beforeEach(() => reset())

  it('does nothing for a pull_request event', async () => {
    context.eventName = 'pull_request'
    await reRunLastWorkFlowIfRequired()
    expect(octokit.rest.pulls.get).not.toHaveBeenCalled()
  })

  it("re-runs the latest failed run of this workflow for the pull request's head commit", async () => {
    lastRun('failure')
    await reRunLastWorkFlowIfRequired()
    // By commit, not branch name: a fork's branch can share its name with another pull request's.
    expect(octokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      head_sha: 'head-sha',
      workflow_id: 2,
      event: 'pull_request_target'
    })
    expect(octokit.rest.actions.reRunWorkflow).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', run_id: 77 })
  })

  it('leaves a successful run alone', async () => {
    lastRun('success')
    await reRunLastWorkFlowIfRequired()
    expect(octokit.rest.actions.reRunWorkflow).not.toHaveBeenCalled()
  })

  it('does nothing when there is no earlier run', async () => {
    lastRun(null, 0)
    await reRunLastWorkFlowIfRequired()
    expect(octokit.rest.actions.getWorkflowRun).not.toHaveBeenCalled()
  })

  it('pages through the workflow list to find this workflow', async () => {
    lastRun('failure')
    octokit.rest.actions.listRepoWorkflows
      .mockResolvedValueOnce({ data: { total_count: 31, workflows: [{ id: 1, name: 'build' }] } })
      .mockResolvedValueOnce({ data: { total_count: 31, workflows: [{ id: 9, name: 'CLA' }] } })
    await reRunLastWorkFlowIfRequired()
    expect(octokit.rest.actions.listRepoWorkflows).toHaveBeenCalledTimes(2)
    expect(octokit.rest.actions.listWorkflowRuns.mock.calls[0][0].workflow_id).toBe(9)
  })

  it('fails when this workflow cannot be found', async () => {
    lastRun('failure')
    octokit.rest.actions.listRepoWorkflows.mockResolvedValue({ data: { total_count: 1, workflows: [{ id: 1, name: 'build' }] } })
    await expect(reRunLastWorkFlowIfRequired()).rejects.toThrow("Unable to locate this workflow's ID")
  })
})
