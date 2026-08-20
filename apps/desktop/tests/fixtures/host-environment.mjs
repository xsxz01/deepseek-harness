import { delimiter } from 'node:path'

const path = process.env.PATH ?? ''
const [nodeDir, ...tail] = path.split(delimiter)
if (nodeDir !== process.env.DSH_TEST_NODE_DIR || tail.join(delimiter) !== 'fixture-tail') process.exit(9)

const token = 'A'.repeat(43)
process.send?.({ type: 'ready', origin: 'http://127.0.0.1:43123', cookie: { name: 'dsh-desktop-host', value: token }, pid: process.pid, version: '0.1.0' })
process.on('message', (message) => {
  if (message?.type !== 'stop') return
  process.send?.({ type: 'stopping' }, () => { process.exit(0) })
})
