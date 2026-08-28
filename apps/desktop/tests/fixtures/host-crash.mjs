const token = 'B'.repeat(43)
process.send?.({
  type: 'ready',
  origin: 'http://127.0.0.1:43124',
  url: 'http://127.0.0.1:43124/?token=' + token,
  pid: process.pid,
  version: '0.1.0',
}, () => { setTimeout(() => { process.exit(7) }, 10) })