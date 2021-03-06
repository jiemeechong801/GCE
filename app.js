const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const electron = require('electron')
const treeKill = require('tree-kill')
const fixPath = require('fix-path')

fixPath() // Fix for MacOS users, include /usr/local/bin in $PATH

const configFile = path.join(electron.remote.app.getPath('home'), 'gce.yml')
let config = {}
let configError = null
try {
  config = yaml.safeLoad(fs.readFileSync(configFile, 'utf8'))
} catch (err) {
  configError = err.message
}
const Vue = window.Vue

window.app = new Vue({
  el: '#app',

  data: {
    env: Object.assign({}, process.env),
    commands: config.commands || [],
    linesLimit: config.linesLimit || 1000,
    menu: {},
    closing: false,
    isForceClose: false,
    active: null,
    status: {},
    unread: {},
    content: {},
    size: {},
    configError,
    minimizeOnClose: false,
    colors: [
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?30m/g, color: '#969896' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?31m/g, color: '#cc6666' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?32m/g, color: '#b5bd68' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?33m/g, color: '#f0c674' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?34m/g, color: '#81a2be' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?35m/g, color: '#b294bb' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?36m/g, color: '#8abeb7' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?37m/g, color: '#c5c8c6' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?39m/g, color: '#c5c8c6' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?0m/g, color: '#c5c8c6' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?1m/g, color: '#969896' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?22m/g, color: '#c5c8c6' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?90m/g, color: '#969896' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?91m/g, color: '#cc6666' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?92m/g, color: '#b5bd68' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?93m/g, color: '#f0c674' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?94m/g, color: '#81a2be' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?95m/g, color: '#b294bb' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?96m/g, color: '#8abeb7' },
      { pattern: /(\u001b|\u033b|\x1b)\[([0-9]*;|[0-9]*)?[0-9*]m/g, color: '#c5c8c6' }
    ]
  },

  created () {
    let index = 0

    const extraGroups = {}
    Object.keys(config['extra-groups'] || {}).forEach(extra => {
      extraGroups[extra] = config['extra-groups'][extra]
      if (!Array.isArray(extraGroups[extra])) {
        extraGroups[extra] = extraGroups[extra].split(' ')
      }
    })
    const defaultExtra = config['extra-default'] || config['default-extra'] || []

    const getExtras = extraConfigs => {
      const extras = []
      if (extraConfigs === undefined) {
        extraConfigs = defaultExtra
      }
      if (!Array.isArray(extraConfigs)) {
        extraConfigs = extraConfigs.split(' ')
      }
      extraConfigs.forEach(extraConfig => {
        (extraGroups[extraConfig] || [extraConfig]).forEach(extra => {
          if (config.extra && config.extra[extra]) {
            if (typeof config.extra[extra] === 'string' || Array.isArray(config.extra[extra])) {
              config.extra[extra] = { cmd: config.extra[extra], name: config.extra[extra] }
            }
            if (!Array.isArray(config.extra[extra].cmd)) {
              config.extra[extra].cmd = config.extra[extra].cmd.split(' ')
            }
            extras.push(config.extra[extra])
          }
        })
      })
      return extras
    }

    const parseEnv = (env, line) => {
      const parts = line.split('=')
      if (parts.length > 1) {
        const key = parts.shift()
        const value = parts.join('=').replace(/\$\{(\w+)\}|\$([A-Za-z0-9_-]+)(?:[^A-Za-z0-9_-]|$)/g, function (segment, first, second) {
          return env[first || second] || ''
        })
        env[key] = value
      }
    }

    if (config.env) {
      config.env.forEach(env => {
        parseEnv(this.env, env)
      })
    }

    const defaultNotification = config.notification !== false

    window.minimizeOnClose(config['minimize-on-close'] === true)

    this.commands.forEach(cmd => {
      const matches = /^(([^/]+)\/)?(.+)$/.exec(cmd.name)
      if (!matches) {
        return
      }

      cmd.section = matches[2] || 'General'
      cmd.title = matches[3]

      if (!this.menu[cmd.section]) {
        this.menu[cmd.section] = []
      }
      this.menu[cmd.section].push(cmd)

      cmd.slug = index + '/' + cmd.name
      index += 1

      if (!Array.isArray(cmd.cmd)) {
        cmd.cmd = cmd.cmd.split(' ')
      }
      if (cmd['stop-cmd'] && !Array.isArray(cmd['stop-cmd'])) {
        cmd['stop-cmd'] = cmd['stop-cmd'].split(' ')
      }

      cmd.extra = getExtras(cmd.extra)

      if (cmd.env) {
        const cmdEnv = cmd.env
        cmd.env = Object.assign({}, this.env)
        cmdEnv.forEach(env => {
          parseEnv(cmd.env, env)
        })
      }

      cmd['success-code'] = cmd['success-code'] || 0

      cmd.notification = cmd.notification === true || cmd.notification === false ? cmd.notification : defaultNotification

      Vue.set(this.status, cmd.slug, 0)
      Vue.set(this.unread, cmd.slug, false)
      Vue.set(this.content, cmd.slug, [])
      Vue.set(this.size, cmd.slug, 0)
    })

    window.onbeforeunload = () => {
      if (this.isForceClose) {
        return
      }
      return this.onClose()
    }
  },

  methods: {
    selectCmd (cmd) {
      if (this.active && this.active.slug && this.unread[this.active.slug]) {
        this.unread[this.active.slug] = false
      }
      this.active = cmd
      this.autoScroll()
    },
    autoScroll () {
      const scrollableContent = this.$refs.scrollableContent
      setTimeout(() => {
        scrollableContent.scrollTop = scrollableContent.scrollHeight - scrollableContent.clientHeight
      })
    },
    toHtml (str) {
      str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/ /g, '&nbsp;')
      str = '<span>' + str
      for (let index in this.colors) {
        let color = this.colors[index]
        str = str.replace(color.pattern, '</span><span style="color:' + color.color + '">')
      }
      str += '</span>'
      return str.replace(/\n/g, '<br>')
    },
    sendNotification (cmd, title, body, force) {
      if (window.isFocus || cmd.notification === false) {
        return
      }
      if (force && cmd.notificationTimer) {
        clearTimeout(cmd.notificationTimer)
        cmd.notificationTimer = null
      }
      if (cmd.notificationTimer) {
        return
      }
      cmd.notificationTimer = setTimeout(() => {
        cmd.notificationTimer = null
      }, 2000)
      const notification = new Notification('GCE: ' + title, {
        body,
        icon: path.join(__dirname, 'assets', 'icon.png')
      })
      notification.onclick = () => {
        this.selectCmd(cmd)
        window.focusWindow()
        notification.close()
      }
    },
    addContent (cmd, type, data) {
      if (this.content[cmd.slug]) {
        if (!cmd.url) {
          const matches = data.match(/running (?:at|on)(?:.*)(?: |:)([0-9]{2,5})/)
          if (matches) {
            cmd.url = 'http://127.0.0.1:' + matches[1]
            cmd.urlText = '127.0.0.1:' + matches[1]
          }
        }
        this.unread[cmd.slug] = true
        const html = this.toHtml(data)
        const size = 1 + (data.match(/\n/g) || []).length
        this.content[cmd.slug].push({ type, data: html, time: (new Date()).toLocaleTimeString(), size })
        this.size[cmd.slug] += size

        while (this.size[cmd.slug] > this.linesLimit && this.content[cmd.slug].length > 2) {
          this.size[cmd.slug] -= this.content[cmd.slug][0].size
          this.content[cmd.slug].shift()
        }

        if (this.active && cmd.slug === this.active.slug) {
          this.autoScroll()
        }

        if (type === 'stderr') {
          let body = data
          if (body.length > 250) {
            body = body.substr(0, 245) + '...'
          }
          this.sendNotification(cmd, cmd.name, body)
        }
      }
    },
    getCWD (cmd) {
      if (config.root && cmd.path) {
        if (path.isAbsolute(cmd.path)) {
          return cmd.path
        }
        return path.join(config.root, cmd.path)
      }
      return config.root || cmd.path || undefined
    },
    runCommand (cmd, command, statusOnSuccess = 0) {
      if (this.status[cmd.slug] !== 1 && !cmd.proc) {
        this.status[cmd.slug] = 1
        const cwd = this.getCWD(cmd)

        this.addContent(cmd, 'info', cwd ? (cwd + '\n' + command.join(' ')) : command.join(' '))
        cmd.proc = childProcess.spawn(command[0], command.slice(1), { cwd, shell: true, env: cmd.env || this.env })

        cmd.proc.stdout.on('data', data => {
          this.addContent(cmd, 'stdout', data.toString())
        })
        cmd.proc.stderr.on('data', data => {
          this.addContent(cmd, 'stderr', data.toString())
        })
        cmd.proc.on('error', err => {
          this.addContent(cmd, 'stderr', err.message)
        })
        cmd.proc.on('close', code => {
          const message = `Process exited with code ${code}`
          this.addContent(cmd, 'info', message)

          if (cmd.stop || code === cmd['success-code']) {
            this.status[cmd.slug] = statusOnSuccess
          } else {
            this.status[cmd.slug] = 3
            this.sendNotification(cmd, cmd.name, message, true)
          }
          cmd.subcmd = false
          cmd.proc = null
          cmd.stop = false
          if (this.closing) {
            setTimeout(window.close)
          } else if (cmd.restart) {
            cmd.restart = false
            setTimeout(() => this.start(cmd))
          }
        })
      }
    },
    start (cmd) {
      if (cmd && cmd.cmd) {
        this.runCommand(cmd, cmd.cmd, cmd['stop-cmd'] ? 2 : 0)
      }
    },
    stop (cmd) {
      if (cmd.stop) {
        return true
      }
      if (cmd['stop-cmd'] && this.status[cmd.slug] === 2 && !cmd.proc) {
        cmd.stop = true
        this.runCommand(cmd, cmd['stop-cmd'], 0)
        return true
      }
      if (this.status[cmd.slug] === 1 && cmd.proc) {
        this.addContent(cmd, 'info', 'Killing the process...')
        cmd.stop = true
        treeKill(cmd.proc.pid, err => {
          if (err) {
            this.addContent(cmd, 'info', 'Error during killing the process')
            this.addContent(cmd, 'info', err.message)
          }
        })
        return true
      }
      return false
    },
    clear (cmd) {
      if (this.content[cmd.slug]) {
        this.content[cmd.slug] = []
        this.size[cmd.slug] = 0
      }
    },
    restart (cmd) {
      cmd.restart = true
      this.stop(cmd)
    },
    onClose () {
      let ret = undefined
      this.commands.forEach(cmd => {
        if (this.stop(cmd) || cmd.proc) {
          ret = false
          this.closing = true
        }
      })
      return ret
    },
    forceClose () {
      this.isForceClose = true
      window.close()
    },
    runDetachedCommand (cmd, subcmd) {
      const cwd = this.getCWD(cmd)
      const argv = subcmd.map(arg => arg.replace('%dir%', cwd))
      const subprocess = childProcess.spawn(argv[0], argv.slice(1), {
        cwd,
        env: cmd.env || this.env,
        detached: true,
        stdio: 'ignore'
      })
      subprocess.unref()
    },
    runSubCommand (extra) {
      if (extra.detached) {
        this.runDetachedCommand(this.active, extra.cmd)
      } else {
        if (this.active) {
          this.active.subcmd = true
        }
        this.runCommand(this.active, extra.cmd || extra)
      }
    },
    openLink (url) {
      electron.shell.openExternal(url)
    }
  }
})
