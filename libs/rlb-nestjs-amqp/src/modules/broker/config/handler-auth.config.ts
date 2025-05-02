import { AuthConfig } from "@sicilyaction/lib-nestjs-auth";

export interface HandlerAuthConfig extends AuthConfig {
  name: string;
  type: 'jwt' | 'jwks' | 'basic' | 'str-compare' | 'none';
  rolesClaim: any;
  jwtMap?: string[];
  outProp: string;
  headerPrefix: string;
}
