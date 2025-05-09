import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { Request, Response } from 'express';
import { JwtService } from './jwt.service';
import { ProcessedAuthData } from '..';
import { PathDefinition } from '../config/path-definition.config';

@Injectable()
export class HttpAuthHandlerService implements OnModuleInit {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService) {
  }

  onModuleInit() {
    this.authProviders = this.configService.get<HandlerAuthConfig[]>("auth-providers");
  }

  private authProviders: HandlerAuthConfig[];

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

  checkRoles(data: { [key: string]: any; }, path: PathDefinition): boolean {
    if (!path?.auth) return true;
    if (!path?.roles) return true;
    if (!data) return false;
    const authConfig = this.authProviders.find(o => o.name === path.auth);
    if (!authConfig) throw new Error(`Auth provider ${path.auth} not found`);
    const roles: string[] = data[authConfig.rolesClaim];
    if (!roles) return false;
    if (path.roles.all && path.roles.some) throw new Error("Path definition can't have both 'all' and 'some' roles");
    if (path.roles.all) return path.roles.all.every((role: string) => roles.includes(role));
    if (path.roles.some) return path.roles.some.some((role: string) => roles.includes(role));
  }
}
