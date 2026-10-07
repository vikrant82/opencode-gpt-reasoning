import { fileURLToPath } from 'node:url'
import { parseArgs, runSmoke } from './smoke-support.mjs'

/** Manually invoked smoke only, AFTER separate human approval for this model session.
 * Task implementation approval is not execution consent. No import-time auth/IO.
 */
export async function main(args, runner = runSmoke) {
  const { model } = parseArgs(args)
  return runner({ model })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result) + '\n')
    if (!result.taskSuccess || !result.replayAccepted) process.exitCode = 1
  }).catch(error => {
    const category = ['invalid-arguments', 'auth-unavailable', 'auth-changed', 'unapproved-destination', 'enterprise-approval-required'].includes(error.message) ? error.message : 'smoke-failed'
    process.stderr.write(category + '\n'); process.exitCode = 1
  })
}
