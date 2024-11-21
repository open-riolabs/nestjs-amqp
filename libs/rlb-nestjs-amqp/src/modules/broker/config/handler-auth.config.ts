import { AuthConfig } from "@rlb/nestjs-auth";

export interface HandlerAuthConfig extends AuthConfig {
  jwtSignMode: 'secret' | 'jwks';
  rolesClaim: any;
  jwtMap?: string[];
  outProp: string;
  headerPrefix: string;
}