const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logFile = './logs/app.log', level = 'info') {
    this.logFile = logFile;
    this.level = level;
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
  }

  log(level, message, meta = {}) {
    if (this.levels[level] > this.levels[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...meta
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, Object.keys(meta).length > 0 ? meta : '');

    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.logFile);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.appendFileSync(this.logFile, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  log(level, message, ...args) {
    if (this.levels[level] > this.levels[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message} ${args.join(' ')}\n`;

    console.log(logMessage.trim());

    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  error(message, ...args) {
    this.log('error', message, ...args);
  }

  warn(message, ...args) {
    this.log('warn', message, ...args);
  }

  info(message, ...args) {
    this.log('info', message, ...args);
  }

  debug(message, ...args) {
    this.log('debug', message, ...args);
  }
}

module.exports = Logger;