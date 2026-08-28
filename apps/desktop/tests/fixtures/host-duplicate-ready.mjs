const event = {
  type: 'ready',
  origin: 'http://127.0.0.1:43125',
  url: 'http://127.0.0.1:43125/?token=' + 'C'.repeat(43),
  pid: process.pid,
  version: '0.1.0',
}
process.send?.(event, () => { process.send?.(event) })
setInterval(() => {}, 1_000)