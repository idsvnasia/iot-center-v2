const {createProxyMiddleware} = require('http-proxy-middleware')

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  )
  app.use(
    '/influx',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  )
  app.use(
    '/mqtt',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  )
  app.use(
    '/kafka',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      changeOrigin: true,
    })
  )
  // app.use(
  //   '/mqtt',
  //   createProxyMiddleware({
  //     target: 'http://localhost:5000',
  //     ws: true,
  //   })
  // )
}
