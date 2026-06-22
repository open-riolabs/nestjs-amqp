// Actions & roles have NO id — `name` is the sole identity (the key).
export interface AclAction {
  name: string;
  description?: string;
}

export interface AclRole {
  name: string;
  description?: string;
  actions: string[];
}

export interface AclGrant<Id = string> {
  _id?: Id;
  userId: string;
  resourceId?: string;
  /** Part of the authorization decision: a grant authorizes a request only on an EXACT
   *  (companyId, resourceId) match (see grantMatchesResource). Also groups the resources by
   *  company in listResourcesByUser. */
  companyId?: string;
  friendlyName?: string;
  roles: string[];
}

/** A single resource a user can act on, with the flattened set of granted actions
 *  (legacy AccessControlResourceModel). */
export interface AclResource {
  resourceId?: string;
  actions: string[];
  friendlyName?: string;
}

/** Resources a user can access, grouped by business resource (returned by
 *  AclService.listResourcesByUser). */
export interface AclResourceGroup {
  /** The company the grouped resources belong to (grouping-only). */
  companyId?: string;
  resources: AclResource[];
}
