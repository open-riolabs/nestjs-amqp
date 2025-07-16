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
  aclTopic: string;
  aclAction: string;
  jwtMap?: string[];
  headerPrefix: string;
}
