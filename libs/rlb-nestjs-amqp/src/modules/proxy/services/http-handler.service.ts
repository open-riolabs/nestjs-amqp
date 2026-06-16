import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { NextFunction, Request, Response, Router } from "express";
import { BrokerService } from "../../broker";
import { RLB_AMQP_APP_OPTIONS, RLB_AMQP_GATEWAY_OPTIONS } from "../../broker/const";
import { AppConfig, UtilsService } from "../../broker/services/utils.service";
import { GatewayConfig, PathDefinition } from "../config/path-definition.config";
import { HttpAuthHandlerService } from "./http-auth-handler.service";
import multer = require('multer');

@Injectable()
export class HttpHandlerService implements OnModuleInit {

  private server: ExpressAdapter;
  /** Swappable route table. Mounted once via a stable delegator; rebuilt on reload so
   *  routes can be added/modified/removed at runtime without restarting the process. */
  private dynamicRouter: Router | null = null;

  private readonly logger: Logger;
  private readonly multer: multer.Multer;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly broker: BrokerService,
    private readonly utils: UtilsService,
    private readonly httpAuthHandlerService: HttpAuthHandlerService,
    @Inject(RLB_AMQP_APP_OPTIONS) private readonly appConfig: AppConfig,
    @Inject(RLB_AMQP_GATEWAY_OPTIONS) private readonly gatewayConfig: GatewayConfig,
  ) {
    this.logger = new Logger(HttpHandlerService.name);
    this.multer = multer({
      storage: multer.memoryStorage(),
    });
  }

  async onModuleInit() {
    this.server = this.httpAdapterHost.httpAdapter.getInstance<ExpressAdapter>();
    // Mount a single stable delegator. The actual route table lives in `dynamicRouter`,
    // which `reload()` rebuilds and swaps atomically — so subsequent requests hit the
    // new table while in-flight ones finish on the old one.
    this.server.use((req: Request, res: Response, next: NextFunction) => {
      if (this.dynamicRouter) return this.dynamicRouter(req, res, next);
      next();
    });
    await this.reload();

    // Optional multi-instance reload: subscribe to a broadcast control topic so every
    // gateway instance rebuilds its routes when signalled (e.g. after a DB path CRUD).
    const reloadTopic = this.gatewayConfig.reloadTopic;
    if (reloadTopic) {
      try {
        await this.broker.registerHandler(reloadTopic, async () => {
          this.logger.log(`[RELOAD] signal received on '${reloadTopic}' — rebuilding routes`);
          await this.reload();
        });
        this.logger.log(`[RELOAD] listening for route-reload signals on topic '${reloadTopic}'`);
      } catch (error) {
        this.logger.warn(`[RELOAD] could not subscribe to reload topic '${reloadTopic}': ${error?.message}`);
      }
    }
  }

  /**
   * (Re)builds the Express route table from the YAML paths plus the DB-exported paths
   * (`gateway.loadConfig.paths`), then swaps it in atomically. Safe to call at runtime:
   * added paths appear, removed paths disappear, and modified paths are re-registered.
   * Returns the number of routes successfully registered.
   */
  async reload(): Promise<number> {
    const extPath: PathDefinition[] = [];
    if (this.gatewayConfig.loadConfig?.paths) {
      try {
        const o = await this.broker.requestData(this.gatewayConfig.loadConfig.paths.topic, this.gatewayConfig.loadConfig.paths.action, {});
        if (Array.isArray(o)) extPath.push(...o);
      } catch (error) {
        this.logger.warn(`[RELOAD] failed to pull DB paths (${this.gatewayConfig.loadConfig.paths.topic}/${this.gatewayConfig.loadConfig.paths.action}): ${error?.message}. Keeping YAML paths only.`);
      }
    }
    const paths = [...this.gatewayConfig?.paths || [], ...extPath];
    const router = Router();
    let ok = 0;
    for (const path of paths) {
      try {
        this.registerPath(path, router);
        ok++;
      } catch (error) {
        this.logger.error(`[RELOAD] skipping invalid path '${path?.name || path?.path}': ${error?.message}`);
      }
    }
    this.dynamicRouter = router;
    this.logger.log(`[RELOAD] routes ready: ${ok}/${paths.length} (yaml=${this.gatewayConfig?.paths?.length || 0}, db=${extPath.length})`);
    return ok;
  }

  /**
   * Registers one path. When `router` is omitted the path is appended live to the current
   * dynamic router (used by RemoteConfigService for pushed single-path config); reload()
   * passes the router it is building. Note: a subsequent reload() rebuilds from YAML+DB
   * and drops live-appended paths that aren't part of that config.
   */
  registerPath(path: PathDefinition, router?: Router) {
    if (!path.method) throw new Error("Method is required for path definition");
    if (!path.path) throw new Error("Path is required for path definition");
    if (!path.topic) throw new Error("Topic is required for path definition");
    if (!path.mode) throw new Error("Mode is required for path definition");
    // Fail loud on a misconfiguration that otherwise silently denies every request:
    // roles require an auth provider to derive the caller's identity for the ACL check.
    if (path.roles?.length && !path.auth) {
      this.logger.warn(`Path '${path.name || path.path}' declares roles but no 'auth' provider; the role check cannot identify the caller and every request will be denied (403). Set 'auth' to enable the ACL.`);
    }
    // Boot-time validation: a path that references a non-existent auth provider would
    // otherwise only reveal the mistake at request time. Surface it now (the request
    // path itself fails closed with 401 — see HttpAuthHandlerService.processAuthData).
    if (path.auth && !this.httpAuthHandlerService.findProvider(path.auth)) {
      this.logger.error(`Path '${path.name || path.path}' references unknown auth provider '${path.auth}'; requests will be denied (401). Check 'auth-providers'.`);
    }

    const target = router ?? (this.dynamicRouter ?? (this.dynamicRouter = Router()));
    target[path.method.toLowerCase()](path.path, this.multer.any(), async (req: Request, res: Response) => {
      // Auto per-call metrics: when a metrics sink is configured, emit one fire-and-forget
      // track event per request after the response is flushed (captures the FINAL status
      // and duration whatever branch handled it). Disabled when gateway.metrics is unset.
      this.trackMetrics(req, res, path);

      // --- Authentication & authorization gate ---------------------------------
      // `allowAnonymous` makes the route public: enforcement is skipped entirely.
      // We still run processAuthData best-effort so that a valid token's mapped claims
      // are forwarded downstream (optional auth); a missing/invalid token on an
      // anonymous route is simply not blocked.
      const authData = await this.httpAuthHandlerService.processAuthData(req, path);

      if (path.allowAnonymous !== true) {
        // (1) Authentication — a configured provider must validate the request.
        if (path.auth && !authData?.success) {
          res.status(401).json({ message: "Unauthorized" });
          this.logger.warn(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | UNAUTHORIZED '401'`);
          return;
        }
        // (2) Authorization — role-based ACL, applied only when the path declares
        // `roles` (checkRoles is a no-op when `auth` or `roles` is absent).
        if (!(await this.httpAuthHandlerService.checkRoles(authData, path))) {
          res.status(403).json({ message: "Forbidden" });
          this.logger.warn(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | FORBIDDEN '403'`);
          return;
        }
      }

      // Forward only the mapped claim headers downstream (e.g. X-GTW-AUTH-USERID per the
      // provider's jwtMap/uidClaim), never the internal `success` flag. At each call site
      // these auth-derived headers are spread AFTER the client-forwardable ones
      // (httpHeaders), so a forwarded request header can never override the authenticated
      // identity (anti-spoofing); gateway metadata (X-GTW-METHOD/PATH) is spread last.
      const { success: _authSuccess, ...authHeaders } = authData || {};
      const httpHeaders = this.httpHeaders(req, path);

      let data = req[path.dataSource] || req.body || {};
      if (path.dataSource === 'body') {
        data = { ...req.params, ...(req.body || {}) };
      } else if (path.dataSource === 'query') {
        data = { ...req.params, ...(req.query || {}) };
      } else if (path.dataSource === 'params') {
        data = req.params || {};
      } else if (path.dataSource === 'body-query') {
        data = { ...req.params, ...(req.query || {}), ...(req.body || {}) };
      } else if (path.dataSource === 'query-body') {
        data = { ...req.params, ...(req.body || {}), ...(req.query || {}) };
      } else {
        data = { ...req.params, ...(req.body || {}), ...(req.query || {}) };
      }
      if (path.parseRaw) {
        Object.assign(data, { $raw: (req as any).rawBody });
      }
      if (req.files) {
        Object.assign(data, { $files: req.files });
      }
      Object.assign(data, req.params);
      if (data['$files']) {
        for (const file of data['$files']) {
          const o: Buffer = file.buffer;
          file.buffer = o.toString('binary');
        }
      }
      const headers = new Map<string, string | string[] | number>();
      if (path.headers) {
        for (const key in path.headers) {
          headers.set(key, path.headers[key]);
        }
      }
      try {
        if (path.mode === "event") {
          try {
            // Wait for the broker to take charge of the message (publisher confirm)
            // before acknowledging the request, so the 2xx is not optimistic.
            await this.broker.publishMessage(path.topic, path.action, data, { ...httpHeaders, ...authHeaders, "X-GTW-METHOD": req.method, "X-GTW-PATH": path.path });
            res.status(path.successStatusCode || 202).setHeaders(headers).end();
            this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'EVENT'`);
          } catch (error) {
            res.status(503).json(this.utils.error2Object(error, this.appConfig.environment !== 'production'));
            this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | ERROR '${error.name}' ${error.message}`);
          }
        } else if (path.mode === "rpc") {
          try {
            const resp = await this.broker.requestData(path.topic, path.action, data, { ...httpHeaders, ...authHeaders, "X-GTW-METHOD": req.method, "X-GTW-PATH": path.path }, path.timeout);
            if (resp) {
              if (path.redirect) {
                res.redirect(path.redirect, resp);
                this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | REDIRECT '${path.redirect}'`);
                return;
              }
              if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
              if (headers.get("Content-Type").toString().includes('json')) {
                res.status(path.successStatusCode || 200).setHeaders(headers).json(resp);
                this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'JSON'`);
                return;
              }
              if (path.binary) {
                res.status(path.successStatusCode || 200).setHeaders(headers).end(Buffer.from(resp.toString(), 'base64'));
              } else {
                res.status(path.successStatusCode || 200).setHeaders(headers).end(resp);
              }
              this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'RAW'`);
              return;
            }
            res.status(path.successStatusCode || 204).end();
            this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | PROCESSED 'NO CONTENT'`);
            return;
          } catch (error) {
            switch (error.name) {
              case "BadRequestError": res.status(400).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "ForbiddenError": res.status(403).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "InvalidParamsErrror": res.status(400).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "NotFoundError": res.status(404).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              case "UnauthorizedError": res.status(401).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
              default: res.status(500).json(this.utils.error2Object(error, this.appConfig.environment !== 'production')); break;
            }
            this.logger.log(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | ERROR '${error.name}' ${error.message}`);
          }
        }
        else {
          throw new Error(`Invalid mode '${path.mode}' for path definition`);
        }
      } catch (error) {
        this.logger.error(`[${path.mode.toUpperCase()}] [${path.method.toUpperCase()}] '${path.path}' => ${path.topic} | ERROR '${error.name}' ${error.message}`);
        if (this.appConfig.environment === "development") {
          res.status(500).json(error);
        }
        else {
          res.status(500).json({ message: "Internal server error", name: error.name });
        }
      }
    });
  }

  /**
   * Emits one fire-and-forget metrics track event per request, after the response is
   * flushed, when `gateway.metrics` is configured (i.e. the metrics module is enabled).
   * Never throws and never delays the response: failures are logged at debug level.
   */
  private trackMetrics(req: Request, res: Response, path: PathDefinition) {
    const sink = this.gatewayConfig.metrics;
    if (!sink?.topic || !sink?.action) return;
    const startedAt = Date.now();
    res.once('finish', () => {
      const payload = {
        method: req.method,
        route: path.path,
        name: path.name,
        topic: path.topic,
        action: path.action,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      };
      // Fire-and-forget: do not await; a failing metrics sink must not affect requests.
      this.broker.publishMessage(sink.topic, sink.action, payload)
        .catch((error) => this.logger.debug(`[METRICS] track failed for '${path.path}': ${error?.message}`));
    });
  }

  private httpHeaders(req: Request, path: PathDefinition): { [k: string]: string | string[] | number; } {
    const data: { [k: string]: string | string[] | number; } = {};
    if (path.forwardHeaders) {
      for (const key in path.forwardHeaders) {
        const header = path.forwardHeaders[key]?.toLocaleLowerCase().trim();
        const headerValue = Object.keys(req.headers).find(h => h.toLowerCase().trim() === header);
        if (headerValue) {
          if (this.gatewayConfig.headerPrefix) {
            data[`${this.gatewayConfig.headerPrefix}${key}`] = req.headers[headerValue];
          } else {
            data[`${key}`] = req.headers[headerValue];
          }
        }
      }
    }
    return data;
  }
}

