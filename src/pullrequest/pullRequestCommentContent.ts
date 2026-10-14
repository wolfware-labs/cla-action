import { CommitterMap } from '../interfaces'
import { escapeMarkdown } from '../shared/escape'
import * as input from '../shared/getInputs'

const DOCUMENT_NAME = { CLA: 'Contributor License Agreement', DCO: 'Developer Certificate of Origin' }

const LINK_EMAIL_HELP =
  'https://docs.github.com/en/pull-requests/committing-changes-to-your-project/troubleshooting-commits/why-are-my-commits-linked-to-the-wrong-user'

/** The bot's signature line; pullRequestComment finds its own comment by it. */
export function footer(): string {
  return `<sub>Posted by the **${input.documentKind()} Assistant Lite bot**.</sub>`
}

/** The text of the bot's comment on the pull request. */
export function commentContent(signed: boolean, committerMap: CommitterMap): string {
  const kind = input.documentKind()

  if (signed) {
    const line = input.getCustomAllSignedPrComment() || `All contributors have signed the ${kind}  ✍️ ✅`
    return `${line}<br/>${footer()}`
  }

  const total = committerMap.signed.length + committerMap.notSigned.length
  const you = total > 1 ? 'you all' : 'you'
  const request =
    input.getCustomNotSignedPrComment() ||
    `<br/>Thank you for your submission, we really appreciate it. Like many open-source projects, we ask that $you sign our [${DOCUMENT_NAME[kind]}](${input.getPathToDocument()}) before we can accept your contribution. You can sign the ${kind} by just posting a Pull Request Comment same as the below format.<br/>`

  let text = `${request.replace('$you', you)}
   - - -
   ${input.signSentence()}
   - - -
   `

  if (total > 1) {
    text += `**${committerMap.signed.length}** out of **${total}** committers have signed the ${kind}.`
    for (const committer of committerMap.signed) {
      text += `<br/>:white_check_mark: [${committer.name}](https://github.com/${committer.name})`
    }
    for (const committer of committerMap.notSigned) {
      // Only a linked account is mentioned; any other name comes from commit metadata.
      text += committer.id ? `<br/>:x: @${committer.name}` : `<br/>:x: ${escapeMarkdown(committer.name)}`
    }
    text += '<br/>'
  }

  if (committerMap.unknown.length > 0) {
    const names = committerMap.unknown.map(committer => escapeMarkdown(committer.name)).join(', ')
    const seem = committerMap.unknown.length > 1 ? 'seem' : 'seems'
    text += `**${names}** ${seem} not to be a GitHub user.`
    text += ` You need a GitHub account to be able to sign the ${kind}. If you have already a GitHub account, please [add the email address used for this commit to your account](${LINK_EMAIL_HELP}).<br/>`
  }

  if (input.suggestRecheck()) {
    text += '<sub>You can retrigger this bot by commenting **recheck** in this Pull Request. </sub>'
  }
  return text + footer()
}
