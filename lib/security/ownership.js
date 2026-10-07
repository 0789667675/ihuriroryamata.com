const buildOwnerScope = (ownerUserId) => `owner_user_id = ${Number(ownerUserId)}`;

const assertUserCanAccessOwnerScopedResource = ({ actorId, ownerUserId, resourceName = 'resource', actorRole = 'user', superAdminAllowed = false }) => {
  const targetOwnerId = Number(ownerUserId);
  const actor = Number(actorId);

  if (resourceName === 'platform-admin' && actorRole !== 'super_admin') {
    throw new Error(`Permission denied for ${resourceName}.`);
  }

  if (actorRole === 'super_admin' && superAdminAllowed) {
    return true;
  }

  if (actorRole === 'super_admin' && resourceName === 'platform-admin') {
    return true;
  }

  if (actor === targetOwnerId) {
    return true;
  }

  throw new Error(`${resourceName} does not have access for the current user.`);
};

module.exports = {
  buildOwnerScope,
  assertUserCanAccessOwnerScopedResource,
};
