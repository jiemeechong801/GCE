const logger = require('./logger')
const path = require('path')
const fs = require('fs').promises

class GCEConfigure {
  constructor (config) {
    this._initialConfig = config
  }

  getForClient () {
    return {
      warnings: this.warnings,
      loadBalancers: Object.keys(this.loadBalancers),
      projects: this.projects
    }
  }

  // Check path, existing directories, slug, bad config, ...
  // Set error message for directory/project
  async reconfigure () {
    this.gce = {}
    this.loadBalancers = {}
    this.projects = {}
    this.warnings = []

    try {
      await this._reconfigureGce()
    } catch (err) {
      this._addWarning('gce', err.message)
    }

    try {
      await this._reconfigureLoadBalancers()
    } catch (err) {
      this._addWarning('loadBalancers', err.message)
    }

    try {
      await this._reconfigureProjects()
    } catch (err) {
      this._addWarning('projects', err.message)
    }

    // TODO: send ws events
  }

  async _reconfigureProjects () {
    if (!this._initialConfig.projects) {
      return
    }

    for (const projectSlug of Object.keys(this._initialConfig.projects)) {
      const project = this._initialConfig.projects[projectSlug]

      if (!project) {
        continue
      }

      try {
        await this._reconfigureProject(`projects[${projectSlug}]`, projectSlug, project)
      } catch (err) {
        this._addWarning(`projects[${projectSlug}]`, err.message)
      }
    }
  }

  async _reconfigureProject (slug, projectSlug, project) {
    if (!this._checkSlug(slug, projectSlug)) {
      return
    }

    let projectName = projectSlug
    if (project.name && this._checkString(`${slug}.name`, project.name)) {
      projectName = project.name
    }

    if (!this._checkString(`${slug}.path`, project.path)) {
      return
    }

    const projectPath = this._path(project.path)
    if (!await this._checkDirectory(`${slug}.path`, projectPath)) {
      return
    }

    if (!project.directories) {
      return this._addWarning(`${slug}.directories`, 'is not defined')
    }

    const projectDefinition = {
      slug: projectSlug,
      name: projectName,
      path: projectPath,
      directories: {}
    }

    for (const directorySlug of Object.keys(project.directories)) {
      const directory = project.directories[directorySlug]

      if (!directory) {
        continue
      }

      try {
        await this._reconfigureProjectDirectory(`${slug}.directories[${directorySlug}]`, projectDefinition, directorySlug, directory)
      } catch (err) {
        this._addWarning(`projects[${projectSlug}]`, err.message)
      }
    }

    if (!Object.keys(projectDefinition.directories).length) {
      return this._addWarning(`${slug}.directories`, 'is empty')
    }

    this.projects[projectSlug] = projectDefinition
  }

  async _reconfigureProjectDirectory (slug, projectDefinition, directorySlug, directory) {
    if (!this._checkSlug(slug, directorySlug)) {
      return
    }

    let directoryName = directorySlug
    if (directory.name && this._checkString(`${slug}.name`, directory.name)) {
      directoryName = directory.name
    }

    if (!this._checkString(`${slug}.path`, directory.path || directorySlug)) {
      return
    }

    const directoryPath = this._path(projectDefinition.path, directory.path || directorySlug)
    if (!await this._checkDirectory(`${slug}.path`, directoryPath)) {
      return
    }

    const directoryDefinition = {
      slug: directorySlug,
      name: directoryName,
      path: directoryPath,
      loadBalancer: {},
      commands: {}
    }

    if (directory.loadBalancer) {
      for (const lbSlug of Object.keys(directory.loadBalancer)) {
        const lb = directory.loadBalancer[lbSlug]

        if (!lb) {
          continue
        }

        if (!lb.hosts || !lb.hosts.length) {
          this._addWarning(`${slug}.loadBalancer[${lbSlug}].hosts`, 'not defined or empty')
          continue
        }

        if (!this._checkArrayOfStrings(`${slug}.loadBalancer[${lbSlug}].hosts`, lb.hosts)) {
          continue
        }

        if (!lb.ports || !lb.ports.length) {
          this._addWarning(`${slug}.loadBalancer[${lbSlug}].ports`, 'not defined or empty')
          continue
        }

        if (!this._checkArrayOfIntegers(`${slug}.loadBalancer[${lbSlug}].ports`, lb.ports)) {
          continue
        }

        if (lb.path && !this._checkString(`${slug}.loadBalancer[${lbSlug}].path`, lb.path)) {
          continue
        }

        if (lb.pathNot && !this._checkString(`${slug}.loadBalancer[${lbSlug}].pathNot`, lb.pathNot)) {
          continue
        }

        directoryDefinition.loadBalancer[lbSlug] = {
          slug: lbSlug,
          hosts: lb.hosts,
          ports: lb.ports,
          path: lb.path || null,
          pathNot: lb.pathNot || null
        }
      }
    }

    if (!directory.commands) {
      return this._addWarning(`${slug}.commands`, 'is empty')
    }

    for (const commandSlug of Object.keys(directory.commands)) {
      const command = directory.commands[commandSlug]

      if (!command) {
        continue
      }

      if (!command.args || !command.args.length) {
        this._addWarning(`${slug}.commands[${commandSlug}].args`, 'not defined or empty')
        continue
      }

      if (!this._checkArrayOfStrings(`${slug}.commands[${commandSlug}].args`, command.args)) {
        continue
      }

      let commandName = commandSlug
      if (command.name && this._checkString(`${slug}.commands[${commandSlug}].name`, command.name)) {
        commandName = command.name
      }

      directoryDefinition.commands[commandSlug] = {
        slug: commandSlug,
        name: commandName,
        args: command.args
      }
    }

    if (!Object.keys(directoryDefinition.commands).length) {
      return this._addWarning(`${slug}.commands`, 'is empty')
    }

    projectDefinition.directories[directorySlug] = directoryDefinition
  }

  async _reconfigureProjectDirectoryLoadBalancer () {}

  async _reconfigureLoadBalancers () {
    if (!this._initialConfig.loadBalancers) {
      return
    }

    for (const key of Object.keys(this._initialConfig.loadBalancers)) {
      const options = this._initialConfig.loadBalancers[key]
      const domain = key[0] !== '.' ? `.${key}` : key

      if (options && this._checkSlug(`loadBalancers[${key}]`, key) && this._checkString(`loadBalancers[${key}].crt`, options.crt) && this._checkString(`loadBalancers[${key}].key`, options.key)) {
        this.loadBalancers[domain] = {
          crt: options.crt,
          key: options.key
        }
        logger.info('GCE Config', 'Load balancer', domain)
      }
    }
  }

  async _reconfigureGce () {
    this.gce = {
      hosts: [],
      ports: {
        server: 6730,
        loadBalancer: 6731
      },
      secure: true
    }

    if (!this._initialConfig.gce) {
      return
    }

    if (this._initialConfig.gce.hosts && this._checkArrayOfStrings('gce.hosts', this._initialConfig.gce.hosts)) {
      this.gce.hosts = this._initialConfig.gce.hosts
    }
    if (this._initialConfig.gce.ports) {
      if (this._initialConfig.gce.ports.server && this._checkInteger('gce.ports.server', this._initialConfig.gce.ports.server)) {
        this.gce.ports.server = this._initialConfig.gce.ports.server
      }
      if (this._initialConfig.gce.ports.loadBalancer && this._checkInteger('gce.ports.loadBalancer', this._initialConfig.gce.ports.loadBalancer)) {
        this.gce.ports.loadBalancer = this._initialConfig.gce.ports.loadBalancer
      }
    }
    if (this._initialConfig.gce.secure === true || this._initialConfig.gce.secure === false) {
      this.gce.secure = this._initialConfig.gce.secure
    }
  }

  _path (projectPath, directoryPath) {
    let fullpath = process.cwd()

    if (projectPath[0] === '/') {
      fullpath = projectPath
    } else {
      fullpath = path.join(fullpath, projectPath)
    }

    if (directoryPath) {
      if (directoryPath[0] === '/') {
        return directoryPath
      }
      fullpath = path.join(fullpath, directoryPath)
    }

    return fullpath
  }

  async _checkDirectory (slug, directory) {
    try {
      const stat = await fs.stat(directory)
      if (!stat.isDirectory()) {
        throw new Error('Not a directory')
      }
    } catch (err) {
      return this._addWarning(slug, err.message)
    }
    return true
  }

  _checkArrayOfStrings (slug, array) {
    if (!Array.isArray(array)) {
      return this._addWarning(slug, 'not an array')
    }
    if (array.some(value => typeof value !== 'string')) {
      return this._addWarning(slug, 'some items are not strings')
    }
    return true
  }

  _checkArrayOfIntegers (slug, array) {
    if (!Array.isArray(array)) {
      return this._addWarning(slug, 'not an array')
    }
    if (array.some(value => !Number.isInteger(value) || value <= 0)) {
      return this._addWarning(slug, 'some items are not strings')
    }
    return true
  }

  _checkSlug (slug, value) {
    if (typeof value !== 'string') {
      return this._addWarning(slug, 'is not a string')
    }
    if (!value.match(/^[a-z0-9-_.]+$/i)) {
      return this._addWarning(slug, 'is not a slug (a-z0-9-_.)')
    }
    return true
  }

  _checkString (slug, value) {
    if (typeof value !== 'string') {
      return this._addWarning(slug, 'is not a string')
    }
    return true
  }

  _checkInteger (slug, value) {
    if (!Number.isInteger(value) || value <= 0) {
      return this._addWarning(slug, 'is not an integer')
    }
    return true
  }

  _addWarning (slug, message) {
    logger.warn('GCE Config', slug, message)
    this.warnings.push(`${slug}: ${message}.`)
    return false
  }
}

module.exports = GCEConfigure