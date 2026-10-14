import * as core from '@actions/core'
import { context } from '@actions/github'
import { lockPullRequest } from './pullrequest/pullRequestLock'
import { setupClaCheck } from './setupClaCheck'
import * as input from './shared/getInputs'

export async function run(): Promise<void> {
  try {
    core.info('CLA Assistant GitHub Action bot has started the process')

    if (context.payload.action === 'closed') {
      // Signatures are final once a pull request merges; lock it so they cannot be edited.
      if (context.payload.pull_request?.merged && input.lockPullRequestAfterMerge()) {
        await lockPullRequest()
      }
      return
    }
    await setupClaCheck()
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
