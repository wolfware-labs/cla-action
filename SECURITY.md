# Security policy

## Supported versions

Fixes land on `main`. Workflows should pin the action to a commit SHA and move to the commit that contains a fix.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

A useful report includes the commit you tested, the workflow configuration, steps that reproduce the problem, and the impact you expect, for example a signature recorded for the wrong account or a way to pass the check without signing.

You can expect a first reply within 7 days. Once a fix is ready, the advisory is published with the commit that contains it, and reporters are credited unless they ask not to be.

## Scope

The action runs on `pull_request_target` with a write token, so anything that lets a pull request or a comment run code, write outside the signature file, or record a signature for someone else is in scope. Problems in GitHub Actions itself should be reported to GitHub.
