import { Inject, Injectable, Optional } from '@nestjs/common';
import { Request } from 'express';
import { ProcessedAuthData } from '..';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { RLB_AMQP_AUTH_OPTIONS } from '../../broker/const';
import { PathDefinition } from '../config/path-definition.config';
import { IAclRoleService, RLB_GTW_ACL_ROLE_SERVICE } from './acl.service';
import { JwtService } from './jwt.service';

@Injectable()
export class HttpAuthHandlerService {
  constructor(
    @Optional() @Inject(RLB_GTW_ACL_ROLE_SERVICE) private readonly aclRoleService: IAclRoleService,
    @Inject(RLB_AMQP_AUTH_OPTIONS) private readonly authProviders: HandlerAuthConfig[],
    private readonly jwtService: JwtService) {
  }

  async processAuthData(req: Request, path: PathDefinition): Promise<ProcessedAuthData> {

    let out: ProcessedAuthData = { success: false };
    if (!path?.auth) return out;
    const authConfig = this.authProviders.find(o => o.name === path.auth);
    if (!authConfig) throw new Error(`Auth provider ${path.auth} not found`);

    switch (authConfig.type) {
      case 'basic': out = await this.checkBasicAuth(req, authConfig); break;
      case 'jwt': out = await this.checkJwt(req, authConfig); break;
      case 'jwks': out = await this.checkJwt(req, authConfig); break;
      case 'str-compare': await this.checkStringCompare(req, authConfig); break;
      default:
        break;
    }
    return out;
  }

  async checkJwt(req: Request, authConfig: HandlerAuthConfig) {
    let decoded: any;
    let out: ProcessedAuthData = { success: false };
    const jwt = req.headers.authorization?.split(" ")[1];
    if (!jwt) return out;
    if (authConfig.type === 'jwt') {
      decoded = await this.jwtService.verifyTokenSecret(authConfig, jwt);
    }
    if (authConfig.type === 'jwks') {
      decoded = await this.jwtService.verifyTokenJwks(authConfig, jwt);
    }
    if (!decoded) {
      return out;
    } else {
      if (!authConfig.jwtMap) {
        out = decoded;
        out.success = true;
      } else {
        authConfig.jwtMap.map(o => o.split(':')).forEach(([source, dest]) => {
          if (decoded?.[source])
            out[`${authConfig.headerPrefix}${dest.trim().toUpperCase()}`] = decoded?.[source];
        });
        out.success = true;
      }
      return out;
    }
  }

  async checkBasicAuth(req: Request, authConfig: HandlerAuthConfig) {
    let out: ProcessedAuthData = { success: false };
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return out;
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username === authConfig.clientId && password === authConfig.clientSecret) {
      out[`${authConfig.headerPrefix}USERNAME`] = username;
      out.success = true;
      return out;
    }

    return out;
  }

  async checkStringCompare(req: Request, authConfig: HandlerAuthConfig) {
    let out: ProcessedAuthData = { success: false };
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith(authConfig.headerPrefix)) {
      return out;
    }

    const token = authHeader.substring(authConfig.headerPrefix.length).trim();
    if (token === authConfig.secret) {
      out[`${authConfig.headerPrefix}TOKEN`] = token;
      out.success = true;
      return out;
    }

    return out;
  }

  async checkRoles(data: { [key: string]: any; }, path: PathDefinition): Promise<boolean> {
    if (!path?.auth) return true;
    if (!path?.roles) return true;
    const authConfig = this.authProviders.find(o => o.name === path.auth);
    if (!authConfig) throw new Error(`Auth provider ${path.auth} not found`);
    if (authConfig.type !== 'jwt' && authConfig.type !== 'jwks') throw new Error(`Auth provider ${path.auth} is not a JWT or JWKS provider`);
    if (!authConfig.usernameClaim) throw new Error(`Auth provider ${path.auth} has no username claim defined`);
    if (!authConfig.aclTopic) throw new Error(`Auth provider ${path.auth} has no ACL topic defined`);
    if (!authConfig.aclAction) throw new Error(`Auth provider ${path.auth} has no ACL action defined`);
    if (!this.aclRoleService) throw new Error(`ACL Role Service not found. Please check AppModule.`);
    if (!data) return false;
    const userId = data[`${authConfig.headerPrefix}${authConfig.uidClaim}`];
    if (!userId) return false;
    const canUserDo = await this.aclRoleService.canUserDo(authConfig.aclTopic, authConfig.aclAction, userId);
    return canUserDo;
  }
}
