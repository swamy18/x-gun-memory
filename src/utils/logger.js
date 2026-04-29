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

module.exports = Logger;