import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Agent } from "https";
import { Algorithm, JwtHeader, JwtPayload, SigningKeyCallback, verify } from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";
import { HandlerAuthConfig } from "../../broker/config/handler-auth.config";
import { RLB_AMQP_AUTH_OPTIONS } from "../../broker/const";

@Injectable()
export class JwtService implements OnModuleInit {

  private readonly jwksClients: { [name: string]: JwksClient; };
  private readonly logger: Logger;

  constructor(@Inject(RLB_AMQP_AUTH_OPTIONS) private readonly authConfig: HandlerAuthConfig[]) {
    this.logger = new Logger(JwtService.name);
    this.jwksClients = {};
  }

  onModuleInit() {
    for (const cfg of this.authConfig || []) {
      if (cfg.type === "jwks") {
        this.jwksClients[cfg.name] = new JwksClient({
          jwksUri: cfg.jwksUri,
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
          requestAgent: new Agent({ rejectUnauthorized: cfg.httpsAllowUnauthorized !== true })
        });
      }
      // Fail-fast visibility for insecure / incomplete provider configs.
      this.validateProviderConfig(cfg);
    }
  }

  /** Logs misconfigurations that would otherwise fail silently or fail-open. */
  private validateProviderConfig(cfg: HandlerAuthConfig) {
    if (cfg.type === 'jwt' || cfg.type === 'jwks') {
      if (!cfg.algorithms?.length) {
        this.logger.error(`[${cfg.name}] 'algorithms' is required for ${cfg.type}; token verification will be DENIED until set (prevents algorithm-confusion attacks).`);
      } else if (cfg.type === 'jwks' && cfg.algorithms.some(a => this.isSymmetricOrNone(a))) {
        this.logger.error(`[${cfg.name}] jwks must only allow asymmetric algorithms (RS*/ES*/PS*); HS*/none are rejected (prevents RS->HS key-confusion).`);
      } else if (cfg.algorithms.some(a => /^none$/i.test(a))) {
        this.logger.error(`[${cfg.name}] the 'none' algorithm is not allowed.`);
      }
      if (cfg.type === 'jwt' && !cfg.secret) {
        this.logger.error(`[${cfg.name}] jwt provider has no 'secret'; verification will be denied.`);
      }
      if (!cfg.jwtMap) {
        this.logger.warn(`[${cfg.name}] no 'jwtMap' configured: all token claims will be forwarded unmapped (over-exposure). Define jwtMap.`);
      }
    }
    if (cfg.type === 'str-compare' && !cfg.secret) {
      this.logger.warn(`[${cfg.name}] str-compare provider has no 'secret'; it will PASS THROUGH every request as authenticated (provider effectively open).`);
    }
    if (cfg.type === 'basic' && !cfg.clientSecret) {
      this.logger.warn(`[${cfg.name}] basic provider has no 'clientSecret'; it will PASS THROUGH every request as authenticated (provider effectively open).`);
    }
  }

  private isSymmetricOrNone(alg: string): boolean {
    return /^hs/i.test(alg) || /^none$/i.test(alg);
  }

  /**
   * Returns the allowed algorithms for a provider, or null when the config is
   * unsafe (missing list, 'none', or symmetric algorithms on a jwks provider).
   * Returning null makes verification fail-closed.
   */
  private resolveAlgorithms(cfg: HandlerAuthConfig, requireAsymmetric: boolean): Algorithm[] | null {
    const algs = cfg.algorithms as Algorithm[] | undefined;
    if (!algs?.length) {
      this.logger.error(`[${cfg.name}] missing 'algorithms'; denying token verification.`);
      return null;
    }
    if (algs.some(a => /^none$/i.test(a))) {
      this.logger.error(`[${cfg.name}] the 'none' algorithm is not allowed.`);
      return null;
    }
    if (requireAsymmetric && algs.some(a => /^hs/i.test(a))) {
      this.logger.error(`[${cfg.name}] symmetric (HS*) algorithms are not allowed for jwks.`);
      return null;
    }
    return algs;
  }

  verifyTokenJwks<T = JwtPayload>(authConfig: HandlerAuthConfig, token: string): Promise<T | undefined> {
    if (!authConfig) {
      this.logger.warn("No auth config provided for JWT verification");
      return Promise.resolve(undefined);
    }
    if (!this.jwksClients[authConfig.name]) {
      this.logger.warn(`No jwks client found for ${authConfig.name}`);
      return Promise.resolve(undefined);
    }

    const algorithms = this.resolveAlgorithms(authConfig, true);
    if (!algorithms) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      if (!token) {
        this.logger.warn("No token provided for JWT verification");
        resolve(undefined);
        return;
      }

      verify(token,
        (header: JwtHeader, callback: SigningKeyCallback) => {
          this.jwksClients[authConfig.name].getSigningKey(header.kid, (err, key) => {
            if (err) {
              this.logger.error(`[JWKS] [${authConfig.name}] Error getting signing key`, err);
              callback(err);
            } else {
              const signingKey = key.getPublicKey();
              callback(null, signingKey);
            }
          });
        },
        {
          issuer: authConfig.issuer,
          audience: authConfig.audience,
          algorithms,
        },
        (err, decoded) => {
          if (err) {
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }

  verifyTokenSecret<T = JwtPayload>(authConfig: HandlerAuthConfig, token: string): Promise<T | undefined> {
    if (!authConfig) {
      return Promise.resolve(undefined);
    }
    if (!authConfig.secret) {
      this.logger.error(`[${authConfig.name}] jwt provider has no 'secret'; denying.`);
      return Promise.resolve(undefined);
    }

    const algorithms = this.resolveAlgorithms(authConfig, false);
    if (!algorithms) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      if (!token) {
        resolve(undefined);
        return;
      }

      verify(token,
        authConfig.secret,
        {
          issuer: authConfig.issuer,
          audience: authConfig.audience,
          algorithms,
        },
        (err, decoded) => {
          if (err) {
            resolve(undefined);
            return;
          }
          resolve(decoded as T);
        });
    });
  }
}
