const AnsiUp = require('ansi_up').default

const STATUS = {
  STOPPED: 'STOPPED',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR'
}

class CommandStreamStore {
  constructor () {
    this.slug = null
    this.projectSlug = null
    this.directorySlug = null
    this.primary = false
    this.name = null
    this.args = null
    this.cwd = null
    this.creationDate = null
    this.runningDate = null
    this.runningArgs = null
    this.stoppedDate = null
    this.exitCode = null
    this.output = []
    this.outputSize = 0
    this.status = STATUS.STOPPED
    this.unread = false

    this.ansiUpStdout = this._newAnsiUp()
    this.ansiUpStderr = this._newAnsiUp()
  }

  _newAnsiUp () {
    const ansiUp = new AnsiUp()
    ansiUp.use_classes = true
    ansiUp.escape_for_html = true
    ansiUp.url_whitelist = { http: false, https: true }
    return ansiUp
  }

  update ({ slug, projectSlug, directorySlug, primary, name, args, cwd, creationDate, runningDate, runningArgs, stoppedDate, exitCode }) {
    this.slug = slug
    this.projectSlug = projectSlug
    this.directorySlug = directorySlug
    this.primary = primary || false
    this.name = name
    this.args = args
    this.cwd = cwd
    this.creationDate = creationDate
    this.runningDate = runningDate
    this.runningArgs = runningArgs
    this.stoppedDate = stoppedDate
    this.exitCode = exitCode

    if (this.exitCode > 0) {
      this.status = STATUS.ERROR
    } else if (this.runningDate && !this.stoppedDate) {
      this.status = STATUS.RUNNING
    } else {
      this.status = STATUS.STOPPED
    }
  }

  _convertDate (value) {
    const date = new Date(value)

    let hours = date.getHours()
    hours = (hours < 10 ? '0' : '') + hours
    let minutes = date.getMinutes()
    minutes = (minutes < 10 ? '0' : '') + minutes
    let seconds = date.getSeconds()
    seconds = (seconds < 10 ? '0' : '') + seconds
    let milliseconds = date.getMilliseconds()
    milliseconds = (milliseconds < 10 ? '0' : '') + (milliseconds < 100 ? '0' : '') + milliseconds

    return `${hours}:${minutes}:${seconds}:${milliseconds}`
  }

  addOutput (outputs) {
    for (const output of outputs) {
      let content = output.content

      if (output.type === 'stdout') {
        content = this.ansiUpStdout.ansi_to_html(content)
      } else if (output.type === 'stderr') {
        content = this.ansiUpStderr.ansi_to_html(content)
      }

      const size = 1 + (content.match(/\n/g) || []).length
      this.outputSize += size

      this.output.push({
        type: output.type,
        date: this._convertDate(output.date),
        content,
        size
      })
    }

    this.unread = true
    while (this.outputSize > 5000) {
      const output = this.output.shift()
      this.outputSize -= output.size
    }
  }

  clear () {
    this.output = []
    this.outputSize = 0
  }

  static get STATUS () {
    return STATUS
  }
}

export default CommandStreamStore
