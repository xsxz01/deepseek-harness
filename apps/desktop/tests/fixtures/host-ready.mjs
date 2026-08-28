const token = 'A'.repeat(43)
process.send?.({
  type: 'ready',
  origin: 'http://127.0.0.1:43123',
  url: 'http://127.0.0.1:43123/?token=' + token,
  pid: process.pid,
  version: '0.1.0',
})
process.on('message', (message) => {
  if (message?.type !== 'stop') return
  process.send?.({ type: 'stopping' }, () => { process.exit(0) })
})