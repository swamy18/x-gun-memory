const config = require('../config-loader');

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
    if (!config.auth?.enabled) {
      return next();
    }

    const { agentId } = req.method === 'GET' ? req.query : req.body;
    const callerAgentId = req.headers['x-agent-id'] || req.body?.callerAgentId || req.query?.callerAgentId;
    const allowGlobalWrites = config.agents?.allowGlobalWrites || [];

    const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (agentId === 'global' && !req.auth?.permissions.includes('global')) {
      if (!isWriteMethod) {
        return res.status(403).json({ error: 'Global access not permitted' });
      }
      if (!callerAgentId || !allowGlobalWrites.includes(callerAgentId)) {
        return res.status(403).json({
          error: 'Global writes require global permission or allowed caller agent'
        });
      }
    }

    next();
  }
}

module.exports = Auth;
