export interface AclAction<Id = string> {
  _id?: Id;
  name: string;
  description?: string;
}

export interface AclRole<Id = string> {
  _id?: Id;
  name: string;
  description?: string;
  actions: string[];
}

export interface AclGrant<Id = string> {
  _id?: Id;
  resourceBusinessId?: string;
  friendlyName?: string;
  userId: string;
  resourceId?: string;
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
  resourceBusinessId?: string;
  resources: AclResource[];
}
