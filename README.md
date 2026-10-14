[![build](https://github.com/wolfware-labs/cla-action/actions/workflows/nodejs.yml/badge.svg)](https://github.com/wolfware-labs/cla-action/actions/workflows/nodejs.yml)

# CLA Assistant GitHub Action

A GitHub Action that asks contributors to sign a Contributor License Agreement (CLA) or a Developer Certificate of Origin (DCO) from inside a pull request, and records their signatures in a JSON file in a repository. There is no external service and no database: the signature file lives in the same repository or in another repository you choose.

This is Wolfware's maintained fork of [contributor-assistant/github-action](https://github.com/contributor-assistant/github-action), which is archived. Wolfware repositories use it, and changes are made here. Credit for the original work goes to its authors and contributors, listed below.

## How it works

1. A pull request is opened, updated or closed, and the workflow runs on `pull_request_target`, in the context of the base repository.
2. The action reads the pull request's commit authors, drops anyone on the allowlist, and looks each one up in the signature file.
3. If someone has not signed, it comments on the pull request with a link to the document and fails the check. A contributor signs by commenting the sentence it asks for.
4. Each signature is committed to the signature file with the contributor's GitHub account, id, the pull request and the date. Commits made by `github-actions[bot]` are never checked. One signature covers all later pull requests.
5. When a pull request is merged, the action locks its conversation, so signature comments cannot be edited or deleted afterwards.

## Setup

Add `.github/workflows/cla.yml` to your repository:

```yaml
name: CLA

on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, closed, synchronize]

permissions:
  actions: write
  contents: write # read is enough when signatures are stored in another repository
  issues: write # to lock merged pull requests
  pull-requests: write
  statuses: write

# One group per pull request. A newer run may replace a pending one, which
# loses nothing: every run reads the pull request's comments again. The
# merged-close run has its own group so that a comment run cannot replace it.
concurrency:
  group: cla-${{ github.event.action == 'closed' && 'close-' || '' }}${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: false

jobs:
  cla:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    # Comments count only on pull requests, and a close counts only after a merge.
    if: >-
      (github.event_name == 'pull_request_target' &&
        (github.event.action != 'closed' || github.event.pull_request.merged)) ||
      (github.event.issue.pull_request &&
        (github.event.comment.body == 'recheck' ||
         github.event.comment.body == 'I have read the CLA document and I hereby sign the CLA'))
    steps:
      - uses: wolfware-labs/cla-action@<commit SHA>
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          path-to-document: https://github.com/<owner>/<repo>/blob/main/CLA.md
          path-to-signatures: signatures/cla.json
          branch: cla-signatures
          custom-pr-sign-comment: I have read the CLA document and I hereby sign the CLA
          allowlist: dependabot[bot],renovate[bot]
```

Pin the action to a full commit SHA, as GitHub's [security hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions) recommends.

The `if:` sentence must match `custom-pr-sign-comment`. Expression comparison in GitHub Actions ignores case.

`pull_request_target` runs the workflow from the default branch with a write token, also for pull requests from forks. The action never checks out pull request code; keep it that way if you add steps.

### Where signatures are stored

Signatures go to `path-to-signatures` on `branch`. A dedicated branch such as `cla-signatures` keeps signature commits off your default branch. The branch must exist; the file does not need to, and must not be created by hand.

Rules that require signed commits on that branch are fine: commits the action makes with `GITHUB_TOKEN` through the GitHub API are signed by GitHub. Rules that require pull requests or block direct pushes to the branch are not.

To store signatures in another repository, set `remote-organization-name` and `remote-repository-name`, and add a `PERSONAL_ACCESS_TOKEN` secret with write access to that repository.

### Allowlist

Accounts on the allowlist never have to sign. Use it for maintainers and for bots that cannot sign, such as `dependabot[bot]`. Entries are comma separated, and `*` matches any characters, for example `bot*`.

### Making the check required

The job reports a check named after the job (`cla` above). To block merging until everyone has signed, add it as a required status check in a branch ruleset or branch protection rule, with GitHub Actions as the source.

## Known behaviour

- **First run.** When the signature file does not exist, the action creates it and then fails the check with "Committers of pull request N have to sign the CLA", even if every author is on the allowlist. Comment `recheck` or rerun the job, and it passes.
- **Large pull requests.** The action reads the first 100 commits and the first page of comments of a pull request ([#1](https://github.com/wolfware-labs/cla-action/issues/1)). Authors of later commits and signing comments past the first page are not seen.
- **Concurrent writes.** Two runs that update the signature file at the same moment conflict, and the later one fails. The concurrency group above avoids this within a pull request; across pull requests, `recheck` records the signature.

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `path-to-document` | yes | | Full URL of the document contributors sign, for example a `CLA.md` in your repository. |
| `path-to-signatures` | no | `./signatures/cla.json` | Path of the JSON file that stores signatures. |
| `branch` | no | `master` | Branch the signature file is committed to. It must exist. |
| `allowlist` | no | | Comma-separated accounts that do not need to sign. `*` is a wildcard. |
| `remote-organization-name` | no | | Owner of another repository that stores the signatures. |
| `remote-repository-name` | no | | Name of another repository that stores the signatures. |
| `create-file-commit-message` | no | | Commit message when the signature file is created. |
| `signed-commit-message` | no | | Commit message when someone signs. `$contributorName`, `$owner`, `$repo` and `$pullRequestNo` are replaced. |
| `signed-empty-commit-message` | no | | Not used. Accepted so that existing workflows keep working. |
| `custom-notsigned-prcomment` | no | | Comment asking new contributors to sign. `$you` is replaced with "you" or "you all". |
| `custom-pr-sign-comment` | no | | The sentence contributors comment to sign. |
| `custom-allsigned-prcomment` | no | | Comment when everyone has signed. |
| `use-dco-flag` | no | `false` | Ask for a Developer Certificate of Origin instead of a CLA. |
| `lock-pullrequest-aftermerge` | no | `true` | Lock the pull request conversation after it merges. |
| `suggest-recheck` | no | `true` | Suggest commenting `recheck` in the action's comment. |

## Environment variables

| Name | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | yes | `${{ secrets.GITHUB_TOKEN }}`. Used for every API call on the repository the workflow runs in. |
| `PERSONAL_ACCESS_TOKEN` | only for remote storage | A token with write access to the repository named by `remote-organization-name` and `remote-repository-name`. |

## Development

```sh
npm ci
npm run build   # compiles src/ into dist/index.js, which is what the action runs
```

Commit `dist/index.js` together with the source change that produced it.

## Contributors

These people built the original action:

<!-- readme: collaborators,contributors -start -->
<table>
<tr>
    <td align="center">
        <a href="https://github.com/matbos">
            <img src="https://avatars.githubusercontent.com/u/1948188?v=4" width="100;" alt="matbos"/>
            <br />
            <sub><b>Mateusz Boś</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/michael-spengler">
            <img src="https://avatars.githubusercontent.com/u/43786652?v=4" width="100;" alt="michael-spengler"/>
            <br />
            <sub><b>Michael Spengler</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/ibakshay">
            <img src="https://avatars.githubusercontent.com/u/33329946?v=4" width="100;" alt="ibakshay"/>
            <br />
            <sub><b>Akshay Iyyadurai Balasundaram</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/AnandChowdhary">
            <img src="https://avatars.githubusercontent.com/u/2841780?v=4" width="100;" alt="AnandChowdhary"/>
            <br />
            <sub><b>Anand Chowdhary</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/kingthorin">
            <img src="https://avatars.githubusercontent.com/u/7570458?v=4" width="100;" alt="kingthorin"/>
            <br />
            <sub><b>Rick M</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Writhe">
            <img src="https://avatars.githubusercontent.com/u/2022097?v=4" width="100;" alt="Writhe"/>
            <br />
            <sub><b>Filip Moroz</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/mmv08">
            <img src="https://avatars.githubusercontent.com/u/16622558?v=4" width="100;" alt="mmv08"/>
            <br />
            <sub><b>Mikhail</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/manifestinteractive">
            <img src="https://avatars.githubusercontent.com/u/508411?v=4" width="100;" alt="manifestinteractive"/>
            <br />
            <sub><b>Peter Schmalfeldt</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/mattrosno">
            <img src="https://avatars.githubusercontent.com/u/1691245?v=4" width="100;" alt="mattrosno"/>
            <br />
            <sub><b>Matt Rosno</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Or-Geva">
            <img src="https://avatars.githubusercontent.com/u/9606235?v=4" width="100;" alt="Or-Geva"/>
            <br />
            <sub><b>Or Geva</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/pellared">
            <img src="https://avatars.githubusercontent.com/u/5067549?v=4" width="100;" alt="pellared"/>
            <br />
            <sub><b>Robert Pająk</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/ScottBrenner">
            <img src="https://avatars.githubusercontent.com/u/416477?v=4" width="100;" alt="ScottBrenner"/>
            <br />
            <sub><b>Scott Brenner</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/silviogutierrez">
            <img src="https://avatars.githubusercontent.com/u/92824?v=4" width="100;" alt="silviogutierrez"/>
            <br />
            <sub><b>Silvio</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/azzamsa">
            <img src="https://avatars.githubusercontent.com/u/17734314?v=4" width="100;" alt="azzamsa"/>
            <br />
            <sub><b>Azzam S.A</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Tropicao">
            <img src="https://avatars.githubusercontent.com/u/4692087?v=4" width="100;" alt="Tropicao"/>
            <br />
            <sub><b>Alexis Lothoré</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/alohr51">
            <img src="https://avatars.githubusercontent.com/u/3623618?v=4" width="100;" alt="alohr51"/>
            <br />
            <sub><b>Andrew Lohr</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/aymanbagabas">
            <img src="https://avatars.githubusercontent.com/u/3187948?v=4" width="100;" alt="aymanbagabas"/>
            <br />
            <sub><b>Ayman Bagabas</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/fishcharlie">
            <img src="https://avatars.githubusercontent.com/u/860375?v=4" width="100;" alt="fishcharlie"/>
            <br />
            <sub><b>Charlie Fish</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/darrellwarde">
            <img src="https://avatars.githubusercontent.com/u/8117355?v=4" width="100;" alt="darrellwarde"/>
            <br />
            <sub><b>Darrell Warde</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Holzhaus">
            <img src="https://avatars.githubusercontent.com/u/1834516?v=4" width="100;" alt="Holzhaus"/>
            <br />
            <sub><b>Jan Holthuis</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/nwalters512">
            <img src="https://avatars.githubusercontent.com/u/1476544?v=4" width="100;" alt="nwalters512"/>
            <br />
            <sub><b>Nathan Walters</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/rokups">
            <img src="https://avatars.githubusercontent.com/u/19151258?v=4" width="100;" alt="rokups"/>
            <br />
            <sub><b>Rokas Kupstys</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/shunkakinoki">
            <img src="https://avatars.githubusercontent.com/u/39187513?v=4" width="100;" alt="shunkakinoki"/>
            <br />
            <sub><b>Shun Kakinoki</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/simonmeggle">
            <img src="https://avatars.githubusercontent.com/u/1897410?v=4" width="100;" alt="simonmeggle"/>
            <br />
            <sub><b>Simon Meggle</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/t8">
            <img src="https://avatars.githubusercontent.com/u/20846869?v=4" width="100;" alt="t8"/>
            <br />
            <sub><b>Tate Berenbaum</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/Krinkle">
            <img src="https://avatars.githubusercontent.com/u/156867?v=4" width="100;" alt="Krinkle"/>
            <br />
            <sub><b>Timo Tijhof</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/AndrewGable">
            <img src="https://avatars.githubusercontent.com/u/2838819?v=4" width="100;" alt="AndrewGable"/>
            <br />
            <sub><b>Andrew Gable</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/knanao">
            <img src="https://avatars.githubusercontent.com/u/50069775?v=4" width="100;" alt="knanao"/>
            <br />
            <sub><b>Knanao</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/tada5hi">
            <img src="https://avatars.githubusercontent.com/u/13162758?v=4" width="100;" alt="tada5hi"/>
            <br />
            <sub><b>Peter</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/wh201906">
            <img src="https://avatars.githubusercontent.com/u/62299611?v=4" width="100;" alt="wh201906"/>
            <br />
            <sub><b>Self Not Found</b></sub>
        </a>
    </td></tr>
<tr>
    <td align="center">
        <a href="https://github.com/woxiwangshunlibiye">
            <img src="https://avatars.githubusercontent.com/u/106640041?v=4" width="100;" alt="woxiwangshunlibiye"/>
            <br />
            <sub><b>Woyaoshunlibiye </b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/yahavi">
            <img src="https://avatars.githubusercontent.com/u/11367982?v=4" width="100;" alt="yahavi"/>
            <br />
            <sub><b>Yahav Itzhak</b></sub>
        </a>
    </td></tr>
</table>
<!-- readme: collaborators,contributors -end -->

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
