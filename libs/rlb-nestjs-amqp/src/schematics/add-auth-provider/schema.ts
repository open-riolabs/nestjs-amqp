/** Auth-provider verification strategy. Mirrors HandlerAuthConfig['type']. */
export type AuthProviderType = 'jwt' | 'jwks' | 'basic' | 'str-compare' | 'none';

export interface AddAuthProviderOptions {
  /** Provider name (the key gateway paths/events reference via `auth`). Prompted when omitted. */
  name?: string;
  /** Verification strategy. Default: jwks. */
  type?: AuthProviderType;
  /** Prefix for the identity headers the gateway forwards downstream. Default: X-GTW-AUTH-. */
  headerPrefix?: string;
  /** Claim whose value becomes the authenticated userId (drives the ACL/action gate). */
  uidClaim?: string;
  /** Claim→header maps as `src:dest` (jwt/jwks): which token claims are forwarded downstream. */
  jwtMap?: string[];
  /** Allowed signature algorithms (jwt/jwks) — REQUIRED to verify (algorithm-confusion guard). */
  algorithms?: string[];
  /** Expected token issuer (jwt/jwks). */
  issuer?: string;
  /** JWKS endpoint to fetch signing keys from (jwks). */
  jwksUri?: string;
  /** HMAC/shared secret (jwt with symmetric alg, or str-compare). */
  secret?: string;
  /** Expected token audience (jwt/jwks). */
  audience?: string;
  /** Client id (basic). */
  clientId?: string;
  /** Client secret / password (basic). */
  clientSecret?: string;
  /** Accept self-signed TLS when fetching the JWKS (jwks) — DEV ONLY. */
  httpsAllowUnauthorized?: boolean;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
