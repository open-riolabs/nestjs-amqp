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

// Concrete in-memory repositories (this example has no external DB). They are bound to the
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
 * Pure in-RAM data layer for this example — no Mongoose, no external DB. Global so the concrete
 * classes are visible where they are aliased onto the abstract contracts in AppModule.
 */
@Global()
@Module({
  providers: [...REPOSITORIES],
  exports: [...REPOSITORIES],
})
export class DatabaseModule { }
