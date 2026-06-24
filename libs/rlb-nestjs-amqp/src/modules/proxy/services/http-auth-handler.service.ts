import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Request } from 'express';
import { ProcessedAuthData } from '..';
import { AclResourceContext } from '../../acl/auth-match';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { RLB_AMQP_AUTH_OPTIONS } from '../../broker/const';
import { PathDefinition } from '../config/path-definition.config';
import { IAclRoleService, RLB_GTW_ACL_ROLE_SERVICE } from './acl.service';
import { JwtService } from './jwt.service';

@Injectable()
export class HttpAuthHandlerService {

  private readonly logger = new Logger(HttpAuthHandlerService.name);

  constructor(
    @Optional() @Inject(RLB_GTW_ACL_ROLE_SERVICE) private readonly aclRoleService: IAclRoleService,
    @Inject(RLB_AMQP_AUTH_OPTIONS) private readonly authProviders: HandlerAuthConfig[],
    private readonly jwtService: JwtService) {
  }

  async processAuthData(req: Request, path: PathDefinition): Promise<ProcessedAuthData> {

    let out: ProcessedAuthData = { success: false };
    if (!path?.auth) return out;
    const authConfig = this.authProviders.find(o => o.name === path.auth);
    // Unknown provider is a misconfiguration: fail closed (success:false) instead of
    // throwing, so the request gets a predictable 401 rather than crashing the handler.
    // The mistake is surfaced loudly at boot by HttpHandlerService.registerPath().
    if (!authConfig) {
      this.logger.error(`Auth provider '${path.auth}' referenced by path '${path.name || path.path}' is not configured; denying request (401).`);
      return out;
    }

    switch (authConfig.type) {
      case 'basic': out = await this.checkBasicAuth(req, authConfig); break;
      case 'jwt': out = await this.checkJwt(req, authConfig); break;
      case 'jwks': out = await this.checkJwt(req, authConfig); break;
      case 'str-compare': out = await this.checkStringCompare(req, authConfig); break;
      default:
        break;
    }
    return out;
  }

  /** Returns the configured auth provider by name, or undefined. */
  findProvider(name: string): HandlerAuthConfig | undefined {
    return this.authProviders.find(o => o.name === name);
  }

  /** Verifies a raw JWT against a provider, returning the decoded payload or undefined. */
  async verifyToken(authConfig: HandlerAuthConfig, token: string): Promise<any | undefined> {
    if (!token) return undefined;
    if (authConfig.type === 'jwt') {
      return this.jwtService.verifyTokenSecret(authConfig, token);
    }
    if (authConfig.type === 'jwks') {
      return this.jwtService.verifyTokenJwks(authConfig, token);
    }
    return undefined;
  }

  /** Maps a decoded JWT payload to header-prefixed claims using the provider's jwtMap. */
  mapClaims(authConfig: HandlerAuthConfig, decoded: any): ProcessedAuthData {
    if (!decoded) return { success: false };
    // Fail-safe when no jwtMap is configured: the token is valid (success:true) but we
    // forward NO claims. Without an explicit map the keys would be the raw, unprefixed
    // claim names (not the X-GTW-AUTH-* contract the microservices read) — i.e. pure
    // over-exposure of the whole JWT payload. Declare jwtMap to forward identity headers.
    // (JwtService already warns about a missing jwtMap at boot.)
    if (!authConfig.jwtMap) {
      return { success: true };
    }
    const out: ProcessedAuthData = { success: true };
    authConfig.jwtMap.map(o => o.split(':')).forEach(([source, dest]) => {
      if (decoded?.[source])
        out[`${authConfig.headerPrefix}${dest.trim().toUpperCase()}`] = decoded?.[source];
    });
    return out;
  }

  async checkJwt(req: Request, authConfig: HandlerAuthConfig) {
    const jwt = req.headers.authorization?.split(" ")[1];
    const decoded = await this.verifyToken(authConfig, jwt);
    return this.mapClaims(authConfig, decoded);
  }

  /**
   * Action-based ACL check from already-mapped claims (also used by WebSocket events). True when
   * the identity behind `claims` holds at least one of `actions` on the request's (companyId,
   * resourceId) in `ctx` (exact match via `checkAction`). `ctx === undefined` ⇒ resource-agnostic
   * (WS events carry no resource). No actions required ⇒ authorized.
   */
  async checkActionsForClaims(authConfig: HandlerAuthConfig, claims: { [key: string]: any; }, actions?: string | string[], ctx?: AclResourceContext): Promise<boolean> {
    const list = Array.isArray(actions) ? actions : (actions ? [actions] : []);
    if (!list.length) return true;
    // Misconfiguration → log loudly and DENY (403). Never throw: a thrown error here escapes the
    // route handler as an unhandled rejection → a generic 500 (or worse, a hang). Denying keeps
    // the gateway predictable while the boot-time validation + this log point at the fix.
    if (authConfig.type !== 'jwt' && authConfig.type !== 'jwks') {
      this.logger.error(`Auth provider '${authConfig.name}' is not a JWT/JWKS provider; cannot run authorization checks → denying.`);
      return false;
    }
    if (!authConfig.uidClaim) {
      this.logger.error(`Auth provider '${authConfig.name}' has no 'uidClaim' configured; cannot identify the user → denying. Set uidClaim (e.g. USERID).`);
      return false;
    }
    if (!this.aclRoleService) {
      this.logger.error(`ACL service not found (RLB_GTW_ACL_ROLE_SERVICE not registered) but a path requires actions → denying.`);
      return false;
    }
    if (!claims) return false;
    const userId = claims[`${authConfig.headerPrefix}${authConfig.uidClaim}`];
    if (!userId) return false;
    return this.aclRoleService.checkAction(userId, ctx, list);
  }

  async checkBasicAuth(req: Request, authConfig: HandlerAuthConfig) {
    let out: ProcessedAuthData = { success: false };
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return out;
    }

    // Pass-through: a basic provider without a configured clientSecret is treated
    // as open (success) by design — it disables the credential check for this provider.
    if (!authConfig.clientSecret) {
      this.logger.warn(`Auth provider ${authConfig.name} (basic) has no clientSecret configured; passing through as authenticated.`);
      out.success = true;
      return out;
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (password === authConfig.clientSecret && (!authConfig.clientId || (authConfig.clientId && username === authConfig.clientId))) {
      out[`${authConfig.headerPrefix}USERNAME`] = username;
      out[`${authConfig.headerPrefix}USERID`] = username;
      out.success = true;
      return out;
    }

    return out;
  }

  async checkStringCompare(req: Request, authConfig: HandlerAuthConfig) {
    let out: ProcessedAuthData = { success: false };
    const authHeader = req.headers.authorization;
    // Pass-through: a str-compare provider without a configured secret is treated
    // as open (success) by design — it disables the token check for this provider.
    if (!authConfig.secret) {
      out.success = true;
      this.logger.warn(`Auth provider ${authConfig.name} (str-compare) has no secret configured; passing through as authenticated.`);
      return out;
    }

    if (authConfig.secret && !authConfig.headerPrefix) {
      this.logger.error("Missing field 'header prefix' in " + authConfig.name);
      return out;
    }

    if (authHeader === authConfig.secret) {
      out[`${authConfig.headerPrefix}TOKEN`] = authHeader;
      out.success = true;
      return out;
    }

    return out;
  }

  /** The (companyId, resourceId) the request targets — the canonical fields, read params-first then
   *  query then body, mirroring how the gateway forwards them to the microservice (where
   *  @BrokerParam('body', 'companyId'/'resourceId') reads them back). */
  extractResourceContext(req: Request): AclResourceContext {
    return {
      companyId: (req.params as any)?.companyId ?? (req.query as any)?.companyId ?? (req.body as any)?.companyId,
      resourceId: (req.params as any)?.resourceId ?? (req.query as any)?.resourceId ?? (req.body as any)?.resourceId,
    };
  }

  /**
   * Gateway authorization for an HTTP path. Authorized (no-op) when the path declares no `auth` or
   * no `actions`; otherwise the caller must hold one of `path.actions` on the request's `ctx`
   * (companyId, resourceId) — exact match, no wildcard.
   */
  async checkActions(data: { [key: string]: any; }, path: PathDefinition, ctx?: AclResourceContext): Promise<boolean> {
    if (!path?.actions?.length) return true;
    // Actions declared but no auth provider to identify the caller: fail closed (deny), since
    // there is no userId to evaluate against the ACL. A path that enforces actions MUST declare
    // `auth` (mirrors the WebSocket event behaviour).
    if (!path?.auth) return false;
    const authConfig = this.authProviders.find(o => o.name === path.auth);
    if (!authConfig) {
      this.logger.error(`Path '${path.name || path.path}' references unknown auth provider '${path.auth}' → denying authorization check.`);
      return false;
    }
    return this.checkActionsForClaims(authConfig, data, path.actions, ctx);
  }
}
