const { query, getPool } = require('../postgres.js');

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const requestFields = `r.id, r.dairy_user_id, r.collector_user_id, r.requested_by, r.requested_at,
  r.request_note, r.status, r.decided_by, r.decided_at, r.decision_note,
  r.approved_assignment_id, r.created_at, r.updated_at,
  du.name AS dairy_name, du.email AS dairy_email, du.phone AS dairy_phone,
  cu.name AS collector_name, cu.email AS collector_email, cu.phone AS collector_phone,
  cu.account_number AS collector_account_number, cu.national_id AS collector_national_id`;

const isPositiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

const normalizeEmail = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

const isUniqueViolation = (error, constraints) => error.code === '23505'
  && (!error.constraint || constraints.includes(error.constraint));

const getAssignments = async (dairyUserId, centerId = null, sortDirection = 'asc', runQueryOverride = query) => {
  const centerFilter = centerId === null || centerId === undefined || centerId === '' ? null : Number(centerId);
  if (centerFilter !== null && (!Number.isSafeInteger(centerFilter) || centerFilter <= 0)) {
    throw Object.assign(new Error('Invalid collection center id.'), { statusCode: 400, code: 'INVALID_CENTER_ID' });
  }
  const operation = typeof sortDirection === 'function' ? sortDirection : runQueryOverride;
  const direction = typeof sortDirection === 'function' ? 'ASC' : sortDirection === 'desc' ? 'DESC' : 'ASC';
  const { rows } = await operation(
    `SELECT ca.id, ca.dairy_user_id, ca.collector_user_id, ca.created_at,
       u.name AS collector_name, u.national_id AS collector_national_id,
       u.account_number AS collector_account_number, u.phone AS collector_phone,
       u.account_type AS collector_account_type,
       COUNT(DISTINCT f.id)::integer AS abacunda_count
     FROM collector_assignments ca JOIN users u ON u.id = ca.collector_user_id
     LEFT JOIN collection_centers c ON (c.id = $2 AND c.owner_user_id = ca.dairy_user_id) OR $2::bigint IS NULL
     LEFT JOIN farmers f ON f.owner_user_id = ca.dairy_user_id AND f.collector_user_id = ca.collector_user_id
       AND ($2::bigint IS NULL OR LOWER(BTRIM(c.name)) = LOWER(BTRIM(COALESCE(NULLIF(f.collection_center, ''), f.location))))
     WHERE ($2::bigint IS NULL OR c.id IS NOT NULL) AND ca.dairy_user_id = $1 AND ca.revoked_at IS NULL
     GROUP BY ca.id, u.id ORDER BY LOWER(BTRIM(u.name)) ${direction}, u.id ASC`,
    [Number(dairyUserId), centerFilter]
  );
  return rows;
};

const insertAssignmentAudit = async (client, assignmentId, action, actorId, dairyId, details = {}) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('collector_assignment', $1, $2, $3::jsonb, $4, $5)`,
    [assignmentId, action, JSON.stringify(details), actorId, dairyId]
  );
};

const insertRequestAudit = async (client, requestId, action, actorId, dairyId, details = {}) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, details, changed_by, owner_user_id)
     VALUES ('collector_assignment_request', $1, $2, $3::jsonb, $4, $5)`,
    [requestId, action, JSON.stringify(details), actorId, dairyId]
  );
};

const lockUsers = async (client, userIds) => {
  const uniqueIds = [...new Set(userIds.map(Number))];
  const { rows } = await client.query(
    `SELECT id, name, email, account_type, account_status
     FROM users WHERE id = ANY($1::bigint[]) FOR UPDATE`,
    [uniqueIds]
  );
  return {
    rows,
    find: (id) => rows.find((user) => Number(user.id) === Number(id)) || null,
  };
};

const requireDairyAccount = (dairy, codePrefix = 'DAIRY') => {
  if (!dairy) throw Object.assign(new Error('That collection center account does not exist.'), { code: `${codePrefix}_NOT_FOUND`, statusCode: 404 });
  if (dairy.account_type !== 'COLLECTION_CENTER') {
    throw Object.assign(new Error('Only a COLLECTION_CENTER account can manage collector assignments.'), { code: 'NOT_A_DAIRY_ACCOUNT', statusCode: 403 });
  }
  if (dairy.account_status === 'suspended') {
    throw Object.assign(new Error('That collection center account is suspended.'), { code: 'DAIRY_ACCOUNT_SUSPENDED', statusCode: 403 });
  }
};

const requireCollectorAccount = (collector, codePrefix = 'COLLECTOR') => {
  if (!collector) throw Object.assign(new Error('That collector account does not exist.'), { code: `${codePrefix}_NOT_FOUND`, statusCode: 404 });
  if (collector.account_type !== 'COLLECTOR') {
    throw Object.assign(new Error('Only a COLLECTOR account can be linked.'), { code: 'NOT_A_COLLECTOR_ACCOUNT', statusCode: 403 });
  }
  if (collector.account_status === 'suspended') {
    throw Object.assign(new Error('That collector account is suspended.'), { code: 'COLLECTOR_ACCOUNT_SUSPENDED', statusCode: 403 });
  }
};

const assignmentConflict = (message = 'That collector is already linked to another collection center.') =>
  Object.assign(new Error(message), { code: 'COLLECTOR_ALREADY_ASSIGNED', statusCode: 409 });

const assertCollectorHasNoOtherAssignment = async (client, dairyId, collectorId) => {
  const { rows: activeAssignments } = await client.query(
    'SELECT id, dairy_user_id FROM collector_assignments WHERE collector_user_id = $1 AND revoked_at IS NULL LIMIT 1 FOR UPDATE',
    [collectorId]
  );
  if (!activeAssignments[0]) return null;
  if (Number(activeAssignments[0].dairy_user_id) !== Number(dairyId)) {
    throw assignmentConflict();
  }
  return activeAssignments[0];
};

const approveMatchingPendingRequest = async (client, { dairyId, collectorId, actorId, assignmentId, decisionNote }) => {
  const { rows } = await client.query(
    `UPDATE collector_assignment_requests
     SET status = 'approved', decided_by = $1, decided_at = NOW(),
         decision_note = COALESCE(decision_note, $2), approved_assignment_id = $3, updated_at = NOW()
     WHERE dairy_user_id = $4 AND collector_user_id = $5 AND status = 'pending'
     RETURNING id`,
    [actorId, decisionNote, assignmentId, dairyId, collectorId]
  );
  for (const request of rows) {
    await insertRequestAudit(client, request.id, 'approved', actorId, dairyId, { collectorUserId: collectorId, assignmentId });
  }
  return rows;
};

const cancelOtherPendingRequests = async (client, { collectorId, actorId, keepRequestId = null, note }) => {
  const { rows } = await client.query(
    `UPDATE collector_assignment_requests
     SET status = 'cancelled', decided_by = $1, decided_at = NOW(),
         decision_note = $2, updated_at = NOW()
     WHERE collector_user_id = $3 AND status = 'pending'
       AND ($4::bigint IS NULL OR id <> $4::bigint)
     RETURNING id, dairy_user_id`,
    [actorId, note, collectorId, keepRequestId]
  );
  for (const request of rows) {
    await insertRequestAudit(client, request.id, 'cancelled', actorId, request.dairy_user_id, {
      collectorUserId: Number(collectorId),
      reason: note,
    });
  }
  return rows;
};

const assignCollector = async ({ dairyUserId, collectorUserId, assignedBy, collectorEmail = null, poolProvider = getPool }) => {
  const dairyId = Number(dairyUserId);
  const collectorId = Number(collectorUserId);
  if (!isPositiveId(dairyId) || !isPositiveId(collectorId)) {
    throw Object.assign(new Error('A valid collector account is required.'), { code: 'INVALID_COLLECTOR_ID', statusCode: 400 });
  }
  if (dairyId === collectorId) throw Object.assign(new Error('A collection center cannot assign itself.'), { code: 'SELF_ASSIGNMENT', statusCode: 400 });
  const expectedEmail = normalizeEmail(collectorEmail);
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const users = await lockUsers(client, [dairyId, collectorId]);
    const dairy = users.find(dairyId);
    const collector = users.find(collectorId);
    requireDairyAccount(dairy);
    requireCollectorAccount(collector);
    if (expectedEmail && normalizeEmail(collector.email) !== expectedEmail) {
      throw Object.assign(new Error('The Collector account email does not match the requested account.'), {
        code: 'COLLECTOR_EMAIL_MISMATCH',
        statusCode: 409,
      });
    }

    const existing = await assertCollectorHasNoOtherAssignment(client, dairyId, collectorId);
    if (existing) {
      await approveMatchingPendingRequest(client, {
        dairyId,
        collectorId,
        actorId: Number(assignedBy) || dairyId,
        assignmentId: existing.id,
        decisionNote: 'Linked directly by the collection center.',
      });
      await cancelOtherPendingRequests(client, {
        collectorId,
        actorId: Number(assignedBy) || dairyId,
        note: 'Collector was linked to another collection center.',
      });
      await client.query('COMMIT');
      return {
        id: existing.id,
        dairy_user_id: dairyId,
        collector_user_id: collectorId,
      };
    }

    const { rows } = await client.query(
      `INSERT INTO collector_assignments (dairy_user_id, collector_user_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING id, dairy_user_id, collector_user_id, created_at`,
      [dairyId, collectorId, assignedBy]
    );
    await insertAssignmentAudit(client, rows[0].id, 'created', Number(assignedBy) || dairyId, dairyId, {
      collectorUserId: collectorId,
      verifiedEmail: Boolean(expectedEmail),
    });
    await approveMatchingPendingRequest(client, {
      dairyId,
      collectorId,
      actorId: Number(assignedBy) || dairyId,
      assignmentId: rows[0].id,
      decisionNote: 'Linked directly by the collection center.',
    });
    await cancelOtherPendingRequests(client, {
      collectorId,
      actorId: Number(assignedBy) || dairyId,
      note: 'Collector was linked to another collection center.',
    });
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error, ['uq_collector_assignments_collector', 'uq_collector_assignments_active_collector', 'uq_collector_assignments_active_pair'])) {
      throw assignmentConflict();
    }
    throw error;
  } finally {
    client.release();
  }
};

const getRequestById = async (requestId, runQueryOverride = query) => {
  const { rows } = await runQueryOverride(
    `SELECT ${requestFields}
     FROM collector_assignment_requests r
     JOIN users du ON du.id = r.dairy_user_id
     JOIN users cu ON cu.id = r.collector_user_id
     WHERE r.id = $1`,
    [Number(requestId)]
  );
  return rows[0] || null;
};

const requestAssignment = async ({ dairyUserId, collectorUserId, requestedBy = collectorUserId, requestNote = null, poolProvider = getPool }) => {
  const dairyId = Number(dairyUserId);
  const collectorId = Number(collectorUserId);
  const requesterId = Number(requestedBy);
  if (!isPositiveId(dairyId)) throw Object.assign(new Error('A valid collection center account is required.'), { code: 'INVALID_DAIRY_ID', statusCode: 400 });
  if (!isPositiveId(collectorId)) throw Object.assign(new Error('A valid collector account is required.'), { code: 'INVALID_COLLECTOR_ID', statusCode: 400 });
  if (!isPositiveId(requesterId)) throw Object.assign(new Error('A valid requester is required.'), { code: 'INVALID_REQUESTER_ID', statusCode: 400 });
  if (requesterId !== collectorId) {
    throw Object.assign(new Error('Only the Collector can request their own assignment.'), { code: 'REQUESTER_MISMATCH', statusCode: 403 });
  }
  if (dairyId === collectorId) throw Object.assign(new Error('A collection center cannot assign itself.'), { code: 'SELF_ASSIGNMENT', statusCode: 400 });

  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const users = await lockUsers(client, [dairyId, collectorId]);
    requireDairyAccount(users.find(dairyId));
    requireCollectorAccount(users.find(collectorId));

    const active = await assertCollectorHasNoOtherAssignment(client, dairyId, collectorId);
    if (active) {
      throw assignmentConflict(Number(active.dairy_user_id) === dairyId
        ? 'That Collector is already linked to this collection center.'
        : 'That Collector is already linked to another collection center.');
    }

    const { rows: pending } = await client.query(
      `SELECT id FROM collector_assignment_requests
       WHERE dairy_user_id = $1 AND collector_user_id = $2 AND status = 'pending' LIMIT 1`,
      [dairyId, collectorId]
    );
    if (pending[0]) {
      throw Object.assign(new Error('A pending request already exists for this collection center.'), {
        code: 'REQUEST_ALREADY_PENDING',
        statusCode: 409,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO collector_assignment_requests (dairy_user_id, collector_user_id, requested_by, request_note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, dairy_user_id, collector_user_id, requested_by, requested_at, request_note, status`,
      [dairyId, collectorId, requesterId, requestNote]
    );
    await insertRequestAudit(client, rows[0].id, 'requested', requesterId, dairyId, {
      collectorUserId: collectorId,
      requestNote: requestNote || null,
    });
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error, ['uq_collector_assignment_requests_pending_pair'])) {
      throw Object.assign(new Error('A pending request already exists for this collection center.'), {
        code: 'REQUEST_ALREADY_PENDING',
        statusCode: 409,
      });
    }
    throw error;
  } finally {
    client.release();
  }
};

const getCollectorRequests = async ({ collectorUserId, status = null, runQueryOverride = query }) => {
  const collectorId = Number(collectorUserId);
  if (!isPositiveId(collectorId)) throw Object.assign(new Error('Invalid collector id.'), { code: 'INVALID_COLLECTOR_ID', statusCode: 400 });
  const normalizedStatus = status && REQUEST_STATUSES.includes(status) ? status : null;
  const { rows } = await runQueryOverride(
    `SELECT ${requestFields}
     FROM collector_assignment_requests r
     JOIN users du ON du.id = r.dairy_user_id
     JOIN users cu ON cu.id = r.collector_user_id
     WHERE r.collector_user_id = $1 AND ($2::text IS NULL OR r.status = $2::text)
     ORDER BY r.requested_at DESC, r.id DESC`,
    [collectorId, normalizedStatus]
  );
  return rows;
};

const getDairyRequests = async ({ dairyUserId, status = 'pending', runQueryOverride = query }) => {
  const dairyId = Number(dairyUserId);
  if (!isPositiveId(dairyId)) throw Object.assign(new Error('Invalid collection center id.'), { code: 'INVALID_DAIRY_ID', statusCode: 400 });
  const normalizedStatus = !status || status === 'all' ? null : (REQUEST_STATUSES.includes(status) ? status : null);
  const { rows } = await runQueryOverride(
    `SELECT ${requestFields}
     FROM collector_assignment_requests r
     JOIN users du ON du.id = r.dairy_user_id
     JOIN users cu ON cu.id = r.collector_user_id
     WHERE r.dairy_user_id = $1 AND ($2::text IS NULL OR r.status = $2::text)
     ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at DESC, r.id DESC`,
    [dairyId, normalizedStatus]
  );
  return rows;
};

const decideRequest = async ({ requestId, dairyUserId, actorId = dairyUserId, decision, decisionNote = null, poolProvider = getPool }) => {
  const id = Number(requestId);
  const dairyId = Number(dairyUserId);
  const actor = Number(actorId) || dairyId;
  if (!isPositiveId(id)) throw Object.assign(new Error('Invalid request id.'), { code: 'INVALID_REQUEST_ID', statusCode: 400 });
  if (!isPositiveId(dairyId)) throw Object.assign(new Error('Invalid collection center id.'), { code: 'INVALID_DAIRY_ID', statusCode: 400 });
  if (!['approve', 'reject'].includes(decision)) throw Object.assign(new Error('Decision must be approve or reject.'), { code: 'INVALID_DECISION', statusCode: 400 });

  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    // Lock the two user rows first, matching assignCollector/requestAssignment.
    // This avoids a lock-order cycle between direct linking and request approval.
    const { rows: initialRequests } = await client.query(
      `SELECT id, dairy_user_id, collector_user_id, requested_by, status
       FROM collector_assignment_requests WHERE id = $1`,
      [id]
    );
    const initialRequest = initialRequests[0];
    if (!initialRequest || Number(initialRequest.dairy_user_id) !== dairyId) {
      throw Object.assign(new Error('That assignment request was not found.'), { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
    }

    const collectorId = Number(initialRequest.collector_user_id);
    const users = await lockUsers(client, [dairyId, collectorId]);
    requireDairyAccount(users.find(dairyId));
    requireCollectorAccount(users.find(collectorId));

    const { rows: requests } = await client.query(
      `SELECT id, dairy_user_id, collector_user_id, requested_by, status
       FROM collector_assignment_requests WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const request = requests[0];
    if (!request || Number(request.dairy_user_id) !== dairyId) {
      throw Object.assign(new Error('That assignment request was not found.'), { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
    }
    if (request.status !== 'pending') {
      throw Object.assign(new Error('That assignment request has already been decided.'), { code: 'REQUEST_ALREADY_DECIDED', statusCode: 409 });
    }

    if (decision === 'reject') {
      const { rows } = await client.query(
        `UPDATE collector_assignment_requests
         SET status = 'rejected', decided_by = $1, decided_at = NOW(), decision_note = $2, updated_at = NOW()
         WHERE id = $3 AND status = 'pending'
         RETURNING id, dairy_user_id, collector_user_id, requested_by, requested_at, request_note,
                   status, decided_by, decided_at, decision_note, approved_assignment_id, created_at, updated_at`,
        [actor, decisionNote, id]
      );
      await insertRequestAudit(client, id, 'rejected', actor, dairyId, { collectorUserId: collectorId, decisionNote: decisionNote || null });
      await client.query('COMMIT');
      return { request: rows[0], assignment: null };
    }

    const existing = await assertCollectorHasNoOtherAssignment(client, dairyId, collectorId);
    let assignment = existing;
    if (!existing) {
      const { rows } = await client.query(
        `INSERT INTO collector_assignments (dairy_user_id, collector_user_id, assigned_by)
         VALUES ($1, $2, $3) RETURNING id, dairy_user_id, collector_user_id, created_at`,
        [dairyId, collectorId, actor]
      );
      assignment = rows[0];
      await insertAssignmentAudit(client, assignment.id, 'created', actor, dairyId, {
        collectorUserId: collectorId,
        requestId: id,
      });
    }

    const { rows } = await client.query(
      `UPDATE collector_assignment_requests
       SET status = 'approved', decided_by = $1, decided_at = NOW(), decision_note = $2,
           approved_assignment_id = $3, updated_at = NOW()
       WHERE id = $4 AND status = 'pending'
       RETURNING id, dairy_user_id, collector_user_id, requested_by, requested_at, request_note,
                 status, decided_by, decided_at, decision_note, approved_assignment_id, created_at, updated_at`,
      [actor, decisionNote, assignment.id, id]
    );
    await cancelOtherPendingRequests(client, {
      collectorId,
      actorId: actor,
      keepRequestId: id,
      note: 'Collector was linked to another collection center.',
    });
    await insertRequestAudit(client, id, 'approved', actor, dairyId, {
      collectorUserId: collectorId,
      assignmentId: assignment.id,
      decisionNote: decisionNote || null,
    });
    await client.query('COMMIT');
    return { request: rows[0], assignment };
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error, ['uq_collector_assignments_collector', 'uq_collector_assignments_active_collector', 'uq_collector_assignments_active_pair'])) {
      throw assignmentConflict();
    }
    throw error;
  } finally {
    client.release();
  }
};

const cancelRequest = async ({ requestId, collectorUserId, actorId = collectorUserId, decisionNote = null, poolProvider = getPool }) => {
  const id = Number(requestId);
  const collectorId = Number(collectorUserId);
  const actor = Number(actorId) || collectorId;
  if (!isPositiveId(id)) throw Object.assign(new Error('Invalid request id.'), { code: 'INVALID_REQUEST_ID', statusCode: 400 });
  if (!isPositiveId(collectorId)) throw Object.assign(new Error('Invalid collector id.'), { code: 'INVALID_COLLECTOR_ID', statusCode: 400 });

  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const { rows: requests } = await client.query(
      `SELECT id, dairy_user_id, collector_user_id, status
       FROM collector_assignment_requests WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const request = requests[0];
    if (!request || Number(request.collector_user_id) !== collectorId) {
      throw Object.assign(new Error('That assignment request was not found.'), { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
    }
    if (request.status !== 'pending') {
      throw Object.assign(new Error('That assignment request has already been decided.'), { code: 'REQUEST_ALREADY_DECIDED', statusCode: 409 });
    }
    const { rows } = await client.query(
      `UPDATE collector_assignment_requests
       SET status = 'cancelled', decided_by = $1, decided_at = NOW(), decision_note = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id, dairy_user_id, collector_user_id, requested_by, requested_at, request_note,
                 status, decided_by, decided_at, decision_note, approved_assignment_id, created_at, updated_at`,
      [actor, decisionNote, id]
    );
    await insertRequestAudit(client, id, 'cancelled', actor, request.dairy_user_id, {
      collectorUserId: collectorId,
      decisionNote: decisionNote || null,
    });
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const closeAssignment = async ({ dairyUserId, collectorUserId, actorId, action = 'revoke', poolProvider = getPool }) => {
  const client = await poolProvider().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM collector_assignments WHERE dairy_user_id = $1 AND collector_user_id = $2 AND revoked_at IS NULL LIMIT 1 FOR UPDATE`,
      [dairyUserId, collectorUserId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      'UPDATE collector_assignments SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
      [rows[0].id]
    );
    const auditAction = action === 'suspend' ? 'suspended' : 'revoked';
    await insertAssignmentAudit(client, rows[0].id, auditAction, actorId, dairyUserId, {
      collectorUserId: Number(collectorUserId),
      action: auditAction,
    });
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const revokeAssignment = (input) => closeAssignment({ ...input, action: 'revoke' });

const suspendAssignment = (input) => closeAssignment({ ...input, action: 'suspend' });

module.exports = {
  REQUEST_STATUSES,
  getAssignments,
  assignCollector,
  revokeAssignment,
  suspendAssignment,
  requestAssignment,
  getCollectorRequests,
  getDairyRequests,
  getRequestById,
  decideRequest,
  cancelRequest,
};
