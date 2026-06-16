export interface AuthConfig {
  issuer: string;
  audience?: string;
  algorithms?: string[];
  secret?: string;
  jwksUri?: string;
  httpsAllowUnauthorized?: boolean;
  clientSecret?: string;
  clientId?: string;
  scopes?: string[];
  tokenUrl?: string;
}

export interface HandlerAuthConfig extends AuthConfig {
  name: string;
  type: 'jwt' | 'jwks' | 'basic' | 'str-compare' | 'none';
  usernameClaim: string;
  uidClaim: string;
  /**
   * @deprecated No longer used. The gateway role check is role-based and runs in-process
   * via `IAclRoleService.canUserDoGtw(path.roles, userId)` — it does not RPC a topic/action.
   * Kept optional only for backward compatibility with existing configs.
   */
  aclTopic?: string;
  /** @deprecated No longer used — see {@link aclTopic}. */
  aclAction?: string;
  jwtMap?: string[];
  headerPrefix: string;
}
