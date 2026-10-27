const { AuditLog } = require('../models');

/** Records a privileged action. Never throws (an audit failure must not mask the action's result). */
async function audit(req, action, { entity, entityId, reason, meta } = {}) {
  try {
    await AuditLog.create({
      actorId: req?.user?._id,
      actorRole: req?.user?.role,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      reason,
      meta,
      ip: req?.ip,
    });
  } catch (e) {
    console.error('[audit] failed to write audit log', action, e.message);
  }
}

module.exports = { audit };
