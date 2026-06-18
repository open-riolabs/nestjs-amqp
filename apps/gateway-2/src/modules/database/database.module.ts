import { Global, Module } from '@nestjs/common';
import {
  InMemoryAclActionRepository,
  InMemoryAclGrantRepository,
  InMemoryAclRoleRepository,
} from './repository/acl.repository';
import {
  InMemoryAuthProviderRepository,
  InMemoryHttpMetricRepository,
  InMemoryHttpPathRepository,
} from './repository/gateway.repository';
import { InMemoryRouteSyncLogRepository } from './repository/route-sync.repository';

// Concrete in-memory repositories (the example has no external DB). They are bound to the
// lib's abstract repository tokens in app.module via `useExisting`.
const REPOSITORIES = [
  InMemoryAclActionRepository,
  InMemoryAclRoleRepository,
  InMemoryAclGrantRepository,
  InMemoryHttpPathRepository,
  InMemoryAuthProviderRepository,
  InMemoryHttpMetricRepository,
  InMemoryRouteSyncLogRepository,
];

/**
 * Data layer for this example: pure in-RAM repositories that simulate the persistence
 * behavior the ACL / gateway-admin modules expect — no Mongoose, no external DB. Global
 * so the concrete classes are visible where they're aliased onto the abstract contracts.
 */
@Global()
@Module({
  providers: [...REPOSITORIES],
  exports: [...REPOSITORIES],
})
export class DatabaseModule { }
