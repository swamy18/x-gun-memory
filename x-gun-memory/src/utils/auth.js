const config = require('../config.json');

class Auth {
  static checkApiKey(req, res, next) {
    if (!config.auth?.enabled) {
      return next();
    }

    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required (X-API-Key header)' });
    }

    const permissions = config.auth.apiKeys[apiKey];
    if (!permissions) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    req.auth = { permissions, apiKey };
    next();
  }

  static requirePermission(permission) {
    return (req, res, next) => {
      if (!config.auth?.enabled) {
        return next();
      }

      if (!req.auth?.permissions.includes(permission)) {
        return res.status(403).json({ error: `Permission '${permission}' required` });
      }
      next();
    };
  }

  static validateAgentAccess(req, res, next) {
    const { agentId } = req.method === 'GET' ? req.query : req.body;

    if (agentId === 'global' && !req.auth?.permissions.includes('global')) {
      return res.status(403).json({ error: 'Global access not permitted' });
    }

    next();
  }
}

module.exports = Auth;