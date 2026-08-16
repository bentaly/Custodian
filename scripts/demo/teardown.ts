// `pnpm demo:teardown` — remove the demo tenant and everything scoped to it.
// The work lives in lib/teardown.ts so `demo:seed` can reuse it.

import { findDemoClient, runScript, step } from './lib/shared'
import { teardownDemo } from './lib/teardown'

runScript('demo:teardown', async () => {
  const client = await findDemoClient()
  if (!client) {
    console.log('  nothing to remove — no demo client exists')
    return
  }
  step(`Removing "${client.name}" (${client.id})`)
  await teardownDemo(client.id)
})
