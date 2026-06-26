import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { RLB_AMQP_AUTH_OPTIONS } from '../../broker/const';
import { JwtService } from './jwt.service';

/** DI token for the DB auth-provider source. The app wires it to its `AuthProviderRepository`
 *  (which already exposes `listEnabled()`), e.g. `{ provide: RLB_GTW_AUTH_PROVIDER_SOURCE, useExisting:
 *  MongoAuthProviderRepository }`. Optional: a YAML-only gateway leaves it unbound. */
export const RLB_GTW_AUTH_PROVIDER_SOURCE = 'RLB_GTW_AUTH_PROVIDER_SOURCE';

/** What the registry needs from the DB layer: the currently enabled auth-providers. */
export interface IAuthProviderSource {
  listEnabled(): Promise<HandlerAuthConfig[]>;
}

/**
 * Holds the gateway's CURRENT auth-providers in RAM. The set = static YAML providers
 * ({@link RLB_AMQP_AUTH_OPTIONS}) + the DB-stored providers read from the optional
 * {@link RLB_GTW_AUTH_PROVIDER_SOURCE}, DB overriding YAML by `name` (YAML-only and DB-only are both
 * kept). `HttpAuthHandlerService` resolves providers through here.
 *
 * DB auth-providers are managed only via the admin UI; **activating a change is an EXPLICIT choice**.
 * `reload()` re-reads the DB and swaps RAM atomically. It is loaded once at boot, then re-run ONLY on
 * the dedicated `gw-auth-reload` control action (e.g. POST /admin/auth/reload) — NOT by the route
 * reload (`gw-reload`) and NOT automatically on CRUD. Atomic swap; never throws.
 */
@Injectable()
export class AuthProviderRegistry {
  private readonly logger = new Logger(AuthProviderRegistry.name);
  private readonly yaml: HandlerAuthConfig[];
  private current: HandlerAuthConfig[];

  constructor(
    @Inject(RLB_AMQP_AUTH_OPTIONS) yamlProviders: HandlerAuthConfig[] | undefined,
    @Optional() @Inject(RLB_GTW_AUTH_PROVIDER_SOURCE) private readonly source: IAuthProviderSource | undefined,
    private readonly jwt: JwtService,
  ) {
    this.yaml = Array.isArray(yamlProviders) ? yamlProviders : [];
    this.current = this.yaml;
  }

  /** The provider for `name` from the current (merged) set, or undefined. */
  find(name?: string): HandlerAuthConfig | undefined {
    return name ? this.current.find((p) => p?.name === name) : undefined;
  }

  /** The current merged provider set. */
  list(): HandlerAuthConfig[] {
    return this.current;
  }

  /**
   * Re-read the DB providers (if a source is wired) and rebuild the set = YAML + DB (DB overrides YAML
   * by name). Atomic swap; never throws (keeps the current set on failure). Invalidates the JWKS client
   * cache so an updated jwksUri/config takes effect. Returns the resulting provider count.
   */
  async reload(): Promise<number> {
    let db: HandlerAuthConfig[] = [];
    if (this.source) {
      try {
        db = (await this.source.listEnabled()) || [];
      } catch (e) {
        this.logger.warn(`[auth-reload] failed to read DB auth-providers: ${(e as Error)?.message}. Keeping current set (${this.current.length}).`);
        return this.current.length;
      }
    }
    const byName = new Map<string, HandlerAuthConfig>();
    for (const p of this.yaml) if (p?.name) byName.set(p.name, p); // YAML baseline
    for (const p of db) if (p?.name) byName.set(p.name, p);        // DB overrides by name
    this.current = [...byName.values()];
    this.jwt.resetClients();
    this.logger.log(`[auth-reload] providers ready: ${this.current.length} (yaml=${this.yaml.length}, db=${db.length})`);
    return this.current.length;
  }
}
