const logger = require('./logger')
const https = require('https')
const tls = require('tls')
const GCEProxy = require('./proxy')

class GCELB {
  constructor (gce) {
    this.gce = gce

    this.certificates = {}
    this.serverOptions = null
    this.server = null
    this.proxy = null
  }

  static async create (gce) {
    const instance = new this(gce)

    await instance.loadCertificates()
    await instance.create()

    return instance
  }

  async create () {
    this.serverOptions = {
      SNICallback: this._SNICallback.bind(this)
    }

    this.server = https.createServer(this.serverOptions, this._onRequest.bind(this))
    this.server.on('upgrade', this._onUpgrade.bind(this))

    this.proxy = await GCEProxy.create(this.gce, this)
  }

  async loadCertificates () {
    for (const serverName of Object.keys(this.gce.config.loadBalancers)) {
      this.certificates[serverName] = await this._createSecureContext(this.gce.config.loadBalancers[serverName])
    }
  }

  async listen () {
    this.server.listen(443, () => {
      logger.info('GCE LB', 'Server', 'Started on port', 443)
    })
  }

  _onRequest (req, res) {
    if (this.proxy.proxyRequest(req, res)) {
      return
    }

    logger.warn('GCE LB', req.headers.host, 'No proxy found')

    res.writeHead(404)
    res.write('404 Not Found')
    res.end()
  }

  _onUpgrade (req, socket, head) {
    if (this.proxy.proxyUpgrade(req, socket, head)) {
      return
    }

    logger.warn('GCE LB', req.headers.host, 'No proxy found')
  }

  async _createSecureContext (options) {
    const context = tls.createSecureContext({
      cert: options.crt,
      key: options.key
    })

    delete options.crt
    delete options.key

    return context
  }

  _SNICallback (serverName, callback) {
    let context = null

    for (const serverNameCertificate of Object.keys(this.certificates)) {
      if (('.' + serverName).endsWith(serverNameCertificate)) {
        context = this.certificates[serverNameCertificate]
        break
      }
    }

    if (!context) {
      logger.error('GCE LB', serverName, 'SSL certificate not found')
    }

    if (callback) {
      callback(null, context)
    } else {
      return context
    }
  }
}

module.exports = GCELB