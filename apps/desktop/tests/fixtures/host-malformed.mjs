process.send?.({ type: 'ready', origin: 'not-an-origin' })
setInterval(() => {}, 1_000)
