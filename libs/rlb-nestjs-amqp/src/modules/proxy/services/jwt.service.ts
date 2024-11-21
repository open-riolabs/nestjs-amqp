import { Injectable, Logger } from "@nestjs/common";
import { JwksClient } from "jwks-rsa";
import { JwtHeader, JwtPayload, SigningKeyCallback, verify } from "jsonwebtoken";
import { ConfigService } from "@nestjs/config";
import { AuthConfig } from "@rlb/nestjs-auth";
import { Agent } from "https";

@Injectable()
export class JwtService {

  private readonly jwksClient: JwksClient;
  private readonly authConfig: AuthConfig;
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService) {
    this.logger = new Logger(JwtService.name);
    this.authConfig = this.configService.get<AuthConfig>("auth");
    this.jwksClient = new JwksClient({
      jwksUri: this.authConfig.jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      requestAgent: new Agent({ rejectUnauthorized: false })
    });
  }

  verifyTokenJwks<T = JwtPayload>(token: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!token) {
        this.logger.debug("No token provided");
        resolve(undefined);
      }

      verify(token,
        (header: JwtHeader, callback: SigningKeyCallback) => {
          this.jwksClient.getSigningKey(header.kid, (err, key) => {
            if (err) {
              this.logger.debug("Error getting signing key", err);
              callback(err);
            } else {
              const signingKey = key.getPublicKey();
              callback(null, signingKey);
            }
          });
        },
        {
          issuer: this.authConfig.issuer,
          audience: this.authConfig.audience,
          algorithms: this.authConfig.algorithms as any
        },
        (err, decoded) => {
          if (err) {
            this.logger.debug("Error verifying token", err);
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }

  verifyTokenSecret<T = JwtPayload>(token: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!token) {
        this.logger.debug("No token provided");
        resolve(undefined);
      }

      verify(token,
        this.authConfig.secret,
        {
          issuer: this.authConfig.issuer,
          audience: this.authConfig.audience,
          algorithms: this.authConfig.algorithms as any
        },
        (err, decoded) => {
          if (err) {
            this.logger.debug("Error verifying token", err);
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }
}