import { createServer } from 'node:http'

const token = 'D'.repeat(43)
const cookie = 'dsh-auth-fixture=value'
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture.invalid')
  if (request.headers.cookie?.includes(cookie)) {
    if (url.pathname === '/crash') {
      response.writeHead(204).end()
      setImmediate(() => { process.exit(7) })
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><body><h1 data-host-pid="' + process.pid + '">Desktop fixture</h1><button id="crash">Crash Host</button><script>document.querySelector("#crash").onclick=()=>fetch("/crash")</script></body></html>')
    return
  }
  if (url.pathname === '/' && url.searchParams.get('token') === token) {
    response.writeHead(303, {
      'location': '/',
      'set-cookie': cookie + '; Max-Age=3600; Path=/; HttpOnly; SameSite=Strict',
    })
    response.end()
    return
  }
  response.writeHead(401).end('unauthorized')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('fixture has no TCP address')
  process.send?.({
    type: 'ready',
    origin: 'http://127.0.0.1:' + address.port,
    url: 'http://127.0.0.1:' + address.port + '/?token=' + token,
    pid: process.pid,
    version: '0.1.0',
  })
})

function stop() {
  process.send?.({ type: 'stopping' }, () => {
    server.close(() => { process.exit(0) })
  })
}
process.on('message', message => { if (message?.type === 'stop') stop() })
process.once('disconnect', () => { server.close(() => { process.exit(0) }) })