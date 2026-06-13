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
