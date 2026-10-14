import * as core from '@actions/core'
import { context } from '@actions/github'
import { octokit } from './octokit'

/**
 * After someone signs in a comment, re-runs the failed check of the pull
 * request's head commit, so the required check turns green. A comment run is
 * not attached to the pull request's commits, so its own result does not count.
 */
export async function reRunLastWorkFlowIfRequired(): Promise<void> {
  if (context.eventName === 'pull_request') {
    core.debug('rerun not required for event - pull_request')
    return
  }

  const headSha = await getHeadShaOfPullRequest()
  const workflowId = await getSelfWorkflowId()
  const { data: runs } = await octokit.rest.actions.listWorkflowRuns({
    owner: context.repo.owner,
    repo: context.repo.repo,
    workflow_id: workflowId,
    head_sha: headSha,
    event: 'pull_request_target'
  })
  if (runs.total_count === 0) {
    return
  }

  const runId = runs.workflow_runs[0].id
  const { data: run } = await octokit.rest.actions.getWorkflowRun({ owner: context.repo.owner, repo: context.repo.repo, run_id: runId })
  if (run.conclusion === 'failure') {
    core.debug(`Rerunning build run ${runId}`)
    await octokit.rest.actions
      .reRunWorkflow({ owner: context.repo.owner, repo: context.repo.repo, run_id: runId })
      .catch(error => core.error(`Error occurred when re-running the workflow: ${error}`))
  }
}

async function getHeadShaOfPullRequest(): Promise<string> {
  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.issue.number
  })
  return pullRequest.head.sha
}

async function getSelfWorkflowId(): Promise<number> {
  const perPage = 30
  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.actions.listRepoWorkflows({
      owner: context.repo.owner,
      repo: context.repo.repo,
      per_page: perPage,
      page
    })
    const workflow = data.workflows.find(w => w.name === context.workflow)
    if (workflow) {
      return workflow.id
    }
    if (data.total_count <= page * perPage) {
      throw new Error("Unable to locate this workflow's ID in this repository, can't trigger job..")
    }
  }
}
